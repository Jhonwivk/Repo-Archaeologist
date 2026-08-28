import type { ModuleNode, DependencyEdge, Snapshot } from '@repo-archaeologist/core';
import type { GitAnalyzer, GitFileEntry, CommitInfo } from './git/types.js';
import { SimpleGitAnalyzer } from './git/analyzer.js';

const MODULE_ROOTS = ['src', 'lib', 'packages', 'apps', 'internal', 'pkg', 'cmd', 'crates'];

interface ParsedModule {
  id: string;
  name: string;
  path: string;
  files: string[];
  linesOfCode: number;
  symbols: string[];
  imports: Set<string>;
}

export class SnapshotBuilder {
  constructor(private git: GitAnalyzer) {}

  async buildSnapshot(commit: CommitInfo): Promise<Snapshot> {
    const files = await this.git.getFilesAtCommit(commit.hash);
    const sourceFiles = files.filter((f) => (this.git as SimpleGitAnalyzer).isSourceFile?.(f.path) ?? isSourceFile(f.path));

    const modules = await this.extractModules(commit.hash, sourceFiles);
    const dependencies = this.buildDependencyGraph(modules);

    const totalLines = modules.reduce((sum, m) => sum + m.linesOfCode, 0);

    return {
      id: `snap-${commit.shortHash}`,
      commit: commit.hash,
      shortCommit: commit.shortHash,
      timestamp: commit.date,
      message: commit.message,
      author: commit.author,
      modules: modules.map(({ imports: _, ...rest }) => rest),
      dependencies,
      totalFiles: sourceFiles.length,
      totalLines,
    };
  }

  private async extractModules(commit: string, files: GitFileEntry[]): Promise<Array<ModuleNode & { imports: Set<string> }>> {
    const moduleMap = new Map<string, ParsedModule>();

    for (const file of files) {
      const modulePath = detectModulePath(file.path);
      if (!modulePath) continue;

      const moduleId = modulePath.replace(/\//g, '-');
      if (!moduleMap.has(moduleId)) {
        const parts = modulePath.split('/');
        moduleMap.set(moduleId, {
          id: moduleId,
          name: parts[parts.length - 1],
          path: modulePath,
          files: [],
          linesOfCode: 0,
          symbols: [],
          imports: new Set(),
        });
      }

      const mod = moduleMap.get(moduleId)!;
      mod.files.push(file.path);

      const content = await this.git.getFileContentAtCommit(commit, file.path);
      if (content) {
        mod.linesOfCode += content.split('\n').length;
        const { symbols, imports } = parseSourceFile(content, file.path);
        mod.symbols.push(...symbols);
        for (const imp of imports) {
          mod.imports.add(imp);
        }
      }
    }

    // Deduplicate symbols
    for (const mod of moduleMap.values()) {
      mod.symbols = [...new Set(mod.symbols)].slice(0, 20);
    }

    return [...moduleMap.values()].map((m) => ({
      id: m.id,
      name: m.name,
      path: m.path,
      fileCount: m.files.length,
      linesOfCode: m.linesOfCode,
      symbols: m.symbols,
      imports: m.imports,
    }));
  }

  private buildDependencyGraph(modules: Array<ModuleNode & { imports: Set<string> }>): DependencyEdge[] {
    const pathToId = new Map<string, string>();
    for (const mod of modules) {
      pathToId.set(mod.path, mod.id);
      pathToId.set(mod.name, mod.id);
    }

    const edgeWeights = new Map<string, number>();

    for (const mod of modules) {
      for (const imp of mod.imports) {
        const targetId = resolveImportToModule(imp, mod.path, pathToId, modules);
        if (targetId && targetId !== mod.id) {
          const key = `${mod.id}->${targetId}`;
          edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
        }
      }
    }

    return [...edgeWeights.entries()].map(([key, weight]) => {
      const [from, to] = key.split('->');
      return { from, to, weight };
    });
  }
}

function isSourceFile(path: string): boolean {
  return /\.(ts|tsx|js|jsx|py|go|rs|java|kt|swift|rb|cs|cpp|c|vue|svelte)$/.test(path);
}

export function detectModulePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/');

