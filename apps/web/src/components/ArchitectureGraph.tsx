import type { ModuleNode, DependencyEdge } from '@repo-archaeologist/core';

interface Props {
  modules: ModuleNode[];
  dependencies: DependencyEdge[];
  highlightModules?: string[];
  previousModules?: ModuleNode[];
}

const MODULE_COLORS = [
  '#4c6ef5', '#748ffc', '#5c7cfa', '#4263eb',
  '#38d9a9', '#20c997', '#12b886',
  '#fcc419', '#fab005', '#fd7e14',
  '#e599f7', '#cc5de8', '#be4bdb',
  '#ff8787', '#fa5252',
];

export default function ArchitectureGraph({ modules, dependencies, highlightModules = [], previousModules }: Props) {
  if (modules.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No modules detected at this point in history
      </div>
    );
  }

  const positions = computeLayout(modules, dependencies);
  const prevIds = new Set(previousModules?.map((m) => m.id) ?? []);
  const currentIds = new Set(modules.map((m) => m.id));

  const addedIds = new Set([...currentIds].filter((id) => !prevIds.has(id)));
  const removedNames = previousModules?.filter((m) => !currentIds.has(m.id)).map((m) => m.name) ?? [];

  return (
    <div className="relative w-full h-full min-h-[320px] overflow-hidden">
      <svg viewBox="0 0 800 400" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        {/* Edges */}
        {dependencies.map((dep, i) => {
          const from = positions.get(dep.from);
          const to = positions.get(dep.to);
          if (!from || !to) return null;
          return (
            <line
              key={`edge-${i}`}
              x1={from.x}
              y1={from.y + 24}
              x2={to.x}
              y2={to.y - 24}
              stroke="#2a2a3a"
              strokeWidth={Math.min(dep.weight, 3)}
              markerEnd="url(#arrowhead)"
            />
          );
        })}

        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#2a2a3a" />
          </marker>
        </defs>

        {/* Nodes */}
        {modules.map((mod, i) => {
          const pos = positions.get(mod.id);
          if (!pos) return null;
          const isHighlighted = highlightModules.includes(mod.name) || highlightModules.includes(mod.id);
          const isNew = addedIds.has(mod.id);
          const color = MODULE_COLORS[i % MODULE_COLORS.length];

          return (
            <g key={mod.id} transform={`translate(${pos.x - 60}, ${pos.y - 24})`} className="animate-fade-in">
              <rect
                width="120"
                height="48"
                rx="8"
                fill={isHighlighted ? color : '#1a1a26'}
                stroke={isNew ? color : isHighlighted ? color : '#2a2a3a'}
                strokeWidth={isNew || isHighlighted ? 2 : 1}
                className="transition-all duration-300"
              />
              <text
                x="60"
                y="22"
                textAnchor="middle"
                fill={isHighlighted || isNew ? '#fff' : '#c1c2c5'}
                fontSize="13"
                fontWeight="600"
                fontFamily="Inter, sans-serif"
              >
                {mod.name}
              </text>
              <text
                x="60"
                y="38"
                textAnchor="middle"
                fill={isHighlighted || isNew ? '#ffffff99' : '#666'}
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {mod.fileCount} files · {mod.linesOfCode} LOC
              </text>
              {isNew && (
                <text x="110" y="12" fill={color} fontSize="14" fontWeight="bold">+</text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend for changes */}
      {(addedIds.size > 0 || removedNames.length > 0) && (
        <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 text-xs">
          {[...addedIds].map((id) => {
            const mod = modules.find((m) => m.id === id);
            return mod ? (
              <span key={id} className="px-2 py-1 rounded bg-emerald-400/10 text-emerald-400">
                + {mod.name}
              </span>
            ) : null;
          })}
          {removedNames.map((name) => (
            <span key={name} className="px-2 py-1 rounded bg-red-400/10 text-red-400">
              − {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function computeLayout(
  modules: ModuleNode[],
  dependencies: DependencyEdge[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Build adjacency for layering
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const mod of modules) {
    inDegree.set(mod.id, 0);
    children.set(mod.id, []);
  }
  for (const dep of dependencies) {
    if (inDegree.has(dep.to)) {
      inDegree.set(dep.to, (inDegree.get(dep.to) ?? 0) + 1);
    }
    children.get(dep.from)?.push(dep.to);
  }

  // Assign layers via BFS from roots
  const layers: string[][] = [];
  const assigned = new Set<string>();
  let currentLayer = modules.filter((m) => (inDegree.get(m.id) ?? 0) === 0).map((m) => m.id);

  if (currentLayer.length === 0) {
    currentLayer = modules.map((m) => m.id);
  }

  while (currentLayer.length > 0) {
    layers.push(currentLayer);
    currentLayer.forEach((id) => assigned.add(id));
    const nextLayer: string[] = [];
    for (const id of currentLayer) {
      for (const child of children.get(id) ?? []) {
        if (!assigned.has(child) && !nextLayer.includes(child)) {
          nextLayer.push(child);
        }
      }
    }
    currentLayer = nextLayer;
  }

  // Place unassigned modules in last layer
  const unassigned = modules.filter((m) => !assigned.has(m.id)).map((m) => m.id);
  if (unassigned.length > 0) layers.push(unassigned);

  const totalLayers = layers.length;
  layers.forEach((layer, layerIdx) => {
    const y = 60 + (layerIdx / Math.max(totalLayers - 1, 1)) * 280;
    const spacing = 800 / (layer.length + 1);
    layer.forEach((id, idx) => {
      positions.set(id, { x: spacing * (idx + 1), y });
    });
  });

  return positions;
}
