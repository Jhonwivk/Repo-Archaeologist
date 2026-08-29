import type { RepositoryAnalysis } from '@repo-archaeologist/core';
import type { GroundTruth, GroundTruthEvent } from './ground-truth.js';

export interface EvalMetrics {
  modulePrecision: number;
  moduleRecall: number;
  dependencyPrecision: number;
  eventRecall: number;
  structuralAccuracy: number;
  evidenceValidity: number;
}

export function evaluateAnalysis(analysis: RepositoryAnalysis, truth: GroundTruth): EvalMetrics {
  const last = analysis.snapshots[analysis.snapshots.length - 1];
  const predictedPaths = new Set((last?.modules ?? []).map((m) => m.path));
  const truthPaths = new Set(truth.finalModulePaths);

  const modulePrecision = precision(predictedPaths, truthPaths);
  const moduleRecall = recall(predictedPaths, truthPaths);

  const predictedEdges = new Set(
    (last?.dependencies ?? []).map((e) => {
      const from = last.modules.find((m) => m.id === e.from)?.path ?? e.from;
      const to = last.modules.find((m) => m.id === e.to)?.path ?? e.to;
      return `${from}->${to}`;
    })
  );
  const truthEdges = new Set(truth.dependencyEdges.map(([a, b]) => `${a}->${b}`));
  const dependencyPrecision = truthEdges.size === 0 ? 1 : precision(predictedEdges, truthEdges);

  const eventRecall = recallEvents(analysis, truth.events);

  const structuralHits = truth.events.filter((ev) =>
    ev.type === 'moved' || ev.type === 'module_split' || ev.type === 'module_merge'
  );
  const structuralAccuracy = structuralHits.length === 0
    ? 1
    : structuralHits.filter((ev) => eventMatches(analysis, ev)).length / structuralHits.length;

  const withEvidence = analysis.evolutionEvents.filter((e) => {
    const hasCommit = e.evidence.some((ev) => ev.kind === 'commit_message' && Boolean(ev.commit || ev.ref));
    const structural = e.type === 'module_split' || e.type === 'module_merge' || e.type === 'architecture_migration'
      || e.changes.some((c) => c.type === 'split' || c.type === 'merged' || c.type === 'moved');
    if (!structural) return hasCommit;
    const hasFile = e.evidence.some((ev) => ev.kind === 'file_change' && Boolean(ev.file)) || e.changedFiles.length > 0;
    const hasSymbol = e.evidence.some((ev) => ev.kind === 'symbol' && Boolean(ev.symbol)) || (e.symbols?.length ?? 0) > 0;
    return hasCommit && hasFile && hasSymbol;
  });
  const evidenceValidity = analysis.evolutionEvents.length === 0
    ? 1
    : withEvidence.length / analysis.evolutionEvents.length;

  return {
    modulePrecision,
    moduleRecall,
    dependencyPrecision,
    eventRecall,
    structuralAccuracy,
    evidenceValidity,
  };
}

function precision(predicted: Set<string>, truth: Set<string>): number {
  if (predicted.size === 0) return 0;
  let hits = 0;
  for (const p of predicted) if (truth.has(p)) hits++;
  return hits / predicted.size;
}

function recall(predicted: Set<string>, truth: Set<string>): number {
  if (truth.size === 0) return 1;
  let hits = 0;
  for (const t of truth) if (predicted.has(t)) hits++;
  return hits / truth.size;
}

function recallEvents(analysis: RepositoryAnalysis, events: GroundTruthEvent[]): number {
  if (events.length === 0) return 1;
  const hits = events.filter((ev) => eventMatches(analysis, ev)).length;
  return hits / events.length;
}

function eventMatches(analysis: RepositoryAnalysis, truth: GroundTruthEvent): boolean {
  return analysis.evolutionEvents.some((event) => {
    const names = new Set([
      ...event.affectedModules.map((n) => n.toLowerCase()),
      ...event.changes.map((c) => c.module.toLowerCase()),
      ...event.changes.flatMap((c) => (c.to ?? []).map((t) => t.toLowerCase())),
      ...event.changes.map((c) => (c.from ?? '').toLowerCase()),
    ]);
    const wanted = truth.modules.map((m) => m.toLowerCase());
    const overlap = wanted.filter((m) => [...names].some((n) => n.includes(m) || m.includes(n))).length;
    if (overlap === 0) return false;

    if (truth.type === 'moved') {
      return event.changes.some((c) => c.type === 'moved');
    }
    if (truth.type === 'module_split') {
      return event.type === 'module_split' || event.changes.some((c) => c.type === 'split');
    }
    if (truth.type === 'module_merge') {
      return event.type === 'module_merge' || event.changes.some((c) => c.type === 'merged');
    }
    if (truth.type === 'feature_introduction') {
      return event.type === 'feature_introduction' || event.changes.some((c) => c.type === 'added');
    }
    return true;
  });
}

export function formatMetrics(m: EvalMetrics): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return [
    `Module precision ${pct(m.modulePrecision)}`,
    `Module recall ${pct(m.moduleRecall)}`,
    `Dependency precision ${pct(m.dependencyPrecision)}`,
    `Important event recall ${pct(m.eventRecall)}`,
    `Move/split/merge accuracy ${pct(m.structuralAccuracy)}`,
    `Evidence validity ${pct(m.evidenceValidity)}`,
  ].join('\n');
}
