import type { ModuleNode, DependencyEdge, GraphPosition } from '@repo-archaeologist/core';

interface Props {
  modules: ModuleNode[];
  dependencies: DependencyEdge[];
  layout?: Record<string, GraphPosition>;
  highlightModules?: string[];
  previousModules?: ModuleNode[];
  onModuleClick?: (module: ModuleNode) => void;
  title?: string;
}

const MODULE_COLORS = [
  '#4c6ef5', '#748ffc', '#5c7cfa', '#4263eb',
  '#38d9a9', '#20c997', '#12b886',
  '#fcc419', '#fab005', '#fd7e14',
  '#e599f7', '#cc5de8', '#be4bdb',
  '#ff8787', '#fa5252',
];

export default function ArchitectureGraph({
  modules,
  dependencies,
  layout = {},
  highlightModules = [],
  previousModules,
  onModuleClick,
  title,
}: Props) {
  const positions = Object.keys(layout).length > 0 ? layout : computeLayout(modules, dependencies);
  const prevIds = new Set(previousModules?.map((m) => m.id) ?? []);
  const currentIds = new Set(modules.map((m) => m.id));
  const addedIds = new Set([...currentIds].filter((id) => !prevIds.has(id) && prevIds.size > 0));
  const fading = (previousModules ?? []).filter((m) => !currentIds.has(m.id));

  if (modules.length === 0 && fading.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No TypeScript/JavaScript modules detected at this point
      </div>
    );
  }

  const colorOf = (id: string, i: number) => MODULE_COLORS[Math.abs(hashCode(id) || i) % MODULE_COLORS.length];

  return (
    <div className="relative w-full h-full min-h-[280px] overflow-hidden">
      {title && <div className="absolute top-2 left-3 text-xs uppercase tracking-wider text-gray-500 z-10">{title}</div>}
      <svg viewBox="0 0 800 400" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#2a2a3a" />
          </marker>
        </defs>

        {dependencies.map((dep) => {
          const from = positions[dep.from];
          const to = positions[dep.to];
          if (!from || !to) return null;
          return (
            <line
              key={`${dep.from}->${dep.to}`}
              x1={from.x}
              y1={from.y + 24}
              x2={to.x}
              y2={to.y - 24}
              stroke="#4c6ef5"
              strokeOpacity={0.55}
              strokeWidth={Math.min(Math.max(dep.weight, 1), 3)}
              markerEnd="url(#arrowhead)"
            />
          );
        })}

        {fading.map((mod) => {
          const pos = positions[mod.id];
          if (!pos) return null;
          return (
            <g key={`fade-${mod.id}`} transform={`translate(${pos.x - 60}, ${pos.y - 24})`} opacity={0.25}>
              <rect width="120" height="48" rx="8" fill="#1a1a26" stroke="#fa5252" strokeDasharray="4 3" />
              <text x="60" y="28" textAnchor="middle" fill="#fa5252" fontSize="12" fontFamily="Inter, sans-serif">{mod.name}</text>
            </g>
          );
        })}

        {modules.map((mod, i) => {
          const pos = positions[mod.id];
          if (!pos) return null;
          const isHighlighted = highlightModules.includes(mod.name) || highlightModules.includes(mod.id) || highlightModules.includes(mod.path);
          const isNew = addedIds.has(mod.id);
          const color = colorOf(mod.id, i);

          return (
            <g
              key={mod.id}
              transform={`translate(${pos.x - 60}, ${pos.y - 24})`}
              className="cursor-pointer"
              data-module={mod.name}
              onClick={() => onModuleClick?.(mod)}
            >
              <rect
                width="120"
                height="48"
                rx="8"
                fill={isHighlighted ? color : '#1a1a26'}
                stroke={isNew ? '#38d9a9' : isHighlighted ? color : '#2a2a3a'}
                strokeWidth={isNew || isHighlighted ? 2 : 1}
                className={isNew ? 'animate-fade-in' : ''}
              />
              <text x="60" y="22" textAnchor="middle" fill={isHighlighted || isNew ? '#fff' : '#c1c2c5'} fontSize="13" fontWeight="600" fontFamily="Inter, sans-serif">
                {mod.name}
              </text>
              <text x="60" y="38" textAnchor="middle" fill={isHighlighted || isNew ? '#ffffff99' : '#666'} fontSize="10" fontFamily="JetBrains Mono, monospace">
                {mod.fileCount} files · {mod.linesOfCode} LOC
              </text>
              {isNew && <text x="110" y="12" fill="#38d9a9" fontSize="14" fontWeight="bold">+</text>}
            </g>
          );
        })}
      </svg>

      {(addedIds.size > 0 || fading.length > 0) && (
        <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 text-xs">
          {[...addedIds].map((id) => {
            const found = modules.find((m) => m.id === id);
            return found ? (
              <span key={id} className="px-2 py-1 rounded bg-emerald-400/10 text-emerald-400">+ {found.name}</span>
            ) : null;
          })}
          {fading.map((m) => (
            <span key={m.id} className="px-2 py-1 rounded bg-red-400/10 text-red-400">− {m.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
}

export function computeLayout(
  modules: ModuleNode[],
  dependencies: DependencyEdge[]
): Record<string, GraphPosition> {
  const positions: Record<string, GraphPosition> = {};
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const mod of modules) {
    inDegree.set(mod.id, 0);
    children.set(mod.id, []);
  }
  for (const dep of dependencies) {
    if (inDegree.has(dep.to)) inDegree.set(dep.to, (inDegree.get(dep.to) ?? 0) + 1);
    children.get(dep.from)?.push(dep.to);
  }

  const layers: string[][] = [];
  const assigned = new Set<string>();
  let currentLayer = modules.filter((m) => (inDegree.get(m.id) ?? 0) === 0).map((m) => m.id);
  if (currentLayer.length === 0) currentLayer = modules.map((m) => m.id);

  while (currentLayer.length > 0) {
    layers.push(currentLayer);
    currentLayer.forEach((id) => assigned.add(id));
    const next: string[] = [];
    for (const id of currentLayer) {
      for (const child of children.get(id) ?? []) {
        if (!assigned.has(child) && !next.includes(child)) next.push(child);
      }
    }
    currentLayer = next;
  }
  const unassigned = modules.filter((m) => !assigned.has(m.id)).map((m) => m.id);
  if (unassigned.length) layers.push(unassigned);

  layers.forEach((layer, layerIdx) => {
    const y = 60 + (layerIdx / Math.max(layers.length - 1, 1)) * 280;
    const spacing = 800 / (layer.length + 1);
    layer.forEach((id, idx) => {
      positions[id] = { x: spacing * (idx + 1), y };
    });
  });
  return positions;
}
