import type {
  Snapshot,
  SnapshotDelta,
  ArchitectureChange,
  ModuleNode,
  DependencyEdge,
} from '@repo-archaeologist/core';
import type { GitRename } from './git/types.js';
import { matchModules, overlapScore } from './module-identity.js';

const SPLIT_CONFIDENCE_MIN = 0.55;
const MERGE_CONFIDENCE_MIN = 0.55;

export class ChangeDetector {
  detectDelta(
    from: Snapshot,
    to: Snapshot,
    renamedFiles: GitRename[] = [],
    changedFiles: string[] = []
  ): SnapshotDelta {
    const matches = matchModules(from.modules, to.modules, renamedFiles);
    const matchedFrom = new Set(matches.map((m) => m.from.id));
    const matchedTo = new Set(matches.map((m) => m.to.id));

    const moved: SnapshotDelta['moved'] = [];
    const renamed: SnapshotDelta['renamed'] = [];
    const changes: ArchitectureChange[] = [];

    for (const match of matches) {
      if (match.from.path !== match.to.path) {
        moved.push({
          module: match.to.name,
          moduleId: match.to.id,
          from: match.from.path,
          to: match.to.path,
          confidence: match.confidence,
        });
        changes.push({
          type: 'moved',
          module: match.to.name,
          moduleId: match.to.id,
          from: match.from.path,
          to: [match.to.path],
          detail: `${match.from.path} → ${match.to.path}`,
          confidence: match.confidence,
        });
      }
      if (match.from.name !== match.to.name && match.from.path === match.to.path) {
        renamed.push({
          module: match.to.name,
          moduleId: match.to.id,
          from: match.from.name,
          to: match.to.name,
          confidence: match.confidence,
        });
        changes.push({
          type: 'renamed',
          module: match.to.name,
          moduleId: match.to.id,
          from: match.from.name,
          to: [match.to.name],
          detail: `${match.from.name} → ${match.to.name}`,
          confidence: match.confidence,
        });
      }
    }

    const unmatchedFrom = from.modules.filter((m) => !matchedFrom.has(m.id));
    const unmatchedTo = to.modules.filter((m) => !matchedTo.has(m.id));

    const { splits, merges, consumedFrom, consumedTo } = detectSplitsAndMerges(
      unmatchedFrom,
      unmatchedTo,
      renamedFiles
    );

    const added = unmatchedTo.filter((m) => !consumedTo.has(m.id));
    const removed = unmatchedFrom.filter((m) => !consumedFrom.has(m.id));

    for (const split of splits) {
      changes.push({
        type: 'split',
        module: split.from,
        moduleId: split.fromId,
        to: split.to,
        detail: `${split.from} split into ${split.to.join(', ')}`,
        confidence: split.confidence,
      });
    }

    for (const merge of merges) {
      changes.push({
        type: 'merged',
        module: merge.to,
        moduleId: merge.toId,
        from: merge.from.join(', '),
        to: [merge.to],
        detail: `${merge.from.join(', ')} merged into ${merge.to}`,
        confidence: merge.confidence,
      });
    }

    for (const mod of added) {
      changes.push({
        type: 'added',
        module: mod.name,
        moduleId: mod.id,
        detail: `New module at ${mod.path}`,
        confidence: 0.9,
      });
    }

    for (const mod of removed) {
      changes.push({
        type: 'removed',
        module: mod.name,
        moduleId: mod.id,
        detail: `Module removed from ${mod.path}`,
        confidence: 0.9,
      });
    }

    return {
      fromSnapshotId: from.id,
      toSnapshotId: to.id,
      added,
      removed,
      moved,
      renamed,
      splits,
      merges,
      dependencyChanges: detectDependencyChanges(from.dependencies, to.dependencies),
      changes,
      changedFiles,
    };
  }
}

function detectSplitsAndMerges(
  removed: ModuleNode[],
  added: ModuleNode[],
  renamedFiles: GitRename[]
): {
  splits: SnapshotDelta['splits'];
  merges: SnapshotDelta['merges'];
  consumedFrom: Set<string>;
  consumedTo: Set<string>;
} {
  const splits: SnapshotDelta['splits'] = [];
  const merges: SnapshotDelta['merges'] = [];
  const consumedFrom = new Set<string>();
  const consumedTo = new Set<string>();
  const renameMap = new Map(renamedFiles.map((r) => [r.from, r.to]));

  for (const parent of removed) {
    const children = added
      .map((child) => ({ child, overlap: fileOverlap(parent, child, renameMap) }))
      .filter((x) => x.overlap >= 0.2)
      .sort((a, b) => b.overlap - a.overlap);

    if (children.length >= 2) {
      const covered = children.reduce((s, c) => s + c.overlap, 0);
      const confidence = Math.min(0.95, 0.45 + covered / children.length);
      if (confidence >= SPLIT_CONFIDENCE_MIN) {
        splits.push({
          from: parent.name,
          fromId: parent.id,
          to: children.map((c) => c.child.name),
          toIds: children.map((c) => c.child.id),
          confidence,
        });
        consumedFrom.add(parent.id);
        for (const c of children) consumedTo.add(c.child.id);
      }
    }
  }

  for (const child of added) {
    if (consumedTo.has(child.id)) continue;
    const parents = removed
      .filter((p) => !consumedFrom.has(p.id))
      .map((parent) => ({ parent, overlap: fileOverlap(parent, child, renameMap) }))
      .filter((x) => x.overlap >= 0.2)
      .sort((a, b) => b.overlap - a.overlap);

    if (parents.length >= 2) {
      const confidence = Math.min(0.95, 0.45 + parents.reduce((s, p) => s + p.overlap, 0) / parents.length);
      if (confidence >= MERGE_CONFIDENCE_MIN) {
        merges.push({
          from: parents.map((p) => p.parent.name),
          fromIds: parents.map((p) => p.parent.id),
          to: child.name,
          toId: child.id,
          confidence,
        });
        consumedTo.add(child.id);
        for (const p of parents) consumedFrom.add(p.parent.id);
      }
    }
  }

  return { splits, merges, consumedFrom, consumedTo };
}

function fileOverlap(a: ModuleNode, b: ModuleNode, renameMap: Map<string, string>): number {
  return overlapScore(a, b, renameMap);
}

function detectDependencyChanges(
  from: DependencyEdge[],
  to: DependencyEdge[]
): { added: DependencyEdge[]; removed: DependencyEdge[] } {
  const fromSet = new Set(from.map((e) => `${e.from}->${e.to}`));
  const toSet = new Set(to.map((e) => `${e.from}->${e.to}`));
  return {
    added: to.filter((e) => !fromSet.has(`${e.from}->${e.to}`)),
    removed: from.filter((e) => !toSet.has(`${e.from}->${e.to}`)),
  };
}

export function summarizeDelta(delta: SnapshotDelta): string {
  const parts: string[] = [];
  if (delta.added.length) parts.push(`+${delta.added.length} modules`);
  if (delta.removed.length) parts.push(`-${delta.removed.length} modules`);
  if (delta.moved.length) parts.push(`${delta.moved.length} moved`);
  if (delta.splits.length) parts.push(`${delta.splits.length} split`);
  if (delta.merges.length) parts.push(`${delta.merges.length} merged`);
  if (delta.dependencyChanges.added.length) parts.push(`+${delta.dependencyChanges.added.length} dependencies`);
  return parts.join(', ') || 'No structural changes';
}
