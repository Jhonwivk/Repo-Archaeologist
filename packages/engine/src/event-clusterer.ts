import type {
  Snapshot,
  SnapshotDelta,
  EvolutionEvent,
  EvolutionEventType,
  ArchitectureChange,
  Evidence,
  BlastRadius,
  ModuleEvolution,
  ModuleLifecycleEvent,
  TimelinePoint,
} from '@repo-archaeologist/core';
import type { CommitInfo } from './git/types.js';
import { DEFAULT_ANALYZE_OPTIONS } from './git/types.js';
import type { AnalyzeOptions } from '@repo-archaeologist/core';
import { summarizeDelta } from './change-detector.js';

interface CommitCluster {
  commits: CommitInfo[];
  snapshots: Snapshot[];
  deltas: SnapshotDelta[];
  startDate: Date;
  endDate: Date;
}

export class EventClusterer {
  cluster(
    commits: CommitInfo[],
    snapshots: Snapshot[],
    deltas: SnapshotDelta[],
    options: AnalyzeOptions = {}
  ): EvolutionEvent[] {
    const opts = { ...DEFAULT_ANALYZE_OPTIONS, ...options };
    const windowMs = opts.clusterWindowDays * 24 * 60 * 60 * 1000;

    const clusters: CommitCluster[] = [];
    let current: CommitCluster | null = null;

    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      const commit = commits.find((c) => c.hash === snap.commit);
      if (!commit) continue;

      const snapDate = new Date(snap.timestamp);
      const delta = i > 0 ? deltas[i - 1] : null;
      const hasChanges = delta && delta.changes.length > 0;

      if (!hasChanges) continue;

      if (!current || snapDate.getTime() - current.endDate.getTime() > windowMs) {
        if (current && current.deltas.some((d) => d.changes.length > 0)) {
          clusters.push(current);
        }
        current = {
          commits: [commit],
          snapshots: [snap],
          deltas: delta ? [delta] : [],
          startDate: snapDate,
          endDate: snapDate,
        };
      } else {
        current.commits.push(commit);
        current.snapshots.push(snap);
        if (delta) current.deltas.push(delta);
        current.endDate = snapDate;
      }
    }

    if (current && current.deltas.some((d) => d.changes.length > 0)) {
      clusters.push(current);
    }

    return clusters.map((cluster, idx) => this.clusterToEvent(cluster, idx));
  }

  private clusterToEvent(cluster: CommitCluster, index: number): EvolutionEvent {
    const allChanges = cluster.deltas.flatMap((d) => d.changes);
    const affectedModules = [...new Set(allChanges.map((c) => c.module))];
    const eventType = classifyEventType(allChanges, cluster.commits);
    const title = generateEventTitle(eventType, allChanges);
    const summary = generateEventSummary(eventType, allChanges, cluster.commits);
    const evidence = buildEvidence(allChanges, cluster.commits, cluster.deltas);
    const blastRadius = computeBlastRadius(cluster.deltas, cluster.commits);

    return {
      id: `event-${index + 1}`,
      type: eventType,
      title,
      summary,
      period: {
        start: cluster.startDate.toISOString(),
        end: cluster.endDate.toISOString(),
      },
      startCommit: cluster.commits[0].hash,
      endCommit: cluster.commits[cluster.commits.length - 1].hash,
      commits: cluster.commits.map((c) => c.hash),
      affectedModules,
      changes: dedupeChanges(allChanges),
      evidence,
      blastRadius,
    };
  }
}

export function classifyEventType(changes: ArchitectureChange[], commits: CommitInfo[]): EvolutionEventType {
  const added = changes.filter((c) => c.type === 'added').length;
  const removed = changes.filter((c) => c.type === 'removed').length;
  const splits = changes.filter((c) => c.type === 'split').length;
  const merges = changes.filter((c) => c.type === 'merged').length;
  const moved = changes.filter((c) => c.type === 'moved').length;

  const messages = commits.map((c) => c.message.toLowerCase()).join(' ');

  if (splits > 0) return 'module_split';
  if (merges > 0) return 'module_merge';
  if (/\bmigrat/i.test(messages)) return 'architecture_migration';
  if (/\bbreak/i.test(messages)) return 'breaking_change';
  if (added > 0 && removed > 2) return 'architecture_migration';
  if (added >= 2 && removed === 0) return 'feature_introduction';
  if (removed > 0 && added === 0) return 'refactor';
  if (moved > 0) return 'refactor';
  if (added > 0 || removed > 0) return 'refactor';
  return 'other';
}

