import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEvolutionLabFixture } from './eval/fixture.js';
import { evolutionLabGroundTruth, selfRepoGroundTruth } from './eval/ground-truth.js';
import { evaluateAnalysis } from './eval/metrics.js';
import { RepositoryAnalyzer } from './analyzer.js';

const FIXTURE_OPTIONS = {
  minDaysBetweenSnapshots: 0,
  maxSnapshots: 20,
  includeHighImpactCommits: true,
  clusterWindowDays: 7,
  maxCommits: 50,
};

describe('e2e evolution-lab fixture', () => {
  let dir = '';

  it('reconstructs add, move, split, and merge events from a real git repo', async () => {
    dir = await mkdtemp(join(tmpdir(), 'evolution-lab-'));
    await createEvolutionLabFixture(dir);

    const analyzer = new RepositoryAnalyzer();
    const analysis = await analyzer.analyzeLocalPath(dir, FIXTURE_OPTIONS);

    assert.ok(analysis.snapshots.length >= 4, `expected several snapshots, got ${analysis.snapshots.length}`);
    assert.ok(analysis.evolutionEvents.length >= 4, `expected clustered events, got ${analysis.evolutionEvents.length}`);

    const last = analysis.snapshots[analysis.snapshots.length - 1];
    const paths = last.modules.map((m) => m.path).sort();
    for (const expected of evolutionLabGroundTruth.finalModulePaths) {
      assert.ok(paths.includes(expected), `missing final module ${expected}, have ${paths.join(', ')}`);
    }

    const types = analysis.evolutionEvents.flatMap((e) => [e.type, ...e.changes.map((c) => c.type)]);
    assert.ok(types.includes('moved') || types.includes('refactor'), 'should detect the core → runtime move');
    assert.ok(types.includes('module_split') || types.includes('split'), 'should detect agent split');
    assert.ok(types.includes('module_merge') || types.includes('merged'), 'should detect persist merge');

    for (const event of analysis.evolutionEvents) {
      assert.ok(event.evidence.length > 0, `${event.id} missing evidence`);
      assert.ok(
        event.evidence.some((ev) => ev.commit || ev.ref),
        `${event.id} evidence is not linked to a commit`
      );
      assert.ok(event.fromSnapshotId, `${event.id} missing fromSnapshotId`);
      assert.ok(event.toSnapshotId, `${event.id} missing toSnapshotId`);
    }

    const metrics = evaluateAnalysis(analysis, evolutionLabGroundTruth);
    assert.ok(metrics.modulePrecision >= 0.85, `module precision ${metrics.modulePrecision}`);
    assert.ok(metrics.moduleRecall >= 0.85, `module recall ${metrics.moduleRecall}`);
    assert.ok(metrics.eventRecall >= 0.75, `event recall ${metrics.eventRecall}`);
    assert.ok(metrics.structuralAccuracy >= 0.75, `structural accuracy ${metrics.structuralAccuracy}`);
    assert.ok(metrics.evidenceValidity >= 0.99, `evidence validity ${metrics.evidenceValidity}`);
  });

  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });
});

describe('self-repo module extraction', () => {
  it('identifies workspace packages as modules', async () => {
    const analyzer = new RepositoryAnalyzer();
    const analysis = await analyzer.analyzeLocalPath(process.cwd().replace(/\/packages\/engine$/, ''), {
      minDaysBetweenSnapshots: 3650,
      maxSnapshots: 4,
      includeHighImpactCommits: true,
      maxCommits: 50,
    });

    const last = analysis.snapshots[analysis.snapshots.length - 1];
    const paths = last.modules.map((m) => m.path);
    for (const expected of selfRepoGroundTruth.finalModulePaths) {
      assert.ok(paths.includes(expected), `missing ${expected}, have ${paths.join(', ')}`);
    }

    const metrics = evaluateAnalysis(analysis, selfRepoGroundTruth);
    assert.ok(metrics.moduleRecall >= 0.85, `self module recall ${metrics.moduleRecall}`);
  });
});
