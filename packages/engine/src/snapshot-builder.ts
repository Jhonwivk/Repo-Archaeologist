import { posix as path } from 'node:path';
import type { ModuleNode, DependencyEdge, Snapshot } from '@repo-archaeologist/core';
import type { GitAnalyzer, CommitInfo } from './git/types.js';
import {
  parseSource,
  parseTsconfigPaths,
  aliasesFromPaths,
  resolvePathAlias,
  isTsJsFile,
  type PathAlias,
} from './languages/index.js';
import {
  detectModulePath,
  isSkippedPath,
  pathToModuleId,
  type WorkspacePackage,
} from './module-identity.js';

interface FileParse {
  path: string;
  modulePath: string;
  loc: number;
  exports: string[];
  specifiers: string[];
  reExports: string[];
}

interface ParsedModule {
  path: string;
  name: string;
  packageName?: string;
  files: string[];
  loc: number;
  symbols: string[];
  specifiers: string[];
}

const SOURCE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

export class SnapshotBuilder {
  constructor(private git: GitAnalyzer) {}

  async buildSnapshot(commit: CommitInfo): Promise<Snapshot> {
    const files = await this.git.getFilesAtCommit(commit.hash);
    const sourceFiles = files
      .map((f) => f.path)
      .filter((p) => isTsJsFile(p) && !isSkippedPath(p));

    const workspaces = await this.loadWorkspaces(commit.hash, files.map((f) => f.path));
    const aliases = await this.loadAliases(commit.hash);

    const parsedFiles: FileParse[] = [];
    for (const filePath of sourceFiles) {
      const modulePath = detectModulePath(filePath, workspaces);
      if (!modulePath) continue;
      const content = await this.git.getFileContentAtCommit(commit.hash, filePath);
      if (!content || content.length > 250_000) {
        parsedFiles.push({
          path: filePath,
          modulePath,
          loc: content ? content.split('\n').length : 0,
          exports: [],
          specifiers: [],
          reExports: [],
        });
        continue;
      }
      const parsed = parseSource(filePath, content);
      parsedFiles.push({
        path: filePath,
        modulePath,
        loc: content.split('\n').length,
        exports: parsed?.exports ?? [],
        specifiers: (parsed?.imports ?? [])
          .filter((i) => !i.isTypeOnly)
          .map((i) => i.specifier),
        reExports: parsed?.reExports ?? [],
      });
    }

    const modules = this.groupModules(parsedFiles, workspaces);
    const fileToModule = new Map(parsedFiles.map((f) => [f.path, f.modulePath]));
    const dependencies = this.buildDependencyGraph(parsedFiles, modules, fileToModule, aliases, workspaces);

    const totalLines = modules.reduce((sum, m) => sum + m.linesOfCode, 0);

    return {
      id: `snap-${commit.shortHash}`,
      commit: commit.hash,
      shortCommit: commit.shortHash,
      timestamp: commit.date,
      message: commit.message,
      author: commit.author,
      modules,
      dependencies,
      totalFiles: sourceFiles.length,
      totalLines,
    };
  }

  private async loadWorkspaces(commit: string, allFiles: string[]): Promise<WorkspacePackage[]> {
    const packageFiles = allFiles.filter((p) => p.endsWith('package.json') && !isSkippedPath(p));
    const workspaces: WorkspacePackage[] = [];

    for (const pkgFile of packageFiles) {
      const content = await this.git.getFileContentAtCommit(commit, pkgFile);
      if (!content) continue;
      try {
        const json = JSON.parse(content) as { name?: string };
        const dir = path.dirname(pkgFile);
        if (dir === '.' || dir === '') continue;
        workspaces.push({ dir, name: json.name ?? path.basename(dir) });
      } catch {
        // ignore malformed package.json
      }
    }
    return workspaces;
  }

  private async loadAliases(commit: string): Promise<PathAlias[]> {
    const content = await this.git.getFileContentAtCommit(commit, 'tsconfig.json');
    if (!content) return [];
    try {
      const paths = parseTsconfigPaths(content);
      return aliasesFromPaths(paths);
    } catch {
      return [];
    }
  }

