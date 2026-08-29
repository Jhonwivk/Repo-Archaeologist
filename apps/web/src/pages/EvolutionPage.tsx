import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { RepositoryAnalysis } from '@repo-archaeologist/core';
import { graphStructure } from '@repo-archaeologist/core';
import { fetchDemo, fetchAnalysis, fetchProgress, getSnapshotAtIndex, formatDate } from '../lib/api';
import Timeline from '../components/Timeline';
import ArchitectureGraph from '../components/ArchitectureGraph';
import EventPanel, { EventDetail } from '../components/EventPanel';
import { GenealogyPanel } from '../components/BeforeAfter';

export default function EvolutionPage() {
  const { id } = useParams<{ id: string }>();
  const [analysis, setAnalysis] = useState<RepositoryAnalysis | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>();
  const [selectedModuleId, setSelectedModuleId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ stage: 'loading', progress: 0, message: 'Loading...' });
  const [isPlaying, setIsPlaying] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      setLoading(true);
      try {
        if (id === 'demo' || id === 'evolution-lab') {
          const data = await fetchAnalysis(id).catch(() => (id === 'demo' ? fetchDemo() : Promise.reject()));
          setAnalysis(data);
          setCurrentIndex(Math.max(0, data.snapshots.length - 1));
          setLoading(false);
          return;
        }

        const poll = async () => {
          try {
            const data = await fetchAnalysis(id);
            setAnalysis(data);
            setCurrentIndex(Math.max(0, data.snapshots.length - 1));
            setLoading(false);
          } catch (err) {
            if (err instanceof Error && err.message === 'IN_PROGRESS') {
              const prog = await fetchProgress(id);
              setProgress(prog);
              if (prog.stage === 'error') {
                setLoading(false);
                return;
              }
              setTimeout(poll, 2000);
            } else {
              setLoading(false);
            }
          }
        };
        poll();
      } catch {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  const handleReplay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      if (playRef.current) clearInterval(playRef.current);
      return;
    }

    setIsPlaying(true);
    setSelectedEventId(undefined);
    setCurrentIndex(0);
    let idx = 0;

    playRef.current = setInterval(() => {
      idx++;
      if (idx >= (analysis?.snapshots.length ?? 0)) {
        setIsPlaying(false);
        if (playRef.current) clearInterval(playRef.current);
        return;
      }
      setCurrentIndex(idx);
    }, 1500);
  }, [isPlaying, analysis]);

  useEffect(() => {
    return () => {
      if (playRef.current) clearInterval(playRef.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!analysis) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedEventId(undefined);
        setCurrentIndex((i) => Math.max(0, i - 1));
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedEventId(undefined);
        setCurrentIndex((i) => Math.min(analysis.snapshots.length - 1, i + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [analysis]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 border-2 border-archaeologist-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">{progress.message}</p>
        {progress.progress > 0 && (
          <div className="w-64 h-1.5 bg-surface-overlay rounded-full overflow-hidden">
            <div className="h-full bg-archaeologist-500 rounded-full transition-all duration-500" style={{ width: `${progress.progress}%` }} />
          </div>
        )}
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-gray-400">Analysis not found or failed.</p>
        <Link to="/" className="btn-secondary">Back to home</Link>
      </div>
    );
  }

  const snapshot = getSnapshotAtIndex(analysis, currentIndex);
  const prevSnapshot = currentIndex > 0 ? analysis.snapshots[currentIndex - 1] : undefined;
  const selectedEvent = selectedEventId
    ? analysis.evolutionEvents.find((e) => e.id === selectedEventId)
    : undefined;
  const selectedGenealogy = selectedModuleId
    ? analysis.moduleEvolutions.find((m) => m.moduleId === selectedModuleId || m.module === selectedModuleId)
    : undefined;

  const highlightModules = selectedEvent?.affectedModules ?? [];
  const structure = graphStructure(snapshot);

  const selectEvent = (eventId: string) => {
    setSelectedEventId(eventId);
    setSelectedModuleId(undefined);
    const event = analysis.evolutionEvents.find((e) => e.id === eventId);
    if (!event) return;
    const idx = analysis.snapshots.findIndex((s) => s.id === event.toSnapshotId);
    if (idx >= 0) setCurrentIndex(idx);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-surface-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-gray-500 hover:text-gray-300 transition-colors text-sm">← Back</Link>
          <div>
            <h1 className="text-sm font-semibold text-gray-200">{analysis.owner}/{analysis.name}</h1>
            <p className="text-xs text-gray-500">
              {analysis.totalCommits} commits · {analysis.snapshots.length} snapshots · {analysis.evolutionEvents.length} events
              {analysis.language ? ` · ${analysis.language}` : ''}
            </p>
          </div>
        </div>

        <button
          onClick={handleReplay}
          className={`btn-secondary flex items-center gap-2 text-sm ${isPlaying ? 'border-archaeologist-500 text-archaeologist-400' : ''}`}
        >
          {isPlaying ? '⏸ Pause' : '▶ Replay Evolution'}
        </button>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-6 pt-4 pb-2">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider">Architecture at this commit</h2>
            <p className="text-sm text-gray-400 mt-0.5">{snapshot.message}</p>
            <p className="text-xs font-mono text-gray-500 mt-1" data-testid="architecture-structure">
              {structure.nodes.length} modules · {structure.edges.length} edges · {structure.nodes.join(' · ') || 'empty'}
            </p>
          </div>

          <div className="flex-1 card mx-4 mb-4 min-h-[360px]" data-snapshot={snapshot.id} data-fingerprint={snapshot.fingerprint}>
            <ArchitectureGraph
              key={snapshot.fingerprint || snapshot.id}
              modules={snapshot.modules}
              dependencies={snapshot.dependencies}
              layout={analysis.layout}
              highlightModules={highlightModules}
              previousModules={prevSnapshot?.modules}
              onModuleClick={(m) => setSelectedModuleId(m.id)}
            />
          </div>

          <div className="border-t border-surface-border bg-surface-raised">
            <Timeline
              timeline={analysis.timeline}
              currentIndex={currentIndex}
              onIndexChange={(i) => {
                setCurrentIndex(i);
                setSelectedEventId(undefined);
              }}
              isPlaying={isPlaying}
            />
          </div>
        </div>

        <div className="w-full lg:w-[26rem] border-t lg:border-t-0 lg:border-l border-surface-border bg-surface-raised overflow-y-auto max-h-[50vh] lg:max-h-none">
          {selectedGenealogy ? (
            <GenealogyPanel evolution={selectedGenealogy} onClose={() => setSelectedModuleId(undefined)} />
          ) : selectedEvent ? (
            <EventDetail event={selectedEvent} onClose={() => setSelectedEventId(undefined)} />
          ) : (
            <>
              <EventPanel
                events={analysis.evolutionEvents}
                selectedEventId={selectedEventId}
                onSelectEvent={selectEvent}
              />
              {currentIndex > 0 && analysis.deltas[currentIndex - 1]?.changes.length > 0 && (
                <div className="p-4 border-t border-surface-border">
                  <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                    Graph delta since {formatDate(analysis.snapshots[currentIndex - 1].timestamp)}
                  </h3>
                  <div className="space-y-1">
                    {analysis.deltas[currentIndex - 1].changes.map((change, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className={`font-mono ${
                          change.type === 'added' ? 'text-emerald-400' :
                          change.type === 'removed' ? 'text-red-400' :
                          'text-amber-400'
                        }`}>
                          {change.type === 'added' ? '+' : change.type === 'removed' ? '−' : '↗'}
                        </span>
                        <span className="text-gray-300">{change.module}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
