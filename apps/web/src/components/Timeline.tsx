import type { TimelinePoint } from '@repo-archaeologist/core';

interface Props {
  timeline: TimelinePoint[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  isPlaying?: boolean;
}

export default function Timeline({ timeline, currentIndex, onIndexChange, isPlaying }: Props) {
  if (timeline.length === 0) return null;

  const current = timeline[currentIndex];
  const max = Math.max(timeline.length - 1, 1);
  const pct = (currentIndex / max) * 100;

  return (
    <div className="px-6 py-4">
      <div className="flex justify-between mb-2 text-xs text-gray-500 font-mono">
        {timeline.map((point, i) => (
          <button
            key={point.snapshotId}
            type="button"
            onClick={() => onIndexChange(i)}
            className={`transition-colors ${i === currentIndex ? 'text-archaeologist-400 font-medium' : 'hover:text-gray-300'}`}
          >
            {point.label}
          </button>
        ))}
      </div>

      <div className="relative h-8 flex items-center">
        <div className="absolute left-0 right-0 h-2 bg-surface-overlay rounded-full pointer-events-none">
          <div
            className="absolute h-full bg-archaeologist-600/40 rounded-full"
            style={{ width: `${pct}%` }}
          />
        </div>

        {timeline.map((point, i) => (
          <div
            key={point.snapshotId}
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 pointer-events-none ${
              i === currentIndex
                ? 'bg-archaeologist-500 border-white scale-125 z-[1]'
                : i < currentIndex
                ? 'bg-archaeologist-600 border-archaeologist-500'
                : 'bg-surface-raised border-surface-border'
            } ${point.eventIds.length > 0 ? 'ring-2 ring-amber-400/40' : ''}`}
            style={{ left: `${(i / max) * 100}%` }}
          />
        ))}

        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={currentIndex}
          aria-label="Architecture timeline"
          onChange={(e) => onIndexChange(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
      </div>

      <div className="text-center mt-3">
        <span className={`text-lg font-mono font-medium text-gray-200 ${isPlaying ? 'animate-pulse-soft' : ''}`}>
          {current ? new Date(current.timestamp).toISOString().slice(0, 10) : ''}
        </span>
        {current && (
          <span className="ml-3 text-sm text-gray-500 font-mono">{current.shortCommit}</span>
        )}
        <p className="text-[11px] text-gray-600 mt-1">Drag to replay architecture at that commit</p>
      </div>
    </div>
  );
}
