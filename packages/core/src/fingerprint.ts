import type { Snapshot, DependencyEdge, ModuleNode } from './types.js';

export function snapshotFingerprint(snapshot: Pick<Snapshot, 'modules' | 'dependencies'>): string {
  const modules = snapshot.modules.map((m) => m.path).sort().join(',');
  const edges = snapshot.dependencies.map(edgeKey).sort().join(',');
  return `${modules}::${edges}`;
}

export function graphStructure(snapshot: Pick<Snapshot, 'modules' | 'dependencies'>): {
  nodes: string[];
  edges: string[];
} {
  return {
    nodes: snapshot.modules.map((m) => m.name).sort(),
    edges: snapshot.dependencies.map(edgeKey).sort(),
  };
}

export function edgeKey(edge: DependencyEdge): string {
  return `${edge.from}->${edge.to}`;
}

export function moduleLookup(modules: ModuleNode[]): Map<string, ModuleNode> {
  return new Map(modules.map((m) => [m.id, m]));
}
