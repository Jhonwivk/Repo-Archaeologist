import { simpleGit, SimpleGit } from 'simple-git';
import type { GitAnalyzer, CommitInfo, GitFileEntry } from './types.js';

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.kt',
  '.swift', '.rb', '.cs', '.cpp', '.c', '.h', '.hpp', '.vue', '.svelte',
]);

export class SimpleGitAnalyzer implements GitAnalyzer {
  private git: SimpleGit;
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
  }

  async clone(url: string, targetPath: string): Promise<void> {
    this.repoPath = targetPath;
    this.git = simpleGit().clone(url, targetPath, ['--depth', '500']);
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
    const log = await this.git.log({ '--oneline': null, [target]: null });
    return log.total;
  }

  async getCommits(branch?: string, limit = 500): Promise<CommitInfo[]> {
    const target = branch ?? await this.getDefaultBranch();
    const log = await this.git.log({
      [target]: null,
      maxCount: limit,
      '--stat': null,
    });

    return log.all.map((entry) => {
      const diffText = typeof entry.diff === 'string' ? entry.diff : '';
      const statMatch = diffText.match(/(\d+) files? changed/);
      const filesChanged = statMatch ? parseInt(statMatch[1], 10) : 0;
      return {
        hash: entry.hash,
        shortHash: entry.hash.slice(0, 7),
        date: entry.date,
        message: entry.message,
        author: entry.author_name,
        filesChanged,
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

  async cleanup(): Promise<void> {
    // No-op for simple-git; caller manages temp dirs
  }

  isSourceFile(path: string): boolean {
    const ext = path.slice(path.lastIndexOf('.'));
    return SOURCE_EXTENSIONS.has(ext);
  }
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
