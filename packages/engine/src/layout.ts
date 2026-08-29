import type { Snapshot, GraphPosition, DependencyEdge, ModuleNode } from '@repo-archaeologist/core';

/** Layered layout over the union of all snapshots so node positions stay stable. */
export function computeStableLayout(snapshots: Snapshot[]): Record<string, GraphPosition> {
  const modules = new Map<string, ModuleNode>();
  const edges: DependencyEdge[] = [];
  const seenEdges = new Set<string>();

  for (const snap of snapshots) {
    for (const mod of snap.modules) {
      if (!modules.has(mod.id)) modules.set(mod.id, mod);
    }
    for (const edge of snap.dependencies) {
      const key = `${edge.from}->${edge.to}`;
      if (!seenEdges.has(key)) {
        seenEdges.add(key);
        edges.push(edge);
      }
    }
  }

  return layoutGraph([...modules.values()], edges);
}

export function layoutGraph(modules: ModuleNode[], dependencies: DependencyEdge[]): Record<string, GraphPosition> {
  const positions: Record<string, GraphPosition> = {};
  if (modules.length === 0) return positions;

  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const mod of modules) {
    inDegree.set(mod.id, 0);
    children.set(mod.id, []);
  }
  for (const dep of dependencies) {
    if (inDegree.has(dep.to) && inDegree.has(dep.from)) {
      inDegree.set(dep.to, (inDegree.get(dep.to) ?? 0) + 1);
      children.get(dep.from)?.push(dep.to);
    }
  }

  const layers: string[][] = [];
  const assigned = new Set<string>();
  let currentLayer = modules.filter((m) => (inDegree.get(m.id) ?? 0) === 0).map((m) => m.id);
  if (currentLayer.length === 0) currentLayer = modules.map((m) => m.id);

  while (currentLayer.length > 0) {
    layers.push(currentLayer);
    currentLayer.forEach((id) => assigned.add(id));
    const nextLayer: string[] = [];
    for (const id of currentLayer) {
      for (const child of children.get(id) ?? []) {
        if (!assigned.has(child) && !nextLayer.includes(child)) nextLayer.push(child);
      }
    }
    currentLayer = nextLayer;
  }

  const unassigned = modules.filter((m) => !assigned.has(m.id)).map((m) => m.id);
  if (unassigned.length > 0) layers.push(unassigned);

  const totalLayers = layers.length;
  layers.forEach((layer, layerIdx) => {
    const y = 60 + (layerIdx / Math.max(totalLayers - 1, 1)) * 280;
    const spacing = 800 / (layer.length + 1);
    layer.forEach((id, idx) => {
      positions[id] = { x: spacing * (idx + 1), y };
    });
  });

  return positions;
}
