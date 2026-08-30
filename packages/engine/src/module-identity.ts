import { posix as path } from 'node:path';
import { snapshotFingerprint } from '@repo-archaeologist/core';
import type { DependencyEdge, ModuleNode, Snapshot } from '@repo-archaeologist/core';

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.git', '.github', '.vite',
  'docs', 'scripts', 'examples', 'fixtures', 'vendor', 'out', '.next',
  '__mocks__', 'cypress', 'e2e',
]);

const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx|mts|cts)$/;
const TEST_DIR = /(^|\/)(__tests__|tests|test|spec)(\/|$)/;

export interface WorkspacePackage {
  dir: string;
  name: string;
}

export function isSkippedPath(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, '/').split('/');
  if (parts.some((p) => SKIP_DIRS.has(p))) return true;
  if (TEST_FILE.test(filePath)) return true;
  if (TEST_DIR.test(filePath)) return true;
  return false;
}

/**
 * Assign a file to an architecture module.
 * Workspace packages win; otherwise first-level src/lib folders.
 */
export function detectModulePath(filePath: string, workspaces: WorkspacePackage[] = []): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  if (isSkippedPath(normalized)) return null;

  const sorted = [...workspaces].sort((a, b) => b.dir.length - a.dir.length);
  for (const ws of sorted) {
    if (ws.dir === '.' || ws.dir === '') continue;
    const prefix = ws.dir.endsWith('/') ? ws.dir : `${ws.dir}/`;
    if (normalized.startsWith(prefix) || normalized === ws.dir) {
      return ws.dir;
    }
  }

  const rootWorkspace = sorted.find((ws) => ws.dir === '.' || ws.dir === '');
  if (rootWorkspace && !normalized.includes('/')) return '.';

  const pkgMatch = normalized.match(/^(packages\/[^/]+)/);
  if (pkgMatch) return pkgMatch[1];

  const appMatch = normalized.match(/^(apps\/[^/]+)/);
  if (appMatch) return appMatch[1];

  for (const root of ['src', 'lib', 'internal']) {
    const match = normalized.match(new RegExp(`^${root}/([^/]+)/`));
    if (match) return `${root}/${match[1]}`;
    const fileMatch = normalized.match(new RegExp(`^${root}/([^/]+)\\.(ts|tsx|js|jsx)$`));
    if (fileMatch) return root;
  }

  return null;
}

export function pathToModuleId(modulePath: string): string {
  return `mod:${modulePath.replace(/\\/g, '/')}`;
}

