import type { ReactNode } from 'react';
import type { EvolutionEvent } from '@repo-archaeologist/core';
import { EVENT_TYPE_LABELS, EVENT_TYPE_COLORS, CHANGE_TYPE_ICONS, formatDate } from '../lib/api';

interface Props {
  events: EvolutionEvent[];
  selectedEventId?: string;
  onSelectEvent: (eventId: string) => void;
}

export default function EventPanel({ events, selectedEventId, onSelectEvent }: Props) {
  if (events.length === 0) {
    return (
      <div className="p-4 text-gray-500 text-sm">
        No major evolution events at this point in time.
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">Evolution Events</h3>
      {events.map((event) => (
        <button
          key={event.id}
          onClick={() => onSelectEvent(event.id)}
          className={`w-full text-left p-3 rounded-lg border transition-all duration-200 ${
            selectedEventId === event.id
              ? 'border-archaeologist-500 bg-archaeologist-500/5'
              : 'border-surface-border bg-surface-overlay hover:border-gray-600'
          }`}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${EVENT_TYPE_COLORS[event.type] ?? EVENT_TYPE_COLORS.other}`}>
              {EVENT_TYPE_LABELS[event.type] ?? 'Change'}
            </span>
            <span className="text-xs text-gray-500">{formatDate(event.period.end)}</span>
            {typeof event.confidence === 'number' && (
              <span className="ml-auto text-[10px] text-gray-500">{Math.round(event.confidence * 100)}%</span>
            )}
          </div>
          <p className="text-sm font-medium text-gray-200 mb-1">{event.title}</p>
          <p className="text-xs text-gray-400 line-clamp-2">{event.summary}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {event.changes.slice(0, 4).map((change, i) => (
              <span key={i} className="text-xs font-mono text-gray-500">
                {CHANGE_TYPE_ICONS[change.type] ?? '·'} {change.module}
              </span>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}

interface EventDetailProps {
  event: EvolutionEvent;
  onClose: () => void;
}

export function EventDetail({ event, onClose }: EventDetailProps) {
  return (
    <div className="p-4 animate-slide-up">
      <div className="flex items-start justify-between mb-4">
        <div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${EVENT_TYPE_COLORS[event.type]}`}>
            {EVENT_TYPE_LABELS[event.type]}
          </span>
          <h3 className="text-lg font-semibold text-gray-100 mt-2">{event.title}</h3>
          <p className="text-sm text-gray-400 mt-1">
            {formatDate(event.period.start)} → {formatDate(event.period.end)} · {event.commits.length} commits
          </p>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">&times;</button>
      </div>

      <p className="text-sm text-gray-300 mb-4">{event.summary}</p>

      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs text-gray-500 uppercase tracking-wider">Confidence</span>
        <div className="flex-1 h-1.5 bg-surface-overlay rounded-full overflow-hidden">
          <div className="h-full bg-archaeologist-500" style={{ width: `${Math.round((event.confidence ?? 0.7) * 100)}%` }} />
        </div>
        <span className="text-xs font-mono text-gray-400">{Math.round((event.confidence ?? 0.7) * 100)}%</span>
      </div>

      <Section title="What changed">
        {event.changes.map((change, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-5 text-center font-mono text-gray-400">{CHANGE_TYPE_ICONS[change.type]}</span>
            <span className="text-gray-300">{change.module}</span>
            {change.detail && <span className="text-gray-500 text-xs">— {change.detail}</span>}
          </div>
        ))}
      </Section>

      <Section title="Affected modules">
        <div className="flex flex-wrap gap-1">
          {event.affectedModules.map((m) => (
            <span key={m} className="px-2 py-0.5 rounded bg-surface-overlay text-xs text-gray-300">{m}</span>
          ))}
        </div>
      </Section>

      <Section title="Supporting commits">
        {event.evidence.filter((e) => e.kind === 'commit_message').map((ev, i) => (
          <EvidenceLine key={i} ev={ev} />
        ))}
      </Section>

      {event.changedFiles.length > 0 && (
        <Section title="Changed files">
          {event.changedFiles.slice(0, 12).map((file) => {
            const ev = event.evidence.find((e) => e.file === file);
            return ev?.url ? (
              <a key={file} href={ev.url} target="_blank" rel="noreferrer" className="block text-xs font-mono text-archaeologist-300 hover:text-archaeologist-200 truncate">
                {file}
              </a>
            ) : (
              <div key={file} className="text-xs font-mono text-gray-400 truncate">{file}</div>
            );
          })}
        </Section>
      )}

      <Section title="Evidence">
        {event.evidence.filter((e) => e.kind !== 'commit_message').map((ev, i) => (
          <EvidenceLine key={i} ev={ev} />
        ))}
      </Section>

      {Object.keys(event.blastRadius.heatmap).length > 0 && (
        <Section title="Blast radius">
          {Object.entries(event.blastRadius.heatmap)
            .sort(([, a], [, b]) => b - a)
            .map(([path, count]) => (
              <div key={path} className="flex items-center gap-2 text-xs">
                <span className="w-24 font-mono text-gray-400 truncate">{path}</span>
                <div className="flex-1 h-2 bg-surface-overlay rounded-full overflow-hidden">
                  <div className="h-full bg-archaeologist-500/60 rounded-full" style={{ width: `${Math.min(count * 25, 100)}%` }} />
                </div>
                <span className="text-gray-500 w-6 text-right">{count}</span>
              </div>
            ))}
          <p className="text-xs text-gray-500 mt-2">
            {event.blastRadius.filesChanged} files · {event.blastRadius.modulesAffected} modules · {event.blastRadius.dependenciesChanged} dependency changes
          </p>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">{title}</h4>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function EvidenceLine({ ev }: { ev: EvolutionEvent['evidence'][number] }) {
  const inner = (
    <span>
      {ev.description}
      {ev.ref && <span className="ml-1 font-mono text-gray-500">{ev.ref}</span>}
    </span>
  );
  return (
    <div className="flex items-start gap-2 text-xs text-gray-400">
      <span className="text-gray-600 mt-0.5">├─</span>
      {ev.url ? (
        <a href={ev.url} target="_blank" rel="noreferrer" className="text-archaeologist-300 hover:text-archaeologist-200">
          {inner}
        </a>
      ) : inner}
    </div>
  );
}
