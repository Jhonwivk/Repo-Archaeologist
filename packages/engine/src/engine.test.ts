import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectImportantCommits } from './commit-selector.js';
import { ChangeDetector, summarizeDelta } from './change-detector.js';
import { classifyEventType } from './event-clusterer.js';
import { SnapshotBuilder, detectModulePath, parseSourceFile, resolveSpecifier } from './snapshot-builder.js';
import { parseTsJs, resolvePathAlias, aliasesFromPaths } from './languages/ts-js.js';
import { matchModules, pathToModuleId, stabilizeSnapshotIdentities } from './module-identity.js';
import type { Snapshot, ModuleNode } from '@repo-archaeologist/core';
import type { CommitInfo, GitAnalyzer } from './git/types.js';

function mod(path: string, files: string[], symbols: string[] = []): ModuleNode {
  const name = path.split('/').pop() ?? path;
  return {
    id: pathToModuleId(path),
    name,
    path,
    pathId: path,
    fileCount: files.length,
    linesOfCode: 40,
    symbols,
    files,
  };
}

describe('commit-selector', () => {
  it('selects first and last commits', () => {
    const commits: CommitInfo[] = [
      { hash: 'aaa', shortHash: 'aaa', date: '2024-01-01', message: 'first', author: 'a', filesChanged: 1 },
      { hash: 'bbb', shortHash: 'bbb', date: '2024-06-01', message: 'mid', author: 'b', filesChanged: 2 },
      { hash: 'ccc', shortHash: 'ccc', date: '2024-12-01', message: 'last', author: 'c', filesChanged: 1 },
    ];
    const selected = selectImportantCommits(commits, { maxSnapshots: 10, minDaysBetweenSnapshots: 30 });
    assert.ok(selected.some((c) => c.hash === 'aaa'));
    assert.ok(selected.some((c) => c.hash === 'ccc'));
  });
});

describe('snapshot-builder', () => {
  it('detects module paths', () => {
    assert.equal(detectModulePath('src/agent/run.ts'), 'src/agent');
    assert.equal(detectModulePath('packages/core/src/index.ts'), 'packages/core');
    assert.equal(detectModulePath('apps/web/src/App.tsx'), 'apps/web');
  });

  it('skips test files', () => {
    assert.equal(detectModulePath('src/agent/run.test.ts'), null);
    assert.equal(detectModulePath('src/__tests__/foo.ts'), null);
  });

  it('models a root-level package entry point as a module', async () => {
    const files = new Map([
      ['package.json', JSON.stringify({ name: 'single-file-package' })],
      ['index.js', 'export default async function map() { return []; }\n'.repeat(20)],
    ]);
    const git: GitAnalyzer = {
      clone: async () => {},
      open: async () => {},
      getDefaultBranch: async () => 'main',
      getTotalCommits: async () => 1,
      getCommits: async () => [],
      getFilesAtCommit: async () => [...files.keys()].map((path) => ({ path, type: 'blob' as const })),
      getFileContentAtCommit: async (_commit, filePath) => files.get(filePath) ?? null,
      getDiffStats: async () => ({ files: [], insertions: 0, deletions: 0 }),
      getNameStatus: async () => ({ added: [], deleted: [], modified: [], renamed: [], files: [] }),
      cleanup: async () => {},
    };
    const commit: CommitInfo = {
      hash: 'abc', shortHash: 'abc', date: '2026-01-01', message: 'initial', author: 'test', filesChanged: 2,
    };

    const snapshot = await new SnapshotBuilder(git).buildSnapshot(commit);

    assert.equal(snapshot.modules.length, 1);
    assert.equal(snapshot.modules[0].name, 'single-file-package');
    assert.deepEqual(snapshot.modules[0].files, ['index.js']);
  });

  it('parses TypeScript exports via compiler API', () => {
    const content = `
      export class Agent { run() {} }
      export function execute() {}
      import { Tool } from './tools';
      export { Helper } from './helper';
    `;
    const { symbols, imports } = parseSourceFile(content, 'agent.ts');
    assert.ok(symbols.includes('Agent'));
    assert.ok(symbols.includes('execute'));
    assert.ok(imports.includes('./tools'));
    assert.ok(imports.includes('./helper'));
  });

  it('resolves relative imports from the importing source file and supports index files', () => {
    const fileToModule = new Map([
      ['src/feature/deep/entry.ts', 'src/feature'],
      ['src/shared/util.ts', 'src/shared'],
      ['src/shared/index.ts', 'src/shared'],
      ['src/other/index.ts', 'src/other'],
    ]);

    assert.equal(
      resolveSpecifier('../../shared/util', 'src/feature/deep/entry.ts', [], new Map(), fileToModule, []),
      'src/shared'
    );
    assert.equal(
      resolveSpecifier('../shared', 'src/feature/entry.ts', [], new Map(), fileToModule, []),
      'src/shared'
    );
    assert.equal(
      resolveSpecifier('../../other', 'src/feature/deep/entry.ts', [], new Map(), fileToModule, []),
      'src/other'
    );
  });

  it('leaves unresolved relative and external imports without a target', () => {
    const fileToModule = new Map([['src/app/index.ts', 'src/app']]);

    assert.equal(
      resolveSpecifier('../missing', 'src/app/index.ts', [], new Map(), fileToModule, []),
      null
    );
    assert.equal(
      resolveSpecifier('lodash', 'src/app/index.ts', [], new Map(), fileToModule, []),
      null
    );
  });
});

