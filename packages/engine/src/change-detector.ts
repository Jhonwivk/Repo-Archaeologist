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
const GENERIC_FILE_NAMES = new Set([
  'index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mts', 'index.cts',
  'mod.ts', 'mod.js', 'main.ts', 'main.js',
]);

export class ChangeDetector {
  detectDelta(
    from: Snapshot,
    to: Snapshot,
    renamedFiles: GitRename[] = [],
    changedFiles: string[] = []
  ): SnapshotDelta {
    const fromContext = { modules: from.modules, dependencies: from.dependencies };
    const toContext = { modules: to.modules, dependencies: to.dependencies };
    const matches = matchModules(from.modules, to.modules, renamedFiles, fromContext, toContext);
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
      renamedFiles,
      fromContext,
      toContext
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
  renamedFiles: GitRename[],
  fromContext: { modules: ModuleNode[]; dependencies: DependencyEdge[] },
  toContext: { modules: ModuleNode[]; dependencies: DependencyEdge[] }
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
      .map((child) => ({
        child,
        overlap: fileOverlap(parent, child, renameMap, fromContext, toContext),
        evidence: transferEvidence(parent, child, renameMap),
      }))
      .filter((x) => x.evidence.size > 0)
      .filter((x) => x.overlap >= 0.2)
      .sort((a, b) => b.overlap - a.overlap);

    const distinctChildren = children.filter((candidate) =>
      [...candidate.evidence].some((item) =>
        children.filter((other) => other.evidence.has(item)).length === 1
      )
    );

    if (distinctChildren.length >= 2) {
      const covered = distinctChildren.reduce((s, c) => s + c.overlap, 0);
      const confidence = Math.min(0.95, 0.45 + covered / distinctChildren.length);
      if (confidence >= SPLIT_CONFIDENCE_MIN) {
        splits.push({
          from: parent.name,
          fromId: parent.id,
          to: distinctChildren.map((c) => c.child.name),
          toIds: distinctChildren.map((c) => c.child.id),
          confidence,
        });
        consumedFrom.add(parent.id);
        for (const c of distinctChildren) consumedTo.add(c.child.id);
      }
    }
  }

  for (const child of added) {
    if (consumedTo.has(child.id)) continue;
    const parents = removed
      .filter((p) => !consumedFrom.has(p.id))
      .map((parent) => ({
        parent,
        overlap: fileOverlap(parent, child, renameMap, fromContext, toContext),
        evidence: transferEvidence(parent, child, renameMap),
      }))
      .filter((x) => x.evidence.size > 0)
      .filter((x) => x.overlap >= 0.2)
      .sort((a, b) => b.overlap - a.overlap);

    const distinctParents = parents.filter((candidate) =>
      [...candidate.evidence].some((item) =>
        parents.filter((other) => other.evidence.has(item)).length === 1
      )
    );

    if (distinctParents.length >= 2) {
      const confidence = Math.min(
        0.95,
        0.45 + distinctParents.reduce((s, p) => s + p.overlap, 0) / distinctParents.length
      );
      if (confidence >= MERGE_CONFIDENCE_MIN) {
        merges.push({
          from: distinctParents.map((p) => p.parent.name),
          fromIds: distinctParents.map((p) => p.parent.id),
          to: child.name,
          toId: child.id,
          confidence,
        });
        consumedTo.add(child.id);
        for (const p of distinctParents) consumedFrom.add(p.parent.id);
      }
    }
  }

  return { splits, merges, consumedFrom, consumedTo };
}

function fileOverlap(
  a: ModuleNode,
  b: ModuleNode,
  renameMap: Map<string, string>,
  fromContext: { modules: ModuleNode[]; dependencies: DependencyEdge[] },
  toContext: { modules: ModuleNode[]; dependencies: DependencyEdge[] }
): number {
  return overlapScore(a, b, renameMap, fromContext, toContext);
}

function transferEvidence(
  from: ModuleNode,
  to: ModuleNode,
  renameMap: Map<string, string>
): Set<string> {
  const evidence = new Set<string>();
  for (const file of from.files) {
    const destination = renameMap.get(file);
    if (destination && to.files.includes(destination)) evidence.add(`file:${file}`);
    const name = file.split('/').pop() ?? file;
    if (!GENERIC_FILE_NAMES.has(name) && to.files.some((candidate) => candidate.endsWith(`/${name}`))) {
      evidence.add(`name:${name}`);
    }
  }
  for (const symbol of from.symbols) {
    if (to.symbols.includes(symbol)) evidence.add(`symbol:${symbol}`);
  }
  return evidence;
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
