import type { AnalyzeOptions } from '@repo-archaeologist/core';

export interface CommitInfo {
  hash: string;
  shortHash: string;
  date: string;
  message: string;
  author: string;
  filesChanged: number;
}

export interface GitFileEntry {
  path: string;
  type: 'blob' | 'tree';
}

export interface GitAnalyzer {
  clone(url: string, targetPath: string): Promise<void>;
  open(repoPath: string): Promise<void>;
  getDefaultBranch(): Promise<string>;
  getTotalCommits(branch?: string): Promise<number>;
  getCommits(branch?: string, limit?: number): Promise<CommitInfo[]>;
  getFilesAtCommit(commit: string): Promise<GitFileEntry[]>;
  getFileContentAtCommit(commit: string, filePath: string): Promise<string | null>;
  getDiffStats(fromCommit: string, toCommit: string): Promise<{ files: string[]; insertions: number; deletions: number }>;
  cleanup(): Promise<void>;
}

export const DEFAULT_ANALYZE_OPTIONS: Required<AnalyzeOptions> = {
  maxSnapshots: 24,
  minDaysBetweenSnapshots: 30,
  includeHighImpactCommits: true,
  clusterWindowDays: 14,
};