describe('ts-js adapter', () => {
  it('extracts type-only imports separately', () => {
    const parsed = parseTsJs('a.ts', `import type { Foo } from './foo';\nimport { Bar } from './bar';`);
    assert.equal(parsed.imports.length, 2);
    assert.equal(parsed.imports.find((i) => i.specifier === './foo')?.isTypeOnly, true);
    assert.equal(parsed.imports.find((i) => i.specifier === './bar')?.isTypeOnly, false);
  });

  it('resolves tsconfig path aliases', () => {
    const aliases = aliasesFromPaths({ '@/*': ['src/*'] });
    assert.equal(resolvePathAlias('@/agent/run', aliases), 'src/agent/run');
  });
});

describe('change-detector', () => {
  it('detects added modules', () => {
    const detector = new ChangeDetector();
    const from: Snapshot = {
      id: 's1', commit: 'a', shortCommit: 'a', timestamp: '2024-01-01', message: '', author: '',
      modules: [mod('src/core', ['src/core/index.ts'], ['LLMClient'])],
      dependencies: [], totalFiles: 1, totalLines: 40, reconstructedFrom: 'git+typescript-ast', fingerprint: 't',
    };
    const to: Snapshot = {
      id: 's2', commit: 'b', shortCommit: 'b', timestamp: '2024-06-01', message: '', author: '',
      modules: [
        mod('src/core', ['src/core/index.ts'], ['LLMClient']),
        mod('src/agent', ['src/agent/index.ts'], ['Agent']),
      ],
      dependencies: [], totalFiles: 2, totalLines: 80, reconstructedFrom: 'git+typescript-ast', fingerprint: 't',
    };
    const delta = detector.detectDelta(from, to);
    assert.equal(delta.added.length, 1);
    assert.equal(delta.added[0].name, 'agent');
    assert.equal(delta.removed.length, 0);
    assert.ok(summarizeDelta(delta).includes('+1 modules'));
  });

  it('detects moves via git rename rather than add+remove', () => {
    const detector = new ChangeDetector();
    const from: Snapshot = {
      id: 's1', commit: 'a', shortCommit: 'a', timestamp: '2024-01-01', message: '', author: '',
      modules: [mod('src/core', ['src/core/index.ts'], ['LLMClient'])],
      dependencies: [], totalFiles: 1, totalLines: 40, reconstructedFrom: 'git+typescript-ast', fingerprint: 't',
    };
    const to: Snapshot = {
      id: 's2', commit: 'b', shortCommit: 'b', timestamp: '2024-06-01', message: '', author: '',
      modules: [mod('src/runtime', ['src/runtime/index.ts'], ['LLMClient'])],
      dependencies: [], totalFiles: 1, totalLines: 40, reconstructedFrom: 'git+typescript-ast', fingerprint: 't',
    };
    const delta = detector.detectDelta(from, to, [{ from: 'src/core/index.ts', to: 'src/runtime/index.ts', score: 100 }]);
    assert.equal(delta.moved.length, 1);
    assert.equal(delta.added.length, 0);
    assert.equal(delta.removed.length, 0);
    assert.equal(delta.moved[0].from, 'src/core');
    assert.equal(delta.moved[0].to, 'src/runtime');
  });

  it('detects splits from file overlap', () => {
    const detector = new ChangeDetector();
    const from: Snapshot = {
      id: 's1', commit: 'a', shortCommit: 'a', timestamp: '2024-01-01', message: '', author: '',
      modules: [mod('src/agent', ['src/agent/agent.ts', 'src/agent/tools.ts'], ['Agent', 'ToolRegistry'])],
      dependencies: [], totalFiles: 2, totalLines: 80, reconstructedFrom: 'git+typescript-ast', fingerprint: 't',
    };
    const to: Snapshot = {
      id: 's2', commit: 'b', shortCommit: 'b', timestamp: '2024-06-01', message: '', author: '',
      modules: [
        mod('src/planner', ['src/planner/agent.ts'], ['Agent']),
        mod('src/executor', ['src/executor/tools.ts'], ['ToolRegistry']),
      ],
      dependencies: [], totalFiles: 2, totalLines: 80, reconstructedFrom: 'git+typescript-ast', fingerprint: 't',
    };
    const delta = detector.detectDelta(from, to, [
      { from: 'src/agent/agent.ts', to: 'src/planner/agent.ts', score: 100 },
      { from: 'src/agent/tools.ts', to: 'src/executor/tools.ts', score: 100 },
    ]);
    assert.equal(delta.splits.length, 1);
    assert.equal(delta.splits[0].from, 'agent');
    assert.ok(delta.splits[0].to.includes('planner'));
    assert.ok(delta.splits[0].to.includes('executor'));
  });

  it('does not treat a similarly named new folder as a split', () => {
    const detector = new ChangeDetector();
    const from: Snapshot = {
      id: 's1', commit: 'a', shortCommit: 'a', timestamp: '2024-01-01', message: '', author: '',
      modules: [mod('src/agent', ['src/agent/run.ts'], ['run'])],
      dependencies: [], totalFiles: 1, totalLines: 40, reconstructedFrom: 'git+typescript-ast', fingerprint: 't',
    };
    const to: Snapshot = {
      id: 's2', commit: 'b', shortCommit: 'b', timestamp: '2024-06-01', message: '', author: '',
      modules: [
        mod('src/agent', ['src/agent/run.ts'], ['run']),
        mod('src/agency', ['src/agency/other.ts'], ['Other']),
      ],
      dependencies: [], totalFiles: 2, totalLines: 80, reconstructedFrom: 'git+typescript-ast', fingerprint: 't',
    };
    const delta = detector.detectDelta(from, to);
    assert.equal(delta.splits.length, 0);
    assert.equal(delta.added.length, 1);
    assert.equal(delta.added[0].name, 'agency');
  });

  it('does not infer a split from dependency overlap and repeated generic symbols alone', () => {
    const detector = new ChangeDetector();
    const fromAgent = mod('src/agent', ['src/agent/index.ts'], ['run']);
    const fromRuntime = mod('src/runtime', ['src/runtime/index.ts'], ['Runtime']);
    const toPlanner = mod('src/planner', ['src/planner/index.ts'], ['run']);
    const toExecutor = mod('src/executor', ['src/executor/index.ts'], ['run']);
    const toRuntime = mod('src/runtime', ['src/runtime/index.ts'], ['Runtime']);
    const from: Snapshot = {
      id: 's1', commit: 'a', shortCommit: 'a', timestamp: '2024-01-01', message: '', author: '',
      modules: [fromAgent, fromRuntime],
      dependencies: [{ from: fromAgent.id, to: fromRuntime.id, weight: 1 }],
      totalFiles: 2, totalLines: 80, reconstructedFrom: 'git+typescript-ast', fingerprint: 't',
    };
    const to: Snapshot = {
      id: 's2', commit: 'b', shortCommit: 'b', timestamp: '2024-06-01', message: '', author: '',
      modules: [toPlanner, toExecutor, toRuntime],
      dependencies: [
        { from: toPlanner.id, to: toRuntime.id, weight: 1 },
        { from: toExecutor.id, to: toRuntime.id, weight: 1 },
      ],
      totalFiles: 3, totalLines: 120, reconstructedFrom: 'git+typescript-ast', fingerprint: 't',
    };

    const delta = detector.detectDelta(from, to);
    assert.equal(delta.splits.length, 0);
    assert.equal(delta.removed.some((module) => module.path === 'src/agent'), true);
  });

  it('does not infer a merge from dependency overlap and repeated generic symbols alone', () => {
    const detector = new ChangeDetector();
    const fromPlanner = mod('src/planner', ['src/planner/index.ts'], ['run']);
    const fromExecutor = mod('src/executor', ['src/executor/index.ts'], ['run']);
    const fromRuntime = mod('src/runtime', ['src/runtime/index.ts'], ['Runtime']);
    const toAgent = mod('src/agent', ['src/agent/index.ts'], ['run']);
    const toRuntime = mod('src/runtime', ['src/runtime/index.ts'], ['Runtime']);
    const from: Snapshot = {
      id: 's1', commit: 'a', shortCommit: 'a', timestamp: '2024-01-01', message: '', author: '',
      modules: [fromPlanner, fromExecutor, fromRuntime],
      dependencies: [
        { from: fromPlanner.id, to: fromRuntime.id, weight: 1 },
        { from: fromExecutor.id, to: fromRuntime.id, weight: 1 },
      ],
      totalFiles: 3, totalLines: 120, reconstructedFrom: 'git+typescript-ast', fingerprint: 't',
    };
    const to: Snapshot = {
      id: 's2', commit: 'b', shortCommit: 'b', timestamp: '2024-06-01', message: '', author: '',
      modules: [toAgent, toRuntime],
      dependencies: [{ from: toAgent.id, to: toRuntime.id, weight: 1 }],
      totalFiles: 2, totalLines: 80, reconstructedFrom: 'git+typescript-ast', fingerprint: 't',
    };

    const delta = detector.detectDelta(from, to);
    assert.equal(delta.merges.length, 0);
    assert.equal(delta.added.some((module) => module.path === 'src/agent'), true);
  });
});

