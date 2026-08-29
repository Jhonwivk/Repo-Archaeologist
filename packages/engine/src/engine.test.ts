import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectImportantCommits } from './commit-selector.js';
import { ChangeDetector, summarizeDelta } from './change-detector.js';
import { classifyEventType } from './event-clusterer.js';
import { detectModulePath, parseSourceFile } from './snapshot-builder.js';
import { parseTsJs, resolvePathAlias, aliasesFromPaths } from './languages/ts-js.js';
import { matchModules, pathToModuleId } from './module-identity.js';
import type { Snapshot, ModuleNode } from '@repo-archaeologist/core';
import type { CommitInfo } from './git/types.js';

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
});

describe('module identity', () => {
  it('matches modules that moved with the same files', () => {
    const from = [mod('src/core', ['src/core/llm.ts'], ['LLMClient'])];
    const to = [mod('src/runtime', ['src/runtime/llm.ts'], ['LLMClient'])];
    const matches = matchModules(from, to, [{ from: 'src/core/llm.ts', to: 'src/runtime/llm.ts' }]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].reason, 'rename');
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
