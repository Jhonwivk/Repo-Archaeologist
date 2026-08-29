import { simpleGit, SimpleGit } from 'simple-git';
import type { GitAnalyzer, CommitInfo, GitFileEntry, NameStatus, GitRename } from './types.js';
import { isTsJsFile } from '../languages/types.js';

export class SimpleGitAnalyzer implements GitAnalyzer {
  private git: SimpleGit;
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
  }

  async clone(url: string, targetPath: string, depth = 400): Promise<void> {
    this.repoPath = targetPath;
    await simpleGit().clone(url, targetPath, ['--depth', String(depth)]);
    this.git = simpleGit(targetPath);
  }

  async open(repoPath: string): Promise<void> {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
  }

  async getDefaultBranch(): Promise<string> {
    try {
      const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
      return branch.trim() || 'main';
    } catch {
      return 'main';
    }
  }

  async getTotalCommits(branch?: string): Promise<number> {
    const target = branch ?? await this.getDefaultBranch();
    try {
      const result = await this.git.raw(['rev-list', '--count', target]);
      const count = parseInt(result.trim(), 10);
      return Number.isNaN(count) ? 0 : count;
    } catch {
      const log = await this.git.log([target]);
      return log.total;
    }
  }

  async getCommits(branch?: string, limit = 400): Promise<CommitInfo[]> {
    const target = branch ?? await this.getDefaultBranch();
    const output = await this.git.raw([
      'log',
      target,
      `-n${limit}`,
      '--pretty=format:%H%x09%h%x09%aI%x09%an%x09%s',
    ]);

    const shortstat = await this.git.raw([
      'log',
      target,
      `-n${limit}`,
      '--pretty=format:%H',
      '--shortstat',
    ]).catch(() => '');
    const filesByHash = parseShortstat(shortstat);

    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, date, author, ...rest] = line.split('\t');
        return {
          hash,
          shortHash: shortHash || hash.slice(0, 7),
          date,
          message: rest.join('\t'),
          author: author || '',
          filesChanged: filesByHash.get(hash) ?? 0,
        };
      });
  }

  async getFilesAtCommit(commit: string): Promise<GitFileEntry[]> {
    const output = await this.git.raw(['ls-tree', '-r', '--name-only', commit]);
    return output
      .split('\n')
      .filter(Boolean)
      .map((path) => ({
        path,
        type: 'blob' as const,
      }));
  }

  async getFileContentAtCommit(commit: string, filePath: string): Promise<string | null> {
    try {
      return await this.git.show([`${commit}:${filePath}`]);
    } catch {
      return null;
    }
  }

  async getDiffStats(fromCommit: string, toCommit: string): Promise<{ files: string[]; insertions: number; deletions: number }> {
    try {
      const diff = await this.git.diffSummary([fromCommit, toCommit]);
      return {
        files: diff.files.map((f) => ('file' in f ? f.file : String(f))),
        insertions: diff.insertions,
        deletions: diff.deletions,
      };
    } catch {
      return { files: [], insertions: 0, deletions: 0 };
    }
  }

  async getNameStatus(fromCommit: string, toCommit: string): Promise<NameStatus> {
    try {
      const output = await this.git.raw(['diff', '-M50%', '--name-status', fromCommit, toCommit]);
      return parseNameStatus(output);
    } catch {
      return { added: [], deleted: [], modified: [], renamed: [], files: [] };
    }
  }

  async cleanup(): Promise<void> {
    // Caller manages temp dirs
  }

  isSourceFile(path: string): boolean {
    return isTsJsFile(path);
  }
}

function parseShortstat(raw: string): Map<string, number> {
  const map = new Map<string, number>();
  const lines = raw.split('\n');
  let currentHash: string | null = null;
  for (const line of lines) {
    if (/^[0-9a-f]{7,40}$/.test(line.trim())) {
      currentHash = line.trim();
      continue;
    }
    const match = line.match(/(\d+) files? changed/);
    if (match && currentHash) {
      map.set(currentHash, parseInt(match[1], 10));
      currentHash = null;
    }
  }
  return map;
}

export function parseNameStatus(output: string): NameStatus {
  const added: string[] = [];
  const deleted: string[] = [];
  const modified: string[] = [];
  const renamed: GitRename[] = [];
  const files: string[] = [];

  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0] ?? '';
    if (code.startsWith('R') || code.startsWith('C')) {
      const score = parseInt(code.slice(1), 10) || 100;
      const from = parts[1];
      const to = parts[2];
      if (from && to) {
        renamed.push({ from, to, score });
        files.push(from, to);
      }
    } else if (code === 'A' && parts[1]) {
      added.push(parts[1]);
      files.push(parts[1]);
    } else if (code === 'D' && parts[1]) {
      deleted.push(parts[1]);
      files.push(parts[1]);
    } else if ((code === 'M' || code === 'T') && parts[1]) {
      modified.push(parts[1]);
      files.push(parts[1]);
    }
  }

  return { added, deleted, modified, renamed, files: [...new Set(files)] };
}

export function parseGitHubUrl(url: string): { owner: string; name: string; cloneUrl: string } | null {
  const patterns = [
    /^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?\/?$/,
    /^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/,
    /^([^/]+)\/([^/]+)$/,
  ];

  for (const pattern of patterns) {
    const match = url.trim().match(pattern);
    if (match) {
      const owner = match[1];
      const name = match[2].replace(/\.git$/, '');
      return {
        owner,
        name,
        cloneUrl: `https://github.com/${owner}/${name}.git`,
      };
    }
  }
  return null;
}

export function githubCommitUrl(repoUrl: string, hash: string): string | undefined {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) return undefined;
  return `https://github.com/${parsed.owner}/${parsed.name}/commit/${hash}`;
}

export function githubFileUrl(repoUrl: string, hash: string, filePath: string): string | undefined {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) return undefined;
  return `https://github.com/${parsed.owner}/${parsed.name}/blob/${hash}/${filePath}`;
}

export function githubCompareUrl(repoUrl: string, from: string, to: string): string | undefined {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) return undefined;
  return `https://github.com/${parsed.owner}/${parsed.name}/compare/${from}...${to}`;
}
