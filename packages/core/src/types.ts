/** Core IR types for Repo Archaeologist V1.1 */

export type EvolutionEventType =
  | 'feature_introduction'
  | 'refactor'
  | 'architecture_migration'
  | 'module_split'
  | 'module_merge'
  | 'dependency_replacement'
  | 'performance_redesign'
  | 'breaking_change'
  | 'other';

export type ArchitectureChangeType = 'added' | 'removed' | 'moved' | 'renamed' | 'split' | 'merged';

export interface DependencyEdge {
  from: string;
  to: string;
  weight: number;
}

export interface GraphPosition {
  x: number;
  y: number;
}

export interface ModuleNode {
  /** Stable identity that survives moves/renames within a repository analysis. */
  id: string;
  name: string;
  path: string;
  /** Path-based key before identity stabilization (e.g. src/agent). */
  pathId: string;
  packageName?: string;
  fileCount: number;
  linesOfCode: number;
  symbols: string[];
  files: string[];
}

export interface Snapshot {
  id: string;
  commit: string;
  shortCommit: string;
  timestamp: string;
  message: string;
  author: string;
  modules: ModuleNode[];
  dependencies: DependencyEdge[];
  totalFiles: number;
  totalLines: number;
}

export interface ArchitectureChange {
  type: ArchitectureChangeType;
  module: string;
  moduleId?: string;
  detail?: string;
  from?: string;
  to?: string[];
  confidence?: number;
}

export type EvidenceKind =
  | 'commit_message'
  | 'file_change'
  | 'readme'
  | 'module_delta'
  | 'dependency_change'
  | 'git_rename';

export interface Evidence {
  kind: EvidenceKind;
  description: string;
  ref?: string;
  commit?: string;
  file?: string;
  url?: string;
}

export interface EvolutionEvent {
  id: string;
  type: EvolutionEventType;
  title: string;
  summary: string;
  period: { start: string; end: string };
  startCommit: string;
  endCommit: string;
  commits: string[];
  affectedModules: string[];
  changes: ArchitectureChange[];
  evidence: Evidence[];
  blastRadius: BlastRadius;
  fromSnapshotId: string;
  toSnapshotId: string;
  changedFiles: string[];
  confidence: number;
}

export interface BlastRadius {
  filesChanged: number;
  modulesAffected: number;
  dependenciesChanged: number;
  heatmap: Record<string, number>;
}

export interface ModuleLifecycleEvent {
  kind: 'born' | 'first_implementation' | 'major_redesign' | 'split' | 'merge' | 'removed' | 'renamed' | 'moved';
  timestamp: string;
  commit: string;
  detail?: string;
  relatedModules?: string[];
}

export interface ModuleEvolution {
  moduleId: string;
  module: string;
  path: string;
  bornAt?: string;
  bornCommit?: string;
  removedAt?: string;
  removedCommit?: string;
  renamedFrom?: string;
  renamedTo?: string;
  splitFrom?: string;
  splitInto?: string[];
  mergedInto?: string;
  events: ModuleLifecycleEvent[];
  currentDependencies: string[];
}

export interface SnapshotDelta {
  fromSnapshotId: string;
  toSnapshotId: string;
  added: ModuleNode[];
  removed: ModuleNode[];
  moved: Array<{ module: string; moduleId: string; from: string; to: string; confidence: number }>;
  renamed: Array<{ module: string; moduleId: string; from: string; to: string; confidence: number }>;
  splits: Array<{ from: string; fromId: string; to: string[]; toIds: string[]; confidence: number }>;
  merges: Array<{ from: string[]; fromIds: string[]; to: string; toId: string; confidence: number }>;
  dependencyChanges: {
    added: DependencyEdge[];
    removed: DependencyEdge[];
  };
  changes: ArchitectureChange[];
  changedFiles: string[];
}

export interface RepositoryAnalysis {
  id: string;
  url: string;
  name: string;
  owner: string;
  analyzedAt: string;
  defaultBranch: string;
  totalCommits: number;
  language: 'typescript' | 'javascript' | 'mixed';
  snapshots: Snapshot[];
  deltas: SnapshotDelta[];
  evolutionEvents: EvolutionEvent[];
  moduleEvolutions: ModuleEvolution[];
  timeline: TimelinePoint[];
  /** Union-graph positions so nodes stay still across snapshots. */
  layout: Record<string, GraphPosition>;
}

export interface TimelinePoint {
  timestamp: string;
  commit: string;
  shortCommit: string;
  label: string;
  snapshotId: string;
  eventIds: string[];
}

export interface AnalyzeOptions {
  maxSnapshots?: number;
  minDaysBetweenSnapshots?: number;
  includeHighImpactCommits?: boolean;
  clusterWindowDays?: number;
  maxCommits?: number;
  cloneDepth?: number;
}

export interface AnalyzeProgress {
  stage: 'cloning' | 'scanning' | 'selecting_commits' | 'building_snapshots' | 'detecting_changes' | 'clustering_events' | 'complete' | 'error';
  progress: number;
  message: string;
}

export interface FeaturedCase {
  id: string;
  title: string;
  description: string;
  owner: string;
  name: string;
}