describe('module identity', () => {
  it('matches modules that moved with the same files', () => {
    const from = [mod('src/core', ['src/core/llm.ts'], ['LLMClient'])];
    const to = [mod('src/runtime', ['src/runtime/llm.ts'], ['LLMClient'])];
    const matches = matchModules(from, to, [{ from: 'src/core/llm.ts', to: 'src/runtime/llm.ts' }]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].reason, 'rename');
  });

  it('uses dependency neighborhoods to disambiguate a structural move', () => {
    const before = mod('src/api', ['src/api/index.ts'], ['handle', 'validate']);
    const databaseBefore = mod('src/database', ['src/database/index.ts'], ['query']);
    const loggerBefore = mod('src/logger', ['src/logger/index.ts'], ['log']);
    const after = mod('src/service', ['src/service/main.ts'], ['handle', 'validate']);
    const decoy = mod('src/worker', ['src/worker/main.ts'], ['handle', 'validate']);
    const databaseAfter = mod('src/database', ['src/database/index.ts'], ['query']);
    const loggerAfter = mod('src/logger', ['src/logger/index.ts'], ['log']);
    const beforeModules = [before, databaseBefore, loggerBefore];
    const afterModules = [after, decoy, databaseAfter, loggerAfter];
    const matches = matchModules(
      beforeModules,
      afterModules,
      [],
      {
        modules: beforeModules,
        dependencies: [
          { from: before.id, to: databaseBefore.id, weight: 1 },
          { from: loggerBefore.id, to: before.id, weight: 1 },
        ],
      },
      {
        modules: afterModules,
        dependencies: [
          { from: after.id, to: databaseAfter.id, weight: 1 },
          { from: loggerAfter.id, to: after.id, weight: 1 },
        ],
      }
    );

    const moved = matches.find((match) => match.from.path === 'src/api');
    assert.equal(moved?.to.path, 'src/service');
    assert.equal(moved?.reason, 'structure');
  });

  it('leaves equally plausible structural matches unresolved', () => {
    const before = mod('src/api', ['src/api/index.ts'], ['handle', 'validate']);
    const databaseBefore = mod('src/database', ['src/database/index.ts'], ['query']);
    const first = mod('src/service-a', ['src/service-a/main.ts'], ['handle', 'validate']);
    const second = mod('src/service-b', ['src/service-b/main.ts'], ['handle', 'validate']);
    const databaseAfter = mod('src/database', ['src/database/index.ts'], ['query']);
    const beforeModules = [before, databaseBefore];
    const afterModules = [first, second, databaseAfter];
    const matches = matchModules(
      beforeModules,
      afterModules,
      [],
      {
        modules: beforeModules,
        dependencies: [{ from: before.id, to: databaseBefore.id, weight: 1 }],
      },
      {
        modules: afterModules,
        dependencies: [
          { from: first.id, to: databaseAfter.id, weight: 1 },
          { from: second.id, to: databaseAfter.id, weight: 1 },
        ],
      }
    );

    assert.equal(matches.some((match) => match.from.path === 'src/api'), false);
  });

  it('rewrites dependency endpoints when stabilizing a moved module identity', () => {
    const before = mod('src/api', ['src/api/index.ts'], ['handle']);
    const databaseBefore = mod('src/database', ['src/database/index.ts'], ['query']);
    const after = mod('src/service', ['src/service/main.ts'], ['handle']);
    const databaseAfter = mod('src/database', ['src/database/index.ts'], ['query']);
    const snapshots: Snapshot[] = [
      {
        id: 's1', commit: 'a', shortCommit: 'a', timestamp: '2024-01-01', message: '', author: '',
        modules: [before, databaseBefore],
        dependencies: [{ from: before.id, to: databaseBefore.id, weight: 1 }],
        totalFiles: 2, totalLines: 80, reconstructedFrom: 'git+typescript-ast', fingerprint: 'before',
      },
      {
        id: 's2', commit: 'b', shortCommit: 'b', timestamp: '2024-06-01', message: '', author: '',
        modules: [after, databaseAfter],
        dependencies: [{ from: after.id, to: databaseAfter.id, weight: 1 }],
        totalFiles: 2, totalLines: 80, reconstructedFrom: 'git+typescript-ast', fingerprint: 'after',
      },
    ];

    stabilizeSnapshotIdentities(snapshots);

    assert.equal(after.id, before.id);
    assert.equal(snapshots[1].dependencies[0].from, before.id);
    assert.notEqual(snapshots[1].fingerprint, 'after');
  });
});

describe('event-clusterer', () => {
  it('classifies feature introduction', () => {
    const type = classifyEventType(
      [{ type: 'added', module: 'memory' }, { type: 'added', module: 'mcp' }],
      [{ hash: 'a', shortHash: 'a', date: '2024-01-01', message: 'add memory', author: 'x', filesChanged: 5 }]
    );
    assert.equal(type, 'feature_introduction');
  });

  it('classifies module split', () => {
    const type = classifyEventType(
      [{ type: 'split', module: 'agent', to: ['planner', 'executor'] }],
      [{ hash: 'a', shortHash: 'a', date: '2024-01-01', message: 'split agent', author: 'x', filesChanged: 20 }]
    );
    assert.equal(type, 'module_split');
  });
});
