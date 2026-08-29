export interface GroundTruthEvent {
  type: 'feature_introduction' | 'module_split' | 'module_merge' | 'moved' | 'refactor';
  modules: string[];
  from?: string;
  to?: string[];
}

export interface GroundTruth {
  id: string;
  description: string;
  finalModulePaths: string[];
  dependencyEdges: Array<[string, string]>;
  events: GroundTruthEvent[];
}

export const evolutionLabGroundTruth: GroundTruth = {
  id: 'evolution-lab',
  description: 'Synthetic TS repo covering add, move, split, and merge',
  finalModulePaths: [
    'src/cli',
    'src/runtime',
    'src/planner',
    'src/executor',
    'src/persist',
    'src/mcp',
  ],
  dependencyEdges: [
    ['src/cli', 'src/planner'],
    ['src/cli', 'src/executor'],
    ['src/cli', 'src/runtime'],
    ['src/planner', 'src/runtime'],
    ['src/executor', 'src/mcp'],
  ],
  events: [
    { type: 'feature_introduction', modules: ['storage', 'config'] },
    { type: 'feature_introduction', modules: ['agent'] },
    { type: 'moved', modules: ['runtime'], from: 'src/core', to: ['src/runtime'] },
    { type: 'module_split', modules: ['agent', 'planner', 'executor'], from: 'agent', to: ['planner', 'executor'] },
    { type: 'module_merge', modules: ['storage', 'config', 'persist'], from: 'storage', to: ['persist'] },
    { type: 'feature_introduction', modules: ['mcp'] },
  ],
};

export const selfRepoGroundTruth: GroundTruth = {
  id: 'self',
  description: 'Repo Archaeologist monorepo at HEAD',
  finalModulePaths: [
    'packages/core',
    'packages/engine',
    'packages/server',
    'apps/web',
  ],
  dependencyEdges: [
    ['packages/engine', 'packages/core'],
    ['packages/server', 'packages/core'],
    ['packages/server', 'packages/engine'],
    ['apps/web', 'packages/core'],
  ],
  events: [
    { type: 'feature_introduction', modules: ['core', 'engine', 'server', 'web'] },
  ],
};
