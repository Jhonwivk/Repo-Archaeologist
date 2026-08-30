#!/usr/bin/env node
import { RepositoryAnalyzer, parseGitHubUrl } from './analyzer.js';
import { createEvolutionLabFixture } from './eval/fixture.js';
import { evolutionLabGroundTruth } from './eval/ground-truth.js';
import { evaluateAnalysis, formatMetrics } from './eval/metrics.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = process.argv[2];

if (arg === '--eval-fixture') {
  const dir = await mkdtemp(join(tmpdir(), 'evolution-lab-'));
  try {
    await createEvolutionLabFixture(dir);
    const analysis = await new RepositoryAnalyzer().analyzeLocalPath(dir, {
      minDaysBetweenSnapshots: 0,
      maxSnapshots: 20,
      clusterWindowDays: 7,
    });
    console.log(formatMetrics(evaluateAnalysis(analysis, evolutionLabGroundTruth)));
    console.log(`events: ${analysis.evolutionEvents.map((e) => e.title).join(' | ')}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  process.exit(0);
}

if (!arg) {
  console.error('Usage: repo-archaeologist <github-url> | --eval-fixture');
  process.exit(1);
}

const parsed = parseGitHubUrl(arg);
if (!parsed) {
  console.error('Invalid GitHub URL. V1.1 supports public GitHub TypeScript/JavaScript repositories.');
  process.exit(1);
}

const analysis = await new RepositoryAnalyzer().analyzeFromUrl(arg, {}, (p) => {
  process.stderr.write(`\r[${p.progress}%] ${p.message}`.padEnd(80));
});
process.stderr.write('\n');
console.log(JSON.stringify({
  name: `${analysis.owner}/${analysis.name}`,
  snapshots: analysis.snapshots.length,
  events: analysis.evolutionEvents.map((e) => ({ title: e.title, type: e.type, confidence: e.confidence })),
}, null, 2));
