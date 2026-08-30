#!/usr/bin/env node
import { RepositoryAnalyzer } from '../packages/engine/dist/index.js';

const defaultRepositories = [
  'https://github.com/Jhonwivk/Repo-Archaeologist',
  'https://github.com/sindresorhus/p-map',
  'https://github.com/vercel/ms',
];

const repositories = process.argv.slice(2);
const targets = repositories.length > 0 ? repositories : defaultRepositories;
const analyzer = new RepositoryAnalyzer();
const results = [];

for (const url of targets) {
  const startedAt = Date.now();
  process.stderr.write(`Analyzing ${url}\n`);

  const analysis = await analyzer.analyzeFromUrl(
    url,
    {
      cloneDepth: 200,
      maxCommits: 200,
      maxSnapshots: 24,
    },
    (progress) => {
      process.stderr.write(`\r[${progress.progress}%] ${progress.message}`.padEnd(90));
    }
  );
  process.stderr.write('\n');

  if (analysis.snapshots.length === 0) {
    throw new Error(`${url} produced no architecture snapshots`);
  }

  const finalSnapshot = analysis.snapshots.at(-1);
  if (!finalSnapshot || finalSnapshot.modules.length === 0) {
    throw new Error(`${url} produced no modules in its final architecture snapshot`);
  }
  results.push({
    repository: `${analysis.owner}/${analysis.name}`,
    commits: analysis.totalCommits,
    snapshots: analysis.snapshots.length,
    finalModules: finalSnapshot?.modules.length ?? 0,
    events: analysis.evolutionEvents.length,
    eventTypes: [...new Set(analysis.evolutionEvents.map((event) => event.type))],
    durationMs: Date.now() - startedAt,
  });
}

console.log(JSON.stringify(results, null, 2));
