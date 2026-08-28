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

  return (
    <div className="px-6 py-4">
      {/* Date labels */}
      <div className="flex justify-between mb-2 text-xs text-gray-500 font-mono">
        {timeline.map((point, i) => (
          <span
            key={point.snapshotId}
            className={`transition-colors ${i === currentIndex ? 'text-archaeologist-400 font-medium' : ''}`}
          >
            {point.label}
          </span>
        ))}
      </div>

      {/* Track */}
      <div className="relative h-2 bg-surface-overlay rounded-full">
        {/* Progress fill */}
        <div
          className="absolute h-full bg-archaeologist-600/30 rounded-full transition-all duration-300"
          style={{ width: `${(currentIndex / (timeline.length - 1)) * 100}%` }}
        />

        {/* Snap points */}
        {timeline.map((point, i) => (
          <button
            key={point.snapshotId}
            onClick={() => onIndexChange(i)}
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 transition-all duration-200 ${
              i === currentIndex
                ? 'bg-archaeologist-500 border-archaeologist-400 scale-125'
                : i < currentIndex
                ? 'bg-archaeologist-600 border-archaeologist-500'
                : 'bg-surface-raised border-surface-border hover:border-gray-500'
            } ${point.eventIds.length > 0 ? 'ring-2 ring-amber-400/30' : ''}`}
            style={{ left: `${(i / (timeline.length - 1)) * 100}%` }}
            title={`${point.label} — ${point.shortCommit}`}
          />
        ))}

        {/* Current indicator */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-archaeologist-500 border-2 border-white shadow-lg shadow-archaeologist-500/30 transition-all duration-300 ${isPlaying ? 'animate-pulse-soft' : ''}`}
          style={{ left: `${(currentIndex / (timeline.length - 1)) * 100}%` }}
        />
      </div>

      {/* Slider */}
      <input
        type="range"
        min={0}
        max={timeline.length - 1}
        value={currentIndex}
        onChange={(e) => onIndexChange(Number(e.target.value))}
        className="w-full mt-3 h-1 appearance-none bg-transparent cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-4
          [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-archaeologist-500
          [&::-webkit-slider-thumb]:cursor-pointer
          [&::-webkit-slider-thumb]:border-2
          [&::-webkit-slider-thumb]:border-white
          [&::-webkit-slider-thumb]:shadow-lg"
      />

      {/* Current date display */}
      <div className="text-center mt-2">
        <span className="text-lg font-mono font-medium text-gray-200">
          {current ? new Date(current.timestamp).toISOString().slice(0, 10) : ''}
        </span>
        {current && (
          <span className="ml-3 text-sm text-gray-500 font-mono">{current.shortCommit}</span>
        )}
      </div>
    </div>
  );
}
