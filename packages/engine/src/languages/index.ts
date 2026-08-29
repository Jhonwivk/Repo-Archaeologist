import type { LanguageAdapter, ParsedSource } from './types.js';
import { isTsJsFile } from './types.js';
import { tsJsAdapter } from './ts-js.js';

const adapters: LanguageAdapter[] = [tsJsAdapter];

export function adapterForFile(filePath: string): LanguageAdapter | null {
  if (isTsJsFile(filePath)) return tsJsAdapter;
  return null;
}

export function parseSource(filePath: string, content: string): ParsedSource | null {
  const adapter = adapterForFile(filePath);
  if (!adapter) return null;
  try {
    return adapter.parse(filePath, content);
  } catch {
    return { imports: [], exports: [], reExports: [] };
  }
}

export { tsJsAdapter, isTsJsFile };
export type { LanguageAdapter, ParsedSource, ImportSpec } from './types.js';
export { parseTsconfigPaths, aliasesFromPaths, resolvePathAlias } from './ts-js.js';
export type { PathAlias } from './ts-js.js';
