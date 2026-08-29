import type {
  Snapshot,
  SnapshotDelta,
  EvolutionEvent,
  EvolutionEventType,
  ArchitectureChange,
  Evidence,
  BlastRadius,
  ModuleEvolution,
  TimelinePoint,
  AnalyzeOptions,
} from '@repo-archaeologist/core';
import type { CommitInfo } from './git/types.js';
import { DEFAULT_ANALYZE_OPTIONS } from './git/types.js';
import { summarizeDelta } from './change-detector.js';
import { githubCommitUrl, githubFileUrl } from './git/analyzer.js';

interface CommitCluster {
  commits: CommitInfo[];
  snapshots: Snapshot[];
  deltas: SnapshotDelta[];
  startDate: Date;
  endDate: Date;
}

export class EventClusterer {
  constructor(private repoUrl = '') {}

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
      const commit = commits.find((c) => c.hash === snap.commit) ?? {
        hash: snap.commit,
        shortHash: snap.shortCommit,
        date: snap.timestamp,
        message: snap.message,
        author: snap.author,
        filesChanged: 0,
      };

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

    return clusters.map((cluster, idx) => this.clusterToEvent(cluster, idx, snapshots));
  }

  private clusterToEvent(cluster: CommitCluster, index: number, allSnapshots: Snapshot[]): EvolutionEvent {
    const allChanges = cluster.deltas.flatMap((d) => d.changes);
    const affectedModules = [...new Set(allChanges.map((c) => c.module))];
    const eventType = classifyEventType(allChanges, cluster.commits);
    const title = generateEventTitle(eventType, allChanges);
    const summary = generateEventSummary(eventType, allChanges, cluster.commits);
    const changedFiles = [...new Set(cluster.deltas.flatMap((d) => d.changedFiles))];
    const fromSnap = cluster.deltas[0]
      ? allSnapshots.find((s) => s.id === cluster.deltas[0].fromSnapshotId)
      : undefined;
    const toSnap = cluster.deltas.length
      ? allSnapshots.find((s) => s.id === cluster.deltas[cluster.deltas.length - 1].toSnapshotId)
        ?? cluster.snapshots[cluster.snapshots.length - 1]
      : cluster.snapshots[cluster.snapshots.length - 1];
    const symbolChanges = diffSymbols(fromSnap, toSnap, allChanges);
    const evidence = this.buildEvidence(
      allChanges,
      cluster.commits,
      cluster.deltas,
      changedFiles,
      symbolChanges,
      fromSnap,
      toSnap
    );
    const blastRadius = computeBlastRadius(cluster.deltas, cluster.commits);
    const confidence = averageConfidence(allChanges);

    const fromSnapshotId = cluster.deltas[0]?.fromSnapshotId ?? cluster.snapshots[0]?.id ?? '';
    const toSnapshotId = cluster.deltas[cluster.deltas.length - 1]?.toSnapshotId
      ?? cluster.snapshots[cluster.snapshots.length - 1]?.id
      ?? '';

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
      fromSnapshotId,
      toSnapshotId,
      changedFiles: (changedFiles.length ? changedFiles : filesFromSnapshots(fromSnap, toSnap)).slice(0, 40),
      confidence,
      symbols: symbolChanges.map((s) => s.symbol).filter((s): s is string => Boolean(s)),
    };
  }

  private buildEvidence(
    changes: ArchitectureChange[],
    commits: CommitInfo[],
    deltas: SnapshotDelta[],
    changedFiles: string[],
    symbolChanges: Evidence[],
    fromSnap: Snapshot | undefined,
    toSnap: Snapshot | undefined
  ): Evidence[] {
    const evidence: Evidence[] = [];

    for (const commit of commits.slice(0, 5)) {
      evidence.push({
        kind: 'commit_message',
        description: commit.message.split('\n')[0],
        ref: commit.shortHash,
        commit: commit.hash,
        url: githubCommitUrl(this.repoUrl, commit.hash),
      });
    }

    for (const change of changes.slice(0, 8)) {
      evidence.push({
        kind: 'module_delta',
        description: change.detail ?? `${change.type}: ${change.module}`,
      });
    }

    const endCommit = commits[commits.length - 1];
    const files = changedFiles.length ? changedFiles : filesFromSnapshots(fromSnap, toSnap);
    for (const file of files.slice(0, 12)) {
      evidence.push({
        kind: 'file_change',
        description: file,
        file,
        commit: endCommit?.hash,
        url: endCommit ? githubFileUrl(this.repoUrl, endCommit.hash, file) : undefined,
      });
    }

    evidence.push(...symbolChanges.slice(0, 12));

    const depChanges = deltas.reduce(
      (sum, d) => sum + d.dependencyChanges.added.length + d.dependencyChanges.removed.length,
      0
    );
    if (depChanges > 0) {
      evidence.push({
        kind: 'dependency_change',
        description: `${depChanges} internal dependency relationship changes`,
      });
    }

    return evidence;
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
  if (added >= 1 && removed === 0 && splits === 0 && merges === 0 && moved === 0) return 'feature_introduction';
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
  const moved = changes.filter((c) => c.type === 'moved');

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
      if (moved.length) return moved[0]?.detail ?? `Move ${moved[0].module}`;
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
  const splits = changes.filter((c) => c.type === 'split');
  const merges = changes.filter((c) => c.type === 'merged');

  const parts: string[] = [];

  if (type === 'module_split') {
    parts.push(splits[0]?.detail ?? `A module split across ${commitCount} commit${commitCount > 1 ? 's' : ''}.`);
  } else if (type === 'module_merge') {
    parts.push(merges[0]?.detail ?? `Modules merged across ${commitCount} commit${commitCount > 1 ? 's' : ''}.`);
  } else if (type === 'architecture_migration') {
    parts.push(`Architectural migration affecting ${moduleCount} module${moduleCount > 1 ? 's' : ''}.`);
  } else if (type === 'feature_introduction') {
    parts.push(`New modules introduced: ${added.map((c) => c.module).join(', ')}.`);
  } else {
    parts.push(`${moduleCount} module${moduleCount > 1 ? 's' : ''} changed across ${commitCount} commit${commitCount > 1 ? 's' : ''}.`);
  }

  if (removed.length) parts.push(`Removed: ${removed.map((c) => c.module).join(', ')}.`);
  if (added.length) parts.push(`Added: ${added.map((c) => c.module).join(', ')}.`);
  if (moved.length) parts.push(`Moved: ${moved.map((c) => c.detail ?? c.module).join('; ')}.`);

  return parts.join(' ');
}