  // Monorepo packages: packages/foo/src/...
  const pkgMatch = normalized.match(/^packages\/([^/]+)/);
  if (pkgMatch) return `packages/${pkgMatch[1]}`;

  // Apps: apps/web/src/...
  const appMatch = normalized.match(/^apps\/([^/]+)/);
  if (appMatch) return `apps/${appMatch[1]}`;

  // Standard src layout: src/agent/foo.ts -> src/agent
  for (const root of MODULE_ROOTS) {
    const rootPattern = new RegExp(`^${root}/([^/]+)`);
    const match = normalized.match(rootPattern);
    if (match) return `${root}/${match[1]}`;
  }

  // Top-level module dirs
  const topMatch = normalized.match(/^([^/]+)\/[^/]+\.(ts|js|py|go|rs)$/);
  if (topMatch && !['test', 'tests', 'docs', 'scripts', '.github'].includes(topMatch[1])) {
    return topMatch[1];
  }

  return null;
}

export function parseSourceFile(content: string, filePath: string): { symbols: string[]; imports: string[] } {
  const symbols: string[] = [];
  const imports: string[] = [];

  // Extract exports/classes/functions
  const symbolPatterns = [
    /export\s+(?:async\s+)?function\s+(\w+)/g,
    /export\s+class\s+(\w+)/g,
    /export\s+(?:const|let|var)\s+(\w+)/g,
    /export\s+default\s+(?:class|function)?\s*(\w+)/g,
    /class\s+(\w+)/g,
    /def\s+(\w+)/g,
    /func\s+(\w+)/g,
    /pub\s+(?:async\s+)?fn\s+(\w+)/g,
  ];

  for (const pattern of symbolPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1] && !symbols.includes(match[1])) {
        symbols.push(match[1]);
      }
    }
  }

  // Extract imports
  const importPatterns = [
    /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /from\s+(\S+)\s+import/g,
  ];

  for (const pattern of importPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const imp = match[1];
      if (imp && !imp.startsWith('.') && !imp.startsWith('@/')) {
        // External or absolute import - extract first segment
        const segment = imp.split('/')[0].replace(/^@/, '');
        if (segment && segment !== '.' && segment !== '..') {
          imports.push(imp);
        }
      } else if (imp) {
        imports.push(imp);
      }
    }
  }

  return { symbols: symbols.slice(0, 30), imports };
}

function resolveImportToModule(
  importPath: string,
  fromModulePath: string,
  pathToId: Map<string, string>,
  modules: ModuleNode[]
): string | null {
  // Relative import: ./foo -> resolve against fromModulePath
  if (importPath.startsWith('.')) {
    const fromDir = fromModulePath.split('/').slice(0, -1).join('/');
    const resolved = resolveRelativePath(fromDir, importPath);
    for (const mod of modules) {
      if (mod.path.startsWith(resolved) || resolved.startsWith(mod.path)) {
        return mod.id;
      }
    }
    return null;
  }

  // Absolute / package import
  const segments = importPath.replace(/^@\//, '').split('/');
  for (let len = segments.length; len > 0; len--) {
    const candidate = segments.slice(0, len).join('/');
    if (pathToId.has(candidate)) return pathToId.get(candidate)!;
  }

  // Match by module name
  const firstSegment = segments[0];
  if (pathToId.has(firstSegment)) return pathToId.get(firstSegment)!;

  return null;
}

function resolveRelativePath(from: string, relative: string): string {
  const parts = from.split('/').filter(Boolean);
  for (const segment of relative.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment !== '') parts.push(segment.replace(/\.(ts|js|tsx|jsx)$/, ''));
  }
  return parts.join('/');
}
