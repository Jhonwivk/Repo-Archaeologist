import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { RepositoryAnalysis } from '@repo-archaeologist/core';
import { fetchDemo, fetchAnalysis, fetchProgress, getSnapshotAtIndex, formatDate } from '../lib/api';
import Timeline from '../components/Timeline';
import ArchitectureGraph from '../components/ArchitectureGraph';
import EventPanel, { EventDetail } from '../components/EventPanel';

export default function EvolutionPage() {
  const { id } = useParams<{ id: string }>();
  const [analysis, setAnalysis] = useState<RepositoryAnalysis | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ stage: 'loading', progress: 0, message: 'Loading...' });
  const [isPlaying, setIsPlaying] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      setLoading(true);
      try {
        if (id === 'demo') {
          const data = await fetchDemo();
          setAnalysis(data);
          setCurrentIndex(data.snapshots.length - 1);
          setLoading(false);
          return;
        }

        // Poll for real analysis
        const poll = async () => {
          try {
            const data = await fetchAnalysis(id);
            setAnalysis(data);
            setCurrentIndex(data.snapshots.length - 1);
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

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 border-2 border-archaeologist-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">{progress.message}</p>
        {progress.progress > 0 && (
          <div className="w-64 h-1.5 bg-surface-overlay rounded-full overflow-hidden">
            <div
              className="h-full bg-archaeologist-500 rounded-full transition-all duration-500"
              style={{ width: `${progress.progress}%` }}
            />
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

  const highlightModules = selectedEvent?.affectedModules ?? [];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-surface-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-gray-500 hover:text-gray-300 transition-colors text-sm">
            ← Back
          </Link>
          <div>
            <h1 className="text-sm font-semibold text-gray-200">
              {analysis.owner}/{analysis.name}
            </h1>
            <p className="text-xs text-gray-500">
              {analysis.totalCommits} commits · {analysis.snapshots.length} snapshots · {analysis.evolutionEvents.length} events
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

      {/* Main content */}
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Architecture graph */}
        <div className="flex-1 flex flex-col">
          <div className="px-6 pt-4 pb-2">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider">Architecture Snapshot</h2>
            <p className="text-sm text-gray-400 mt-0.5">{snapshot.message}</p>
          </div>

          <div className="flex-1 card mx-4 mb-4 min-h-[360px]">
            <ArchitectureGraph
              modules={snapshot.modules}
              dependencies={snapshot.dependencies}
              highlightModules={highlightModules}
              previousModules={prevSnapshot?.modules}
            />
          </div>

          {/* Timeline */}
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

        {/* Side panel */}
        <div className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-surface-border bg-surface-raised overflow-y-auto max-h-[50vh] lg:max-h-none">
          {selectedEvent ? (
            <EventDetail event={selectedEvent} onClose={() => setSelectedEventId(undefined)} />
          ) : (
            <>
              <EventPanel
                events={analysis.evolutionEvents}
                selectedEventId={selectedEventId}
                onSelectEvent={setSelectedEventId}
              />

              {/* Delta summary for current transition */}
              {currentIndex > 0 && analysis.deltas[currentIndex - 1]?.changes.length > 0 && (
                <div className="p-4 border-t border-surface-border">
                  <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                    Changes since {formatDate(analysis.snapshots[currentIndex - 1].timestamp)}
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