function computeBlastRadius(deltas: SnapshotDelta[], commits: CommitInfo[]): BlastRadius {
  const heatmap: Record<string, number> = {};
  let modulesAffected = 0;
  let dependenciesChanged = 0;

  for (const delta of deltas) {
    modulesAffected += delta.added.length + delta.removed.length + delta.moved.length + delta.splits.length + delta.merges.length;
    dependenciesChanged += delta.dependencyChanges.added.length + delta.dependencyChanges.removed.length;

    for (const mod of [...delta.added, ...delta.removed]) {
      const root = mod.path.split('/')[0] ?? mod.path;
      heatmap[root] = (heatmap[root] ?? 0) + 1;
    }
  }

  return {
    filesChanged: commits.reduce((sum, c) => sum + c.filesChanged, 0) || deltas.reduce((s, d) => s + d.changedFiles.length, 0),
    modulesAffected,
    dependenciesChanged,
    heatmap,
  };
}

function dedupeChanges(changes: ArchitectureChange[]): ArchitectureChange[] {
  const seen = new Set<string>();
  return changes.filter((c) => {
    const key = `${c.type}:${c.module}:${c.from ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filesFromSnapshots(fromSnap: Snapshot | undefined, toSnap: Snapshot | undefined): string[] {
  const files = new Set<string>();
  for (const mod of [...(fromSnap?.modules ?? []), ...(toSnap?.modules ?? [])]) {
    for (const file of mod.files) files.add(file);
  }
  return [...files];
}

function diffSymbols(fromSnap: Snapshot | undefined, toSnap: Snapshot | undefined, changes: ArchitectureChange[] = []): Evidence[] {
  if (!toSnap) return [];
  const evidence: Evidence[] = [];
  const fromById = new Map((fromSnap?.modules ?? []).map((m) => [m.id, m]));
  const fromByPath = new Map((fromSnap?.modules ?? []).map((m) => [m.path, m]));
  const toIds = new Set(toSnap.modules.map((m) => m.id));

  for (const mod of toSnap.modules) {
    const prev = fromById.get(mod.id) ?? fromByPath.get(mod.path);
    const prevSymbols = new Set(prev?.symbols ?? []);
    for (const symbol of mod.symbols) {
      if (!prevSymbols.has(symbol)) {
        evidence.push({
          kind: 'symbol',
          description: `+ ${mod.name}.${symbol}`,
          symbol: `${mod.name}.${symbol}`,
          module: mod.name,
          file: mod.files[0],
          commit: toSnap.commit,
        });
      }
    }
  }

  for (const mod of fromSnap?.modules ?? []) {
    if (toIds.has(mod.id)) continue;
    const stillThere = toSnap.modules.some((m) => m.path === mod.path);
    if (stillThere) continue;
    for (const symbol of mod.symbols.slice(0, 4)) {
      evidence.push({
        kind: 'symbol',
        description: `− ${mod.name}.${symbol}`,
        symbol: `${mod.name}.${symbol}`,
        module: mod.name,
        file: mod.files[0],
        commit: fromSnap?.commit,
      });
    }
  }

  if (evidence.length === 0) {
    const affected = new Set(changes.map((c) => c.module.toLowerCase()));
    for (const mod of [...(fromSnap?.modules ?? []), ...(toSnap?.modules ?? [])]) {
      if (!affected.has(mod.name.toLowerCase()) && !changes.some((c) => c.moduleId === mod.id)) continue;
      for (const symbol of mod.symbols.slice(0, 3)) {
        evidence.push({
          kind: 'symbol',
          description: `${mod.name}.${symbol}`,
          symbol: `${mod.name}.${symbol}`,
          module: mod.name,
          file: mod.files[0],
          commit: toSnap?.commit,
        });
      }
    }
  }

  return evidence;
}

function averageConfidence(changes: ArchitectureChange[]): number {
  const values = changes.map((c) => c.confidence).filter((n): n is number => typeof n === 'number');
  if (values.length === 0) return 0.7;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

export function buildModuleEvolutions(snapshots: Snapshot[], deltas: SnapshotDelta[]): ModuleEvolution[] {
  const history = new Map<string, ModuleEvolution>();

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    for (const mod of snap.modules) {
      if (!history.has(mod.id)) {
        history.set(mod.id, {
          moduleId: mod.id,
          module: mod.name,
          path: mod.path,
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
      } else {
        history.get(mod.id)!.path = mod.path;
        history.get(mod.id)!.module = mod.name;
      }
    }

    if (i > 0) {
      const delta = deltas[i - 1];
      for (const mv of delta.moved) {
        const existing = history.get(mv.moduleId);
        if (existing) {
          existing.events.push({
            kind: 'moved',
            timestamp: snap.timestamp,
            commit: snap.shortCommit,
            detail: `${mv.from} → ${mv.to}`,
          });
        }
      }
      for (const split of delta.splits) {
        const existing = history.get(split.fromId);
        if (existing) {
          existing.splitInto = split.to;
          existing.events.push({
            kind: 'split',
            timestamp: snap.timestamp,
            commit: snap.shortCommit,
            detail: split.to.join(', '),
            relatedModules: split.to,
          });
        }
        for (const childId of split.toIds) {
          const child = history.get(childId);
          if (child) child.splitFrom = split.from;
        }
      }
      for (const merge of delta.merges) {
        const target = history.get(merge.toId);
        if (target) {
          target.events.push({
            kind: 'merge',
            timestamp: snap.timestamp,
            commit: snap.shortCommit,
            detail: merge.from.join(', '),
            relatedModules: merge.from,
          });
        }
        for (const fromId of merge.fromIds) {
          const src = history.get(fromId);
          if (src) src.mergedInto = merge.to;
        }
      }
      for (const removed of delta.removed) {
        const existing = history.get(removed.id);
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

  const lastSnap = snapshots[snapshots.length - 1];
  if (lastSnap) {
    for (const mod of lastSnap.modules) {
      const evo = history.get(mod.id);
      if (evo) {
        evo.currentDependencies = lastSnap.dependencies
          .filter((d) => d.from === mod.id)
          .map((d) => lastSnap.modules.find((m) => m.id === d.to)?.name ?? d.to);
      }
    }
  }

  return [...history.values()];
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
