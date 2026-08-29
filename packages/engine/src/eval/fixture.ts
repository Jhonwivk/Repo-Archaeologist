import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface FixtureCommit {
  message: string;
  date: string;
  hash?: string;
}

function git(dir: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Eval Bot',
      GIT_AUTHOR_EMAIL: 'eval@repo-archaeologist.dev',
      GIT_COMMITTER_NAME: 'Eval Bot',
      GIT_COMMITTER_EMAIL: 'eval@repo-archaeologist.dev',
      ...env,
    },
  }).trim();
}

async function write(dir: string, rel: string, content: string): Promise<void> {
  const full = join(dir, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content, 'utf8');
}

/**
 * Synthetic TypeScript repo with known add / move / split / merge events.
 */
export async function createEvolutionLabFixture(dir: string): Promise<{ commits: FixtureCommit[] }> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Eval Bot']);
  git(dir, ['config', 'user.email', 'eval@repo-archaeologist.dev']);

  const commits: FixtureCommit[] = [];

  const commit = async (message: string, date: string) => {
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', message, '--allow-empty'], {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
    const hash = git(dir, ['rev-parse', 'HEAD']);
    commits.push({ message, date, hash });
  };

  await write(dir, 'package.json', JSON.stringify({ name: 'evolution-lab', version: '1.0.0' }, null, 2));
  await write(dir, 'tsconfig.json', JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'NodeNext', strict: true, paths: { '@lab/*': ['src/*'] } },
  }, null, 2));
  await write(dir, 'src/cli/index.ts', `import { LLMClient } from '../core/index.js';
export function main(): string {
  return new LLMClient().complete('hello');
}
`);
  await write(dir, 'src/core/index.ts', `export class LLMClient {
  complete(prompt: string): string {
    return prompt.toUpperCase();
  }
}
`);
  await commit('Initial commit: CLI + Core', '2023-01-15T10:00:00Z');

  await write(dir, 'src/storage/index.ts', `export class Storage {
  get(key: string): string | undefined {
    return key;
  }
}
`);
  await write(dir, 'src/config/index.ts', `export function loadConfig(): { env: string } {
  return { env: 'dev' };
}
`);
  await write(dir, 'src/cli/index.ts', `import { LLMClient } from '../core/index.js';
import { Storage } from '../storage/index.js';
import { loadConfig } from '../config/index.js';
export function main(): string {
  loadConfig();
  new Storage().get('x');
  return new LLMClient().complete('hello');
}
`);
  await commit('Introduce storage and config modules', '2023-06-01T10:00:00Z');

  await write(dir, 'src/agent/agent.ts', `import { LLMClient } from '../core/index.js';
export class Agent {
  constructor(private llm: LLMClient) {}
  run(prompt: string): string {
    return this.llm.complete(prompt);
  }
}
`);
  await write(dir, 'src/agent/tools.ts', `export class ToolRegistry {
  tools: string[] = [];
  register(name: string): void {
    this.tools.push(name);
  }
}
`);
  await write(dir, 'src/agent/index.ts', `export { Agent } from './agent.js';
export { ToolRegistry } from './tools.js';
`);
  await write(dir, 'src/cli/index.ts', `import { Agent } from '../agent/index.js';
import { LLMClient } from '../core/index.js';
export function main(): string {
  return new Agent(new LLMClient()).run('hello');
}
`);
  await commit('Introduce Agent abstraction with tools', '2024-01-10T10:00:00Z');

  git(dir, ['mv', 'src/core', 'src/runtime']);
  await write(dir, 'src/agent/agent.ts', `import { LLMClient } from '../runtime/index.js';
export class Agent {
  constructor(private llm: LLMClient) {}
  run(prompt: string): string {
    return this.llm.complete(prompt);
  }
}
`);
  await write(dir, 'src/cli/index.ts', `import { Agent } from '../agent/index.js';
import { LLMClient } from '../runtime/index.js';
export function main(): string {
  return new Agent(new LLMClient()).run('hello');
}
`);
  await commit('Move core module to runtime', '2024-06-01T10:00:00Z');

  await mkdir(join(dir, 'src/planner'), { recursive: true });
  await mkdir(join(dir, 'src/executor'), { recursive: true });
  git(dir, ['mv', 'src/agent/agent.ts', 'src/planner/agent.ts']);
  git(dir, ['mv', 'src/agent/tools.ts', 'src/executor/tools.ts']);
  await write(dir, 'src/planner/index.ts', `export { Agent as Planner } from './agent.js';
`);
  await write(dir, 'src/executor/index.ts', `export { ToolRegistry as Executor } from './tools.js';
`);
  await rm(join(dir, 'src/agent'), { recursive: true, force: true });
  await write(dir, 'src/cli/index.ts', `import { Planner } from '../planner/index.js';
import { Executor } from '../executor/index.js';
import { LLMClient } from '../runtime/index.js';
export function main(): string {
  new Executor().register('echo');
  return new Planner(new LLMClient()).run('hello');
}
`);
  await commit('Split Agent into Planner and Executor', '2024-09-01T10:00:00Z');

  await mkdir(join(dir, 'src/persist'), { recursive: true });
  git(dir, ['mv', 'src/storage/index.ts', 'src/persist/storage.ts']);
  git(dir, ['mv', 'src/config/index.ts', 'src/persist/config.ts']);
  await write(dir, 'src/persist/index.ts', `export { Storage } from './storage.js';
export { loadConfig } from './config.js';
`);
  await rm(join(dir, 'src/storage'), { recursive: true, force: true }).catch(() => {});
  await rm(join(dir, 'src/config'), { recursive: true, force: true }).catch(() => {});
  await commit('Merge storage and config into persist', '2025-01-15T10:00:00Z');

  await write(dir, 'src/mcp/index.ts', `export class MCPClient {
  connect(): void {}
}
`);
  await write(dir, 'src/executor/index.ts', `export { ToolRegistry as Executor } from './tools.js';
export { MCPClient } from '../mcp/index.js';
`);
  await commit('Introduce MCP client', '2025-03-20T10:00:00Z');

  return { commits };
}