function generateEventTitle(type: EvolutionEventType, changes: ArchitectureChange[]): string {
  const added = changes.filter((c) => c.type === 'added').map((c) => c.module);
  const removed = changes.filter((c) => c.type === 'removed').map((c) => c.module);
  const splits = changes.filter((c) => c.type === 'split');
  const merges = changes.filter((c) => c.type === 'merged');

  switch (type) {
    case 'feature_introduction':
      return `Introduce ${added.slice(0, 2).join(', ')}${added.length > 2 ? ` (+${added.length - 2})` : ''}`;
    case 'module_split':
      return splits[0]?.detail ?? `Module split: ${splits[0]?.module}`;
    case 'module_merge':
      return merges[0]?.detail ?? `Module merge: ${merges[0]?.module}`;
    case 'architecture_migration':
      return `Architecture migration${removed.length ? `: retire ${removed[0]}` : ''}${added.length ? `, add ${added[0]}` : ''}`;
    case 'breaking_change':
      return `Breaking change across ${changes.length} modules`;
    case 'refactor':
      if (removed.length && added.length) return `Refactor: ${removed[0]} → ${added[0]}`;
      if (added.length) return `Restructure: add ${added.join(', ')}`;
      if (removed.length) return `Remove ${removed.join(', ')}`;
      return 'Structural refactor';
    default:
      return changes.length ? summarizeDelta({ changes } as SnapshotDelta) : 'Evolution event';
  }
}

function generateEventSummary(type: EvolutionEventType, changes: ArchitectureChange[], commits: CommitInfo[]): string {
  const commitCount = commits.length;
  const moduleCount = new Set(changes.map((c) => c.module)).size;
  const added = changes.filter((c) => c.type === 'added');
  const removed = changes.filter((c) => c.type === 'removed');
  const moved = changes.filter((c) => c.type === 'moved');

  const parts: string[] = [];

  if (type === 'module_split') {
    parts.push(`A module was split into separate components across ${commitCount} commit${commitCount > 1 ? 's' : ''}.`);
  } else if (type === 'architecture_migration') {
    parts.push(`The project underwent an architectural migration affecting ${moduleCount} module${moduleCount > 1 ? 's' : ''}.`);
  } else if (type === 'feature_introduction') {
    parts.push(`New modules were introduced: ${added.map((c) => c.module).join(', ')}.`);
  } else {
    parts.push(`${moduleCount} module${moduleCount > 1 ? 's' : ''} changed across ${commitCount} commit${commitCount > 1 ? 's' : ''}.`);
  }

  if (removed.length) parts.push(`Removed: ${removed.map((c) => c.module).join(', ')}.`);
  if (added.length) parts.push(`Added: ${added.map((c) => c.module).join(', ')}.`);
  if (moved.length) parts.push(`Moved: ${moved.map((c) => c.detail ?? c.module).join('; ')}.`);

  return parts.join(' ');
}

function buildEvidence(changes: ArchitectureChange[], commits: CommitInfo[], deltas: SnapshotDelta[]): Evidence[] {
  const evidence: Evidence[] = [];

  for (const commit of commits.slice(0, 3)) {
    evidence.push({
      kind: 'commit_message',
      description: commit.message.split('\n')[0],
      ref: commit.shortHash,
    });
  }

  for (const change of changes.slice(0, 5)) {
    evidence.push({
      kind: 'module_delta',
      description: change.detail ?? `${change.type}: ${change.module}`,
    });
  }

  const totalFiles = commits.reduce((sum, c) => sum + c.filesChanged, 0);
  if (totalFiles > 0) {
    evidence.push({
      kind: 'file_change',
      description: `${totalFiles} files changed across ${commits.length} commits`,
    });
  }

  const depChanges = deltas.reduce(
    (sum, d) => sum + d.dependencyChanges.added.length + d.dependencyChanges.removed.length,
    0
  );
  if (depChanges > 0) {
    evidence.push({
      kind: 'dependency_change',
      description: `${depChanges} dependency relationship changes detected`,
    });
  }

  return evidence;
}

