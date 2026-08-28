import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  RepositoryAnalysis,
  AnalyzeOptions,
  AnalyzeProgress,
  Snapshot,
  SnapshotDelta,
} from '@repo-archaeologist/core';
import { SimpleGitAnalyzer, parseGitHubUrl } from './git/analyzer.js';
import { selectImportantCommits } from './commit-selector.js';
import { SnapshotBuilder } from './snapshot-builder.js';
import { ChangeDetector } from './change-detector.js';
import { EventClusterer, buildModuleEvolutions, buildTimeline } from './event-clusterer.js';

export type ProgressCallback = (progress: AnalyzeProgress) => void;

export class RepositoryAnalyzer {
  private changeDetector = new ChangeDetector();
  private eventClusterer = new EventClusterer();

  async analyzeFromUrl(
    url: string,
    options: AnalyzeOptions = {},
    onProgress?: ProgressCallback
  ): Promise<RepositoryAnalysis> {
    const parsed = parseGitHubUrl(url);
    if (!parsed) {
      throw new Error(`Invalid GitHub URL: ${url}`);
    }

    const tempDir = join('/tmp', `repo-archaeologist-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      onProgress?.({ stage: 'cloning', progress: 5, message: `Cloning ${parsed.owner}/${parsed.name}...` });

      const git = new SimpleGitAnalyzer(tempDir);
      await git.clone(parsed.cloneUrl, tempDir);

      return await this.analyzeRepo(git, parsed.cloneUrl, parsed.owner, parsed.name, options, onProgress);
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async analyzeLocalPath(
    repoPath: string,
    options: AnalyzeOptions = {},
    onProgress?: ProgressCallback
  ): Promise<RepositoryAnalysis> {
    const git = new SimpleGitAnalyzer(repoPath);
    await git.open(repoPath);
    const parts = repoPath.split('/').filter(Boolean);
    const name = parts[parts.length - 1] ?? 'local';
    return this.analyzeRepo(git, repoPath, 'local', name, options, onProgress);
  }

  private async analyzeRepo(
    git: SimpleGitAnalyzer,
    url: string,
    owner: string,
    name: string,
    options: AnalyzeOptions,
    onProgress?: ProgressCallback
  ): Promise<RepositoryAnalysis> {
    onProgress?.({ stage: 'scanning', progress: 15, message: 'Scanning commit history...' });

    const defaultBranch = await git.getDefaultBranch();
    const totalCommits = await git.getTotalCommits(defaultBranch);
    const allCommits = await git.getCommits(defaultBranch, 500);

    onProgress?.({ stage: 'selecting_commits', progress: 25, message: 'Selecting important commits...' });

    const selectedCommits = selectImportantCommits(allCommits, options);

    onProgress?.({ stage: 'building_snapshots', progress: 30, message: `Building ${selectedCommits.length} architecture snapshots...` });

    const snapshotBuilder = new SnapshotBuilder(git);
    const snapshots: Snapshot[] = [];

    for (let i = 0; i < selectedCommits.length; i++) {
      const commit = selectedCommits[i];
      const progress = 30 + Math.round((i / selectedCommits.length) * 40);
      onProgress?.({
        stage: 'building_snapshots',
        progress,
        message: `Snapshot ${i + 1}/${selectedCommits.length}: ${commit.shortHash}`,
      });
      snapshots.push(await snapshotBuilder.buildSnapshot(commit));
    }

    onProgress?.({ stage: 'detecting_changes', progress: 75, message: 'Detecting architecture changes...' });

    const deltas: SnapshotDelta[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      deltas.push(this.changeDetector.detectDelta(snapshots[i - 1], snapshots[i]));
    }

    onProgress?.({ stage: 'clustering_events', progress: 85, message: 'Clustering evolution events...' });

    const evolutionEvents = this.eventClusterer.cluster(selectedCommits, snapshots, deltas, options);
    const moduleEvolutions = buildModuleEvolutions(snapshots, deltas);
    const timeline = buildTimeline(snapshots, evolutionEvents);

    onProgress?.({ stage: 'complete', progress: 100, message: 'Analysis complete!' });

    return {
      id: randomUUID(),
      url,
      name,
      owner,
      analyzedAt: new Date().toISOString(),
      defaultBranch,
      totalCommits,
      snapshots,
      deltas,
      evolutionEvents,
      moduleEvolutions,
      timeline,
    };
  }
}

export { parseGitHubUrl } from './git/analyzer.js';
export { selectImportantCommits } from './commit-selector.js';
export { SnapshotBuilder, detectModulePath } from './snapshot-builder.js';
export { ChangeDetector, summarizeDelta } from './change-detector.js';
export { EventClusterer, buildModuleEvolutions, buildTimeline, classifyEventType } from './event-clusterer.js';
