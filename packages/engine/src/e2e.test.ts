import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotFingerprint, graphStructure } from '@repo-archaeologist/core';
import { createEvolutionLabFixture } from './eval/fixture.js';
import { evolutionLabGroundTruth, selfRepoGroundTruth } from './eval/ground-truth.js';
import { evaluateAnalysis } from './eval/metrics.js';
import { RepositoryAnalyzer } from './analyzer.js';
import { SimpleGitAnalyzer } from './git/analyzer.js';
import { SnapshotBuilder } from './snapshot-builder.js';

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

    const structural = analysis.evolutionEvents.filter((e) =>
      e.type === 'module_split' || e.type === 'module_merge' || e.type === 'architecture_migration'
      || e.changes.some((c) => c.type === 'split' || c.type === 'merged' || c.type === 'moved')
    );
    assert.ok(structural.length >= 1, 'expected structural events');
    for (const event of structural) {
      assert.ok(
        event.evidence.some((ev) => ev.kind === 'commit_message' && (ev.commit || ev.ref)),
        `${event.id} missing commit evidence`
      );
      assert.ok(
        event.changedFiles.length > 0 || event.evidence.some((ev) => ev.kind === 'file_change' && ev.file),
        `${event.id} missing file evidence`
      );
      assert.ok(
        (event.symbols?.length ?? 0) > 0 || event.evidence.some((ev) => ev.kind === 'symbol' && ev.symbol),
        `${event.id} missing symbol evidence`
      );
    }

    const fingerprints = analysis.snapshots.map((s) => s.fingerprint);
    const unique = new Set(fingerprints);
    assert.ok(unique.size >= 3, `timeline fingerprints must change, got ${unique.size} unique of ${fingerprints.length}`);

    const metrics = evaluateAnalysis(analysis, evolutionLabGroundTruth);
    assert.ok(metrics.modulePrecision >= 0.85, `module precision ${metrics.modulePrecision}`);
    assert.ok(metrics.moduleRecall >= 0.85, `module recall ${metrics.moduleRecall}`);
    assert.ok(metrics.eventRecall >= 0.75, `event recall ${metrics.eventRecall}`);
    assert.ok(metrics.structuralAccuracy >= 0.75, `structural accuracy ${metrics.structuralAccuracy}`);
    assert.ok(metrics.evidenceValidity >= 0.99, `evidence validity ${metrics.evidenceValidity}`);
  });

  it('rebuilds the same snapshot from the git tree and TypeScript AST', async () => {
    if (!dir) {
      dir = await mkdtemp(join(tmpdir(), 'evolution-lab-'));
      await createEvolutionLabFixture(dir);
    }

    const git = new SimpleGitAnalyzer(dir);
    await git.open(dir);
    const commits = await git.getCommits('main', 20);
    const initial = commits[commits.length - 1];
    const builder = new SnapshotBuilder(git);

    const first = await builder.buildSnapshot(initial);
    const second = await builder.buildSnapshot(initial);

    assert.equal(first.reconstructedFrom, 'git+typescript-ast');
    assert.equal(first.fingerprint, second.fingerprint);
    assert.deepEqual(
      first.modules.map((m) => m.path).sort(),
      ['src/cli', 'src/core']
    );
    assert.ok(first.modules.find((m) => m.path === 'src/core')?.symbols.includes('LLMClient'));
    assert.ok(first.modules.find((m) => m.path === 'src/cli')?.symbols.includes('main'));

    const edges = first.dependencies.map((e) => {
      const from = first.modules.find((m) => m.id === e.from)?.path;
      const to = first.modules.find((m) => m.id === e.to)?.path;
      return `${from}->${to}`;
    });
    assert.ok(edges.includes('src/cli->src/core'), `expected cli→core from the import, got ${edges.join(', ')}`);
    assert.ok((first.dependencies[0]?.via ?? []).some((s) => s.includes('core')), 'edge must cite the import specifier');
  });

  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });
});

describe('timeline graph structure', () => {
  it('changes node/edge sets across demo snapshots', async () => {
    const { demoAnalysis } = await import('./demo-data.js');
    const structures = demoAnalysis.snapshots.map((s) => graphStructure(s));
    assert.notDeepEqual(structures[0].nodes, structures[structures.length - 1].nodes);
    const fingerprints = demoAnalysis.snapshots.map((s) => snapshotFingerprint(s));
    assert.ok(new Set(fingerprints).size >= 4);
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
