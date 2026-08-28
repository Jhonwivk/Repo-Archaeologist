import type {
  Snapshot,
  SnapshotDelta,
  ArchitectureChange,
  ModuleNode,
  DependencyEdge,
} from '@repo-archaeologist/core';

export class ChangeDetector {
  detectDelta(from: Snapshot, to: Snapshot): SnapshotDelta {
    const fromModules = new Map(from.modules.map((m) => [m.id, m]));
    const toModules = new Map(to.modules.map((m) => [m.id, m]));

    const added: ModuleNode[] = [];
    const removed: ModuleNode[] = [];
    const moved: Array<{ module: string; from: string; to: string }> = [];
    const changes: ArchitectureChange[] = [];

    // Detect added modules
    for (const [id, mod] of toModules) {
      if (!fromModules.has(id)) {
        // Check if it's a rename/move by similar name or path
        const similar = findSimilarModule(mod, [...fromModules.values()]);
        if (similar) {
          moved.push({ module: mod.name, from: similar.path, to: mod.path });
          changes.push({
            type: 'moved',
            module: mod.name,
            from: similar.path,
            to: [mod.path],
            detail: `${similar.path} → ${mod.path}`,
          });
        } else {
          added.push(mod);
          changes.push({
            type: 'added',
            module: mod.name,
            detail: `New module at ${mod.path}`,
          });
        }
      }
    }

    // Detect removed modules
    for (const [id, mod] of fromModules) {
      if (!toModules.has(id)) {
        const similar = findSimilarModule(mod, [...toModules.values()]);
        if (!similar) {
          removed.push(mod);
          changes.push({
            type: 'removed',
            module: mod.name,
            detail: `Module removed from ${mod.path}`,
          });
        }
      }
    }

    // Detect splits (one module became multiple)
    for (const removedMod of removed) {
      const candidates = added.filter(
        (a) => a.path.startsWith(removedMod.path) || a.name.includes(removedMod.name)
      );
      if (candidates.length >= 2) {
        changes.push({
          type: 'split',
          module: removedMod.name,
          to: candidates.map((c) => c.name),
          detail: `${removedMod.name} split into ${candidates.map((c) => c.name).join(', ')}`,
        });
      }
    }

    // Detect merges (multiple modules became one)
    for (const addedMod of added) {
      const candidates = removed.filter(
        (r) => addedMod.path.startsWith(r.path.split('/')[0]) || addedMod.name.includes(r.name)
      );
      if (candidates.length >= 2) {
        changes.push({
          type: 'merged',
          module: addedMod.name,
          from: candidates.map((c) => c.name).join(', '),
          detail: `${candidates.map((c) => c.name).join(', ')} merged into ${addedMod.name}`,
        });
      }
    }

    const dependencyChanges = detectDependencyChanges(from.dependencies, to.dependencies);

    return {
      fromSnapshotId: from.id,
      toSnapshotId: to.id,
      added,
      removed,
      moved,
      dependencyChanges,
      changes,
    };
  }
}

function findSimilarModule(target: ModuleNode, candidates: ModuleNode[]): ModuleNode | null {
  for (const c of candidates) {
    if (c.name === target.name) return c;
    if (c.path.endsWith(target.name) || target.path.endsWith(c.name)) return c;
  }
  return null;
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
  if (delta.dependencyChanges.added.length) parts.push(`+${delta.dependencyChanges.added.length} dependencies`);
  return parts.join(', ') || 'No structural changes';
}
