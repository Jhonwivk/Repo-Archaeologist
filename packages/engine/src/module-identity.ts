import { posix as path } from 'node:path';
import type { ModuleNode } from '@repo-archaeologist/core';

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
    const prefix = ws.dir.endsWith('/') ? ws.dir : `${ws.dir}/`;
    if (normalized.startsWith(prefix) || normalized === ws.dir) {
      return ws.dir;
    }
  }

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
  reason: 'path' | 'package' | 'rename' | 'files' | 'symbols';
}

export function overlapScore(
  a: ModuleNode,
  b: ModuleNode,
  renameMap: Map<string, string> = new Map()
): number {
  const renamedCount = a.files.filter((f) => {
    const dest = renameMap.get(f);
    return dest ? b.files.includes(dest) : false;
  }).length;
  const renameScore = a.files.length === 0 ? 0 : renamedCount / a.files.length;
  const nameScore = uniqueFileScore(a, b);
  const symbolScore = a.symbols.length && b.symbols.length ? jaccard(a.symbols, b.symbols) : 0;
  return Math.max(renameScore, nameScore * 0.85 + symbolScore * 0.15);
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
  renamedFiles: Array<{ from: string; to: string }> = []
): IdentityMatch[] {
  const renameMap = new Map(renamedFiles.map((r) => [r.from, r.to]));

  const splitSources = new Set<string>();
  for (const a of from) {
    const hits = to.filter((b) => overlapScore(a, b, renameMap) >= 0.25);
    if (hits.length >= 2) splitSources.add(a.id);
  }
  const mergeTargets = new Set<string>();
  for (const b of to) {
    const hits = from.filter((a) => overlapScore(a, b, renameMap) >= 0.25);
    if (hits.length >= 2) mergeTargets.add(b.id);
  }

  const candidates: IdentityMatch[] = [];

  for (const a of from) {
    if (splitSources.has(a.id)) continue;
    for (const b of to) {
      if (mergeTargets.has(b.id)) continue;
      const scored = scorePair(a, b, renameMap);
      if (scored) candidates.push(scored);
    }
  }

  candidates.sort((x, y) => y.confidence - x.confidence);
  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  const matches: IdentityMatch[] = [];

  for (const c of candidates) {
    if (usedFrom.has(c.from.id) || usedTo.has(c.to.id)) continue;
    usedFrom.add(c.from.id);
    usedTo.add(c.to.id);
    matches.push(c);
  }

  return matches;
}

function scorePair(
  a: ModuleNode,
  b: ModuleNode,
  renameMap: Map<string, string>
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

  const fileScore = uniqueFileScore(a, b);
  if (fileScore >= 0.6) {
    return { from: a, to: b, confidence: 0.7 + fileScore * 0.2, reason: 'files' };
  }

  const symbolScore = jaccard(a.symbols, b.symbols);
  if (symbolScore >= 0.6 && Math.min(a.symbols.length, b.symbols.length) >= 1) {
    return { from: a, to: b, confidence: 0.62 + symbolScore * 0.2, reason: 'symbols' };
  }
  if (symbolScore >= 0.45 && fileScore >= 0.2) {
    return { from: a, to: b, confidence: 0.55 + symbolScore * 0.2, reason: 'symbols' };
  }

  return null;
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
