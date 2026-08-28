import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectImportantCommits } from './commit-selector.js';
import { ChangeDetector, summarizeDelta } from './change-detector.js';
import { classifyEventType } from './event-clusterer.js';
import { detectModulePath, parseSourceFile } from './snapshot-builder.js';
import type { Snapshot } from '@repo-archaeologist/core';
import type { CommitInfo } from './git/types.js';

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

  it('parses TypeScript exports', () => {
    const content = `
      export class Agent { run() {} }
      export function execute() {}
      import { Tool } from './tools';
    `;
    const { symbols, imports } = parseSourceFile(content, 'agent.ts');
    assert.ok(symbols.includes('Agent'));
    assert.ok(symbols.includes('execute'));
    assert.ok(imports.includes('./tools'));
  });
});

describe('change-detector', () => {
  it('detects added and removed modules', () => {
    const detector = new ChangeDetector();
    const from: Snapshot = {
      id: 's1', commit: 'a', shortCommit: 'a', timestamp: '2024-01-01', message: '', author: '',
      modules: [{ id: 'src-core', name: 'core', path: 'src/core', fileCount: 3, linesOfCode: 100, symbols: [] }],
      dependencies: [], totalFiles: 3, totalLines: 100,
    };
    const to: Snapshot = {
      id: 's2', commit: 'b', shortCommit: 'b', timestamp: '2024-06-01', message: '', author: '',
      modules: [
        { id: 'src-core', name: 'core', path: 'src/core', fileCount: 3, linesOfCode: 100, symbols: [] },
        { id: 'src-agent', name: 'agent', path: 'src/agent', fileCount: 5, linesOfCode: 200, symbols: [] },
      ],
      dependencies: [], totalFiles: 8, totalLines: 300,
    };
    const delta = detector.detectDelta(from, to);
    assert.equal(delta.added.length, 1);
    assert.equal(delta.added[0].name, 'agent');
    assert.equal(delta.removed.length, 0);
    assert.ok(summarizeDelta(delta).includes('+1 modules'));
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
