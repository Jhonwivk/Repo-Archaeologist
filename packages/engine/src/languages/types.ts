export interface ImportSpec {
  specifier: string;
  kind: 'esm' | 'require' | 'export-from';
  isTypeOnly: boolean;
}

export interface ParsedSource {
  imports: ImportSpec[];
  exports: string[];
  reExports: string[];
}

export interface LanguageAdapter {
  readonly id: string;
  readonly extensions: readonly string[];
  parse(filePath: string, content: string): ParsedSource;
}

export const TS_JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'] as const;

export function isTsJsFile(filePath: string): boolean {
  const ext = extname(filePath);
  return (TS_JS_EXTENSIONS as readonly string[]).includes(ext);
}

function extname(filePath: string): string {
  const slash = filePath.lastIndexOf('/');
  const base = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot).toLowerCase() : '';
}
