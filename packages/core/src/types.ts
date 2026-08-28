/** Core IR types for Repo Archaeologist */

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

export type ArchitectureChangeType = 'added' | 'removed' | 'moved' | 'split' | 'merged';

export interface DependencyEdge {
  from: string;
  to: string;
  weight: number;
}

export interface ModuleNode {
  id: string;
  name: string;
  path: string;
  fileCount: number;
  linesOfCode: number;
  symbols: string[];
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
  detail?: string;
  from?: string;
  to?: string[];
}

export interface Evidence {
  kind: 'commit_message' | 'file_change' | 'readme' | 'module_delta' | 'dependency_change';
  description: string;
  ref?: string;
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
}

export interface BlastRadius {
  filesChanged: number;
  modulesAffected: number;
  dependenciesChanged: number;
  heatmap: Record<string, number>;
}

export interface ModuleLifecycleEvent {
  kind: 'born' | 'first_implementation' | 'major_redesign' | 'split' | 'merge' | 'removed' | 'renamed';
  timestamp: string;
  commit: string;
  detail?: string;
  relatedModules?: string[];
}

export interface ModuleEvolution {
  module: string;
  bornAt?: string;
  bornCommit?: string;
  removedAt?: string;
  removedCommit?: string;
  renamedFrom?: string;
  splitFrom?: string;
  mergedInto?: string;
  events: ModuleLifecycleEvent[];
  currentDependencies: string[];
}

export interface SnapshotDelta {
  fromSnapshotId: string;
  toSnapshotId: string;
  added: ModuleNode[];
  removed: ModuleNode[];
  moved: Array<{ module: string; from: string; to: string }>;
  dependencyChanges: {
    added: DependencyEdge[];
    removed: DependencyEdge[];
  };
  changes: ArchitectureChange[];
}

export interface RepositoryAnalysis {
  id: string;
  url: string;
  name: string;
  owner: string;
  analyzedAt: string;
  defaultBranch: string;
  totalCommits: number;
  snapshots: Snapshot[];
  deltas: SnapshotDelta[];
  evolutionEvents: EvolutionEvent[];
  moduleEvolutions: ModuleEvolution[];
  timeline: TimelinePoint[];
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
}

export interface AnalyzeProgress {
  stage: 'cloning' | 'scanning' | 'selecting_commits' | 'building_snapshots' | 'detecting_changes' | 'clustering_events' | 'complete' | 'error';
  progress: number;
  message: string;
}