function computeBlastRadius(deltas: SnapshotDelta[], commits: CommitInfo[]): BlastRadius {
  const heatmap: Record<string, number> = {};
  let modulesAffected = 0;
  let dependenciesChanged = 0;

  for (const delta of deltas) {
    modulesAffected += delta.added.length + delta.removed.length + delta.moved.length;
    dependenciesChanged += delta.dependencyChanges.added.length + delta.dependencyChanges.removed.length;

    for (const mod of [...delta.added, ...delta.removed]) {
      const root = mod.path.split('/')[0] ?? mod.path;
      heatmap[root] = (heatmap[root] ?? 0) + 1;
    }
  }

  return {
    filesChanged: commits.reduce((sum, c) => sum + c.filesChanged, 0),
    modulesAffected,
    dependenciesChanged,
    heatmap,
  };
}

function dedupeChanges(changes: ArchitectureChange[]): ArchitectureChange[] {
  const seen = new Set<string>();
  return changes.filter((c) => {
    const key = `${c.type}:${c.module}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildModuleEvolutions(snapshots: Snapshot[], deltas: SnapshotDelta[]): ModuleEvolution[] {
  const moduleHistory = new Map<string, ModuleEvolution>();

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    for (const mod of snap.modules) {
      if (!moduleHistory.has(mod.id)) {
        moduleHistory.set(mod.id, {
          module: mod.name,
          bornAt: snap.timestamp,
          bornCommit: snap.shortCommit,
          events: [{
            kind: 'born',
            timestamp: snap.timestamp,
            commit: snap.shortCommit,
            detail: `First seen at ${mod.path}`,
          }],
          currentDependencies: [],
        });
      }
    }

    if (i > 0) {
      const delta = deltas[i - 1];
      for (const change of delta.changes) {
        const existing = [...moduleHistory.values()].find((m) => m.module === change.module);
        if (existing) {
          existing.events.push({
            kind: change.type === 'split' ? 'split' : change.type === 'merged' ? 'merge' : 'major_redesign',
            timestamp: snap.timestamp,
            commit: snap.shortCommit,
            detail: change.detail,
            relatedModules: change.to,
          });
        }
      }

      for (const removed of delta.removed) {
        const existing = moduleHistory.get(removed.id);
        if (existing) {
          existing.removedAt = snap.timestamp;
          existing.removedCommit = snap.shortCommit;
          existing.events.push({
            kind: 'removed',
            timestamp: snap.timestamp,
            commit: snap.shortCommit,
          });
        }
      }
    }
  }

  // Update current dependencies from last snapshot
  const lastSnap = snapshots[snapshots.length - 1];
  if (lastSnap) {
    for (const mod of lastSnap.modules) {
      const evo = moduleHistory.get(mod.id);
      if (evo) {
        evo.currentDependencies = lastSnap.dependencies
          .filter((d) => d.from === mod.id)
          .map((d) => {
            const target = lastSnap.modules.find((m) => m.id === d.to);
            return target?.name ?? d.to;
          });
      }
    }
  }

  return [...moduleHistory.values()];
}

export function buildTimeline(snapshots: Snapshot[], events: EvolutionEvent[]): TimelinePoint[] {
  return snapshots.map((snap) => {
    const snapDate = new Date(snap.timestamp);
    const eventIds = events
      .filter((e) => {
        const start = new Date(e.period.start);
        const end = new Date(e.period.end);
        return snapDate >= start && snapDate <= end;
      })
      .map((e) => e.id);

    return {
      timestamp: snap.timestamp,
      commit: snap.commit,
      shortCommit: snap.shortCommit,
      label: formatDateLabel(snap.timestamp),
      snapshotId: snap.id,
      eventIds,
    };
  });
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
