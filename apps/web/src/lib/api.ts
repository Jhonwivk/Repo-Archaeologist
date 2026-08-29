import type { RepositoryAnalysis, Snapshot, EvolutionEvent } from '@repo-archaeologist/core';

const API_BASE = '/api';

export async function fetchDemo(): Promise<RepositoryAnalysis> {
  const res = await fetch(`${API_BASE}/demo`);
  if (!res.ok) throw new Error('Failed to fetch demo');
  return res.json();
}

export async function startAnalysis(url: string): Promise<{ analysisId: string }> {
  const res = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? 'Analysis failed');
  }
  return res.json();
}

export async function fetchAnalysis(id: string): Promise<RepositoryAnalysis> {
  const res = await fetch(`${API_BASE}/analyze/${id}`);
  if (res.status === 202) {
    throw new Error('IN_PROGRESS');
  }
  if (!res.ok) throw new Error('Analysis not found');
  return res.json();
}

export async function fetchProgress(id: string): Promise<{ stage: string; progress: number; message: string }> {
  const res = await fetch(`${API_BASE}/analyze/${id}/progress`);
  if (!res.ok) throw new Error('Progress not found');
  return res.json();
}

export function getSnapshotAtIndex(analysis: RepositoryAnalysis, index: number): Snapshot {
  return analysis.snapshots[Math.max(0, Math.min(index, analysis.snapshots.length - 1))];
}

export function getEventsForSnapshot(analysis: RepositoryAnalysis, snapshotId: string): EvolutionEvent[] {
  const point = analysis.timeline.find((t) => t.snapshotId === snapshotId);
  if (!point) return [];
  return analysis.evolutionEvents.filter((e) => point.eventIds.includes(e.id));
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export const EVENT_TYPE_LABELS: Record<string, string> = {
  feature_introduction: 'Feature',
  refactor: 'Refactor',
  architecture_migration: 'Migration',
  module_split: 'Split',
  module_merge: 'Merge',
  dependency_replacement: 'Dependency',
  performance_redesign: 'Performance',
  breaking_change: 'Breaking',
  other: 'Change',
};

export const EVENT_TYPE_COLORS: Record<string, string> = {
  feature_introduction: 'text-emerald-400 bg-emerald-400/10',
  refactor: 'text-blue-400 bg-blue-400/10',
  architecture_migration: 'text-amber-400 bg-amber-400/10',
  module_split: 'text-purple-400 bg-purple-400/10',
  module_merge: 'text-pink-400 bg-pink-400/10',
  dependency_replacement: 'text-cyan-400 bg-cyan-400/10',
  breaking_change: 'text-red-400 bg-red-400/10',
  other: 'text-gray-400 bg-gray-400/10',
};

export const CHANGE_TYPE_ICONS: Record<string, string> = {
  added: '+',
  removed: '−',
  moved: '↗',
  renamed: 'Aa',
  split: '⑂',
  merged: '⫘',
};

export async function fetchCases(): Promise<Array<{ id: string; title: string; description: string; owner: string; name: string }>> {
  const res = await fetch(`${API_BASE}/cases`);
  if (!res.ok) return [];
  return res.json();
}
