import ts from 'typescript';
import type { ImportSpec, LanguageAdapter, ParsedSource } from './types.js';
import { TS_JS_EXTENSIONS } from './types.js';

function scriptKindFor(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

export class TsJsAdapter implements LanguageAdapter {
  readonly id = 'typescript';
  readonly extensions = TS_JS_EXTENSIONS;

  parse(filePath: string, content: string): ParsedSource {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(filePath)
    );

    const imports: ImportSpec[] = [];
    const exports: string[] = [];
    const reExports: string[] = [];

    const addExport = (name: string | undefined) => {
      if (name && !exports.includes(name)) exports.push(name);
    };

    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push({
          specifier: node.moduleSpecifier.text,
          kind: 'esm',
          isTypeOnly: node.importClause?.isTypeOnly === true,
        });
      }

      if (ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const spec = node.moduleSpecifier.text;
          reExports.push(spec);
          imports.push({
            specifier: spec,
            kind: 'export-from',
            isTypeOnly: node.isTypeOnly,
          });
        }
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const el of node.exportClause.elements) {
            addExport(el.name.text);
          }
        }
      }

      if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
        addExport(node.expression.text);
      }

      const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
      const isExported = Boolean(mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));

      if (isExported) {
        if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
          addExport(node.name?.text);
        }
        if (ts.isVariableStatement(node)) {
          for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) addExport(decl.name.text);
          }
        }
      }

      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.Identifier) {
        const fn = (node.expression as ts.Identifier).text;
        if (fn === 'require' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          imports.push({
            specifier: node.arguments[0].text,
            kind: 'require',
            isTypeOnly: false,
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return { imports, exports: exports.slice(0, 40), reExports };
  }
}

export const tsJsAdapter = new TsJsAdapter();

export function parseTsJs(filePath: string, content: string): ParsedSource {
  return tsJsAdapter.parse(filePath, content);
}

export function parseTsconfigPaths(content: string): Record<string, string[]> {
  const { config } = ts.parseConfigFileTextToJson('tsconfig.json', content);
  const paths = (config as { compilerOptions?: { paths?: Record<string, string[]> } } | undefined)
    ?.compilerOptions?.paths;
  return paths ?? {};
}

export interface PathAlias {
  prefix: string;
  targets: string[];
}

export function aliasesFromPaths(paths: Record<string, string[]>, baseUrl = '.'): PathAlias[] {
  return Object.entries(paths).map(([pattern, targets]) => ({
    prefix: pattern.replace(/\*$/, ''),
    targets: targets.map((t) => {
      const stripped = t.replace(/\*$/, '');
      return baseUrl === '.' ? stripped : `${baseUrl.replace(/\/$/, '')}/${stripped}`.replace(/^\.\//, '');
    }),
  }));
}

export function resolvePathAlias(specifier: string, aliases: PathAlias[]): string | null {
  for (const alias of aliases) {
    if (specifier === alias.prefix.replace(/\/$/, '') || specifier.startsWith(alias.prefix)) {
      const rest = specifier.slice(alias.prefix.length);
      const target = alias.targets[0];
      if (target === undefined) continue;
      return `${target}${rest}`.replace(/\/+/g, '/');
    }
  }
  return null;
}