export function jaccard<T>(a: Set<T> | T[], b: Set<T> | T[]): number {
  const sa = a instanceof Set ? a : new Set(a);
  const sb = b instanceof Set ? b : new Set(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function basenames(files: string[]): string[] {
  return files.map((f) => path.basename(f));
}

export interface IdentityMatch {
  from: ModuleNode;
  to: ModuleNode;
  confidence: number;
  reason: 'path' | 'package' | 'rename' | 'files' | 'symbols' | 'structure';
}

export interface SimilarityContext {
  modules: ModuleNode[];
  dependencies: DependencyEdge[];
}

export interface SimilarityBreakdown {
  rename: number;
  files: number;
  symbols: number;
  dependencies: number;
  size: number;
  score: number;
}

const STRUCTURAL_MATCH_MIN = 0.58;
const AMBIGUITY_MARGIN = 0.08;

export function overlapScore(
  a: ModuleNode,
  b: ModuleNode,
  renameMap: Map<string, string> = new Map(),
  fromContext?: SimilarityContext,
  toContext?: SimilarityContext
): number {
  return structuralSimilarity(a, b, renameMap, fromContext, toContext).score;
}

export function structuralSimilarity(
  a: ModuleNode,
  b: ModuleNode,
  renameMap: Map<string, string> = new Map(),
  fromContext?: SimilarityContext,
  toContext?: SimilarityContext
): SimilarityBreakdown {
  const renamedCount = a.files.filter((f) => {
    const dest = renameMap.get(f);
    return dest ? b.files.includes(dest) : false;
  }).length;
  const rename = a.files.length === 0 ? 0 : renamedCount / a.files.length;
  const files = uniqueFileScore(a, b);
  const symbols = a.symbols.length && b.symbols.length ? jaccard(a.symbols, b.symbols) : 0;
  const dependencies = fromContext && toContext
    ? dependencyNeighborhoodScore(a, b, fromContext, toContext)
    : 0;
  const largestSize = Math.max(a.linesOfCode, b.linesOfCode);
  const size = largestSize > 0 ? Math.min(a.linesOfCode, b.linesOfCode) / largestSize : 0;
  const weighted = files * 0.35 + symbols * 0.3 + dependencies * 0.25 + size * 0.1;
  return { rename, files, symbols, dependencies, size, score: Math.max(rename, weighted) };
}

const GENERIC_FILES = new Set([
  'index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mts', 'index.cts',
  'mod.ts', 'mod.js', 'main.ts', 'main.js',
]);

function uniqueFileScore(a: ModuleNode, b: ModuleNode): number {
  const left = distinctiveNames(a);
  const right = distinctiveNames(b);
  if (left.length === 0 || right.length === 0) return 0;
  return jaccard(left, right);
}

function distinctiveNames(mod: ModuleNode): string[] {
  const names = basenames(mod.files).filter((n) => !GENERIC_FILES.has(n));
  return names.length > 0 ? names : [];
}

/**
 * Match modules across two snapshots using path, package name, file overlap, then symbols.
 * 1:1 greedy matching, but sources that overlap multiple targets are left for split/merge detection.
 */
export function matchModules(
  from: ModuleNode[],
  to: ModuleNode[],
  renamedFiles: Array<{ from: string; to: string }> = [],
  fromContext?: SimilarityContext,
  toContext?: SimilarityContext
): IdentityMatch[] {
  const renameMap = new Map(renamedFiles.map((r) => [r.from, r.to]));

  const splitSources = new Set<string>();
  for (const a of from) {
    const hits = to
      .map((b) => ({
        evidence: transferEvidence(a, b, renameMap),
        overlap: overlapScore(a, b, renameMap, fromContext, toContext),
      }))
      .filter((hit) => hit.evidence.size > 0 && hit.overlap >= 0.25);
    if (hasDistinctEvidenceGroups(hits.map((hit) => hit.evidence))) splitSources.add(a.id);
  }
  const mergeTargets = new Set<string>();
  for (const b of to) {
    const hits = from
      .map((a) => ({
        evidence: transferEvidence(a, b, renameMap),
        overlap: overlapScore(a, b, renameMap, fromContext, toContext),
      }))
      .filter((hit) => hit.evidence.size > 0 && hit.overlap >= 0.25);
    if (hasDistinctEvidenceGroups(hits.map((hit) => hit.evidence))) mergeTargets.add(b.id);
  }

  const candidates: IdentityMatch[] = [];

  for (const a of from) {
    if (splitSources.has(a.id)) continue;
    for (const b of to) {
      if (mergeTargets.has(b.id)) continue;
      const scored = scorePair(a, b, renameMap, fromContext, toContext);
      if (scored) candidates.push(scored);
    }
  }

  candidates.sort((x, y) => y.confidence - x.confidence);
  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  const matches: IdentityMatch[] = [];

  for (const c of candidates) {
    if (usedFrom.has(c.from.id) || usedTo.has(c.to.id)) continue;
    if (!isDeterministic(c) && isAmbiguous(c, candidates)) continue;
    usedFrom.add(c.from.id);
    usedTo.add(c.to.id);
    matches.push(c);
  }

  return matches;
}

function scorePair(
  a: ModuleNode,
  b: ModuleNode,
  renameMap: Map<string, string>,
  fromContext?: SimilarityContext,
  toContext?: SimilarityContext
): IdentityMatch | null {
  if (a.id && b.id && a.id === b.id) {
    return { from: a, to: b, confidence: 1, reason: 'path' };
  }
  if (a.path === b.path) {
    return { from: a, to: b, confidence: 1, reason: 'path' };
  }
  if (a.packageName && b.packageName && a.packageName === b.packageName) {
    return { from: a, to: b, confidence: 0.98, reason: 'package' };
  }

  const renamedCount = a.files.filter((f) => {
    const dest = renameMap.get(f);
    return dest ? b.files.includes(dest) : false;
  }).length;
  if (a.files.length > 0 && renamedCount / a.files.length >= 0.6) {
    return { from: a, to: b, confidence: 0.93, reason: 'rename' };
  }

  const similarity = structuralSimilarity(a, b, renameMap, fromContext, toContext);
  if (similarity.files >= 0.8) {
    return {
      from: a,
      to: b,
      confidence: Math.min(0.92, 0.65 + similarity.score * 0.3),
      reason: similarity.dependencies >= 0.5 ? 'structure' : 'files',
    };
  }

  const evidenceChannels = [similarity.files, similarity.symbols, similarity.dependencies]
    .filter((score) => score >= 0.45).length;
  if (similarity.score >= STRUCTURAL_MATCH_MIN && evidenceChannels >= 2) {
    return {
      from: a,
      to: b,
      confidence: Math.min(0.9, 0.55 + similarity.score * 0.4),
      reason: 'structure',
    };
  }
  if (similarity.symbols >= 0.7 && similarity.files >= 0.2) {
    return {
      from: a,
      to: b,
      confidence: Math.min(0.82, 0.55 + similarity.score * 0.35),
      reason: 'symbols',
    };
  }

  return null;
}

function dependencyNeighborhoodScore(
  a: ModuleNode,
  b: ModuleNode,
  fromContext: SimilarityContext,
  toContext: SimilarityContext
): number {
  const before = dependencyNeighborhood(a, fromContext);
  const after = dependencyNeighborhood(b, toContext);
  if (before.length === 0 || after.length === 0) return 0;
  return jaccard(before, after);
}

function dependencyNeighborhood(module: ModuleNode, context: SimilarityContext): string[] {
  const moduleById = new Map(context.modules.map((candidate) => [candidate.id, candidate]));
  const tokens: string[] = [];
  for (const edge of context.dependencies) {
    if (edge.from === module.id) {
      const neighbor = moduleById.get(edge.to);
      if (neighbor) tokens.push(`out:${neighborDescriptor(neighbor)}`);
    }
    if (edge.to === module.id) {
      const neighbor = moduleById.get(edge.from);
      if (neighbor) tokens.push(`in:${neighborDescriptor(neighbor)}`);
    }
  }
  return tokens;
}

function neighborDescriptor(module: ModuleNode): string {
  if (module.packageName) return `package:${module.packageName}`;
  const symbols = [...module.symbols].sort().slice(0, 4).join(',');
  return symbols ? `symbols:${symbols}` : `path:${module.path}`;
}

function transferEvidence(
  from: ModuleNode,
  to: ModuleNode,
  renameMap: Map<string, string>
): Set<string> {
  const evidence = new Set<string>();
  for (const file of from.files) {
    const destination = renameMap.get(file);
    if (destination && to.files.includes(destination)) evidence.add(`file:${file}`);
  }
  for (const name of distinctiveNames(from)) {
    if (distinctiveNames(to).includes(name)) evidence.add(`name:${name}`);
  }
  for (const symbol of from.symbols) {
    if (to.symbols.includes(symbol)) evidence.add(`symbol:${symbol}`);
  }
  return evidence;
}

function hasDistinctEvidenceGroups(groups: Set<string>[]): boolean {
  if (groups.length < 2) return false;
  const distinctGroups = groups.filter((group) =>
    [...group].some((item) => groups.filter((other) => other.has(item)).length === 1)
  );
  return distinctGroups.length >= 2;
}

function isDeterministic(match: IdentityMatch): boolean {
  return match.reason === 'path' || match.reason === 'package' || match.reason === 'rename';
}

function isAmbiguous(match: IdentityMatch, candidates: IdentityMatch[]): boolean {
  return candidates.some((candidate) => {
    if (candidate === match || isDeterministic(candidate)) return false;
    const competesForSource = candidate.from.id === match.from.id && candidate.to.id !== match.to.id;
    const competesForTarget = candidate.to.id === match.to.id && candidate.from.id !== match.from.id;
    return (competesForSource || competesForTarget)
      && candidate.confidence >= match.confidence - AMBIGUITY_MARGIN;
  });
}

export function stabilizeIdentities(snapshots: ModuleNode[][]): void {
  if (snapshots.length === 0) return;
  for (const mod of snapshots[0]) {
    mod.id = pathToModuleId(mod.path);
  }

  for (let i = 1; i < snapshots.length; i++) {
    const matches = matchModules(snapshots[i - 1], snapshots[i]);
    const used = new Set(matches.map((m) => m.to.path));
    for (const match of matches) {
      match.to.id = match.from.id;
    }
    for (const mod of snapshots[i]) {
      if (!used.has(mod.path)) {
        mod.id = pathToModuleId(mod.path);
      }
    }
  }
}

/** Stabilize module IDs and rewrite dependency endpoints in lockstep. */
export function stabilizeSnapshotIdentities(snapshots: Snapshot[]): void {
  if (snapshots.length === 0) return;
  normalizeSnapshotIds(snapshots[0], new Map());

  for (let i = 1; i < snapshots.length; i++) {
    const previous = snapshots[i - 1];
    const current = snapshots[i];
    const matches = matchModules(
      previous.modules,
      current.modules,
      [],
      { modules: previous.modules, dependencies: previous.dependencies },
      { modules: current.modules, dependencies: current.dependencies }
    );
    const stableIds = new Map(matches.map((match) => [match.to.id, match.from.id]));
    normalizeSnapshotIds(current, stableIds);
  }
}

function normalizeSnapshotIds(snapshot: Snapshot, stableIds: Map<string, string>): void {
  const remap = new Map<string, string>();
  for (const module of snapshot.modules) {
    const oldId = module.id;
    const nextId = stableIds.get(oldId) ?? pathToModuleId(module.path);
    remap.set(oldId, nextId);
    module.id = nextId;
  }
  snapshot.dependencies = snapshot.dependencies.map((edge) => ({
    ...edge,
    from: remap.get(edge.from) ?? edge.from,
    to: remap.get(edge.to) ?? edge.to,
  }));
  snapshot.fingerprint = snapshotFingerprint(snapshot);
}
