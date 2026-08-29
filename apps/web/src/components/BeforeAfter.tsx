import type { EvolutionEvent, ModuleEvolution, RepositoryAnalysis } from '@repo-archaeologist/core';
import ArchitectureGraph from './ArchitectureGraph';

interface Props {
  analysis: RepositoryAnalysis;
  event: EvolutionEvent;
  onModuleClick?: (id: string) => void;
}

export default function BeforeAfter({ analysis, event, onModuleClick }: Props) {
  const from = analysis.snapshots.find((s) => s.id === event.fromSnapshotId)
    ?? analysis.snapshots[Math.max(0, analysis.snapshots.findIndex((s) => s.id === event.toSnapshotId) - 1)];
  const to = analysis.snapshots.find((s) => s.id === event.toSnapshotId)
    ?? analysis.snapshots[analysis.snapshots.length - 1];

  if (!from || !to) return null;

  const highlight = event.affectedModules;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 h-full min-h-[320px]">
      <div className="card overflow-hidden">
        <ArchitectureGraph
          title={`Before · ${from.shortCommit}`}
          modules={from.modules}
          dependencies={from.dependencies}
          layout={analysis.layout}
          highlightModules={highlight}
          onModuleClick={(m) => onModuleClick?.(m.id)}
        />
      </div>
      <div className="card overflow-hidden">
        <ArchitectureGraph
          title={`After · ${to.shortCommit}`}
          modules={to.modules}
          dependencies={to.dependencies}
          layout={analysis.layout}
          highlightModules={highlight}
          previousModules={from.modules}
          onModuleClick={(m) => onModuleClick?.(m.id)}
        />
      </div>
    </div>
  );
}

interface GenealogyProps {
  evolution: ModuleEvolution;
  onClose: () => void;
}

export function GenealogyPanel({ evolution, onClose }: GenealogyProps) {
  return (
    <div className="p-4 animate-slide-up">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500">Module genealogy</p>
          <h3 className="text-lg font-semibold text-gray-100">{evolution.module}</h3>
          <p className="text-xs font-mono text-gray-500">{evolution.path}</p>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">&times;</button>
      </div>

      <pre className="text-xs font-mono text-gray-300 bg-surface-overlay rounded-lg p-3 overflow-x-auto mb-4">
{`${evolution.module}
${evolution.events.map((e, i) => `${i === evolution.events.length - 1 ? '└─' : '├─'} ${e.kind}${e.detail ? `: ${e.detail}` : ''}  (${e.commit})`).join('\n')}`}
      </pre>

      <dl className="space-y-2 text-sm">
        {evolution.bornAt && (
          <div className="flex justify-between gap-4">
            <dt className="text-gray-500">Born</dt>
            <dd className="text-gray-200 font-mono">{evolution.bornAt.slice(0, 10)} · {evolution.bornCommit}</dd>
          </div>
        )}
        {evolution.splitInto && (
          <div className="flex justify-between gap-4">
            <dt className="text-gray-500">Split into</dt>
            <dd className="text-purple-300">{evolution.splitInto.join(', ')}</dd>
          </div>
        )}
        {evolution.splitFrom && (
          <div className="flex justify-between gap-4">
            <dt className="text-gray-500">Split from</dt>
            <dd className="text-purple-300">{evolution.splitFrom}</dd>
          </div>
        )}
        {evolution.mergedInto && (
          <div className="flex justify-between gap-4">
            <dt className="text-gray-500">Merged into</dt>
            <dd className="text-pink-300">{evolution.mergedInto}</dd>
          </div>
        )}
        {evolution.removedAt && (
          <div className="flex justify-between gap-4">
            <dt className="text-gray-500">Removed</dt>
            <dd className="text-red-300">{evolution.removedAt.slice(0, 10)}</dd>
          </div>
        )}
        <div>
          <dt className="text-gray-500 mb-1">Current dependencies</dt>
          <dd className="flex flex-wrap gap-1">
            {evolution.currentDependencies.length === 0 && <span className="text-gray-600">none</span>}
            {evolution.currentDependencies.map((d) => (
              <span key={d} className="px-2 py-0.5 rounded bg-surface-overlay text-gray-300 text-xs">{d}</span>
            ))}
          </dd>
        </div>
      </dl>
    </div>
  );
}
