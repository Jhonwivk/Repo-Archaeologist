import type { CommitInfo } from './git/types.js';
import { DEFAULT_ANALYZE_OPTIONS } from './git/types.js';
import type { AnalyzeOptions } from '@repo-archaeologist/core';

export function selectImportantCommits(
  commits: CommitInfo[],
  options: AnalyzeOptions = {}
): CommitInfo[] {
  const opts = { ...DEFAULT_ANALYZE_OPTIONS, ...options };
  if (commits.length === 0) return [];

  // Commits are newest-first from git log; reverse for chronological order
  const chronological = [...commits].reverse();
  const selected = new Map<string, CommitInfo>();

  // Always include first and last commit
  selected.set(chronological[0].hash, chronological[0]);
  selected.set(chronological[chronological.length - 1].hash, chronological[chronological.length - 1]);

  // Time-based sampling
  let lastSelectedDate = new Date(chronological[0].date);
  for (const commit of chronological) {
    const commitDate = new Date(commit.date);
    const daysDiff = (commitDate.getTime() - lastSelectedDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff >= opts.minDaysBetweenSnapshots) {
      selected.set(commit.hash, commit);
      lastSelectedDate = commitDate;
    }
  }

  // High-impact commits (many files changed)
  if (opts.includeHighImpactCommits) {
    const threshold = percentile(
      chronological.map((c) => c.filesChanged).filter((n) => n > 0),
      85
    );
    for (const commit of chronological) {
      if (commit.filesChanged >= Math.max(threshold, 10)) {
        selected.set(commit.hash, commit);
      }
    }
  }

  // Architecture-related commit messages
  const archKeywords = /\b(refactor|architect|migrate|split|merge|introduce|remove|deprecat|restruct|modular|extract|rewrite)\b/i;
  for (const commit of chronological) {
    if (archKeywords.test(commit.message)) {
      selected.set(commit.hash, commit);
    }
  }

  const result = [...selected.values()].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Cap at maxSnapshots, keeping evenly distributed if too many
  if (result.length > opts.maxSnapshots) {
    return downsampleEvenly(result, opts.maxSnapshots);
  }

  return result;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 10;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function downsampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const result: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    result.push(items[Math.round(i * step)]);
  }
  return result;
}