  private groupModules(files: FileParse[], workspaces: WorkspacePackage[]): ModuleNode[] {
    const map = new Map<string, ParsedModule>();
    const wsByDir = new Map(workspaces.map((w) => [w.dir, w.name]));

    for (const file of files) {
      if (!map.has(file.modulePath)) {
        const parts = file.modulePath.split('/');
        map.set(file.modulePath, {
          path: file.modulePath,
          name: parts[parts.length - 1] ?? file.modulePath,
          packageName: wsByDir.get(file.modulePath),
          files: [],
          loc: 0,
          symbols: [],
          specifiers: [],
        });
      }
      const mod = map.get(file.modulePath)!;
      mod.files.push(file.path);
      mod.loc += file.loc;
      mod.symbols.push(...file.exports);
    }

    return [...map.values()]
      .filter((m) => isRealModule(m))
      .map((m) => ({
        id: pathToModuleId(m.path),
        name: m.name,
        path: m.path,
        pathId: m.path,
        packageName: m.packageName,
        fileCount: m.files.length,
        linesOfCode: m.loc,
        symbols: [...new Set(m.symbols)].slice(0, 20),
        files: m.files,
      }));
  }

  private buildDependencyGraph(
    files: FileParse[],
    modules: ModuleNode[],
    fileToModule: Map<string, string>,
    aliases: PathAlias[],
    workspaces: WorkspacePackage[]
  ): DependencyEdge[] {
    const pathToId = new Map(modules.map((m) => [m.path, m.id]));
    const packageToPath = new Map(
      modules.filter((m) => m.packageName).map((m) => [m.packageName as string, m.path])
    );
    const weights = new Map<string, number>();

    for (const file of files) {
      const fromPath = file.modulePath;
      const fromId = pathToId.get(fromPath);
      if (!fromId) continue;

      for (const spec of file.specifiers) {
        const resolved = resolveSpecifier(spec, file.path, aliases, packageToPath, fileToModule, workspaces);
        if (!resolved) continue;
        const toId = pathToId.get(resolved);
        if (!toId || toId === fromId) continue;
        const key = `${fromId}->${toId}`;
        weights.set(key, (weights.get(key) ?? 0) + 1);
      }
    }

    return [...weights.entries()].map(([key, weight]) => {
      const [from, to] = key.split('->');
      return { from, to, weight };
    });
  }
}

function isRealModule(mod: ParsedModule): boolean {
  if (mod.files.length === 0) return false;
  if (mod.files.length === 1 && mod.symbols.length === 0 && mod.loc < 20) return false;
  return true;
}

export function resolveSpecifier(
  spec: string,
  fromFile: string,
  aliases: PathAlias[],
  packageToPath: Map<string, string>,
  fileToModule: Map<string, string>,
  workspaces: WorkspacePackage[]
): string | null {
  if (spec.startsWith('.')) {
    const dir = path.dirname(fromFile);
    const resolved = path.normalize(path.join(dir, spec)).replace(/^\.\//, '');
    return moduleForResolvedPath(resolved, fileToModule, workspaces);
  }

  if (packageToPath.has(spec)) return packageToPath.get(spec)!;
  for (const [pkg, modulePath] of packageToPath) {
    if (spec === pkg || spec.startsWith(`${pkg}/`)) return modulePath;
  }

  const aliased = resolvePathAlias(spec, aliases);
  if (aliased) {
    return moduleForResolvedPath(aliased, fileToModule, workspaces);
  }

  return null;
}

function moduleForResolvedPath(
  resolved: string,
  fileToModule: Map<string, string>,
  workspaces: WorkspacePackage[]
): string | null {
  const candidates = expandResolved(resolved);
  for (const candidate of candidates) {
    const direct = fileToModule.get(candidate);
    if (direct) return direct;
  }
  const modulePath = detectModulePath(resolved, workspaces);
  return modulePath;
}

function expandResolved(resolved: string): string[] {
  const stripped = resolved.replace(/\.(js|jsx|ts|tsx|mjs|cjs)$/, '');
  const out: string[] = [resolved, stripped];
  for (const ext of SOURCE_EXT) {
    out.push(`${stripped}${ext}`);
    out.push(`${stripped}/index${ext}`);
  }
  return out;
}

/** Back-compat for existing unit tests. */
export function parseSourceFile(content: string, filePath: string): { symbols: string[]; imports: string[] } {
  const parsed = parseSource(filePath, content);
  return {
    symbols: parsed?.exports ?? [],
    imports: (parsed?.imports ?? []).map((i) => i.specifier),
  };
}

export { detectModulePath };
