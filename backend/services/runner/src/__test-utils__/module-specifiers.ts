/**
 * The module specifiers a TypeScript file names, read off its syntax tree —
 * the primitive behind the runner's import fences.
 *
 * Two fences stand on it: `src/harness/` and production `src/shared/` never
 * import `src/activities/` (`harness/__tests__/import-direction.test.ts`,
 * the rule the turn runtime is written under), and the Cursor adapter never
 * imports `@temporalio/*` (`execute-cursor/__tests__/adapter-is-temporal-
 * free.test.ts`, what lets the contract kit run it outside an activity).
 *
 * A syntax tree, not a regex, so a path quoted in a header comment cannot
 * trip a fence, and no import form can slip past one: static, type-only,
 * side-effect, re-export and dynamic `import()` are all module specifiers to
 * the parser. A dynamic import whose argument is not a string literal names
 * nothing and is ignored (no fence has a literal to match).
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import ts from "typescript";

/** Every module specifier a file names, in source order, whatever the form. */
export function moduleSpecifiers(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /* setParentNodes */ false);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        specifiers.push(argument.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

/**
 * The relative specifiers in `source` that resolve to a path inside
 * `forbiddenRoot`. Package specifiers are ignored: no alias maps a package
 * name onto a source directory.
 */
export function forbiddenImports(filePath: string, source: string, forbiddenRoot: string): string[] {
  return moduleSpecifiers(filePath, source).filter((specifier) => {
    if (!specifier.startsWith(".")) return false;
    const target = resolve(dirname(filePath), specifier);
    return target === forbiddenRoot || target.startsWith(forbiddenRoot + sep);
  });
}

/** The package specifiers in `source` whose name is `pkg` or starts with `${pkg}/`. */
export function packageImports(filePath: string, source: string, pkg: string): string[] {
  return moduleSpecifiers(filePath, source).filter((specifier) => specifier === pkg || specifier.startsWith(`${pkg}/`));
}

/** Every `.ts` file under `dir`, sorted, skipping the named directories at any depth. */
export function typeScriptFilesUnder(dir: string, skipDirectories: ReadonlySet<string>): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirectories.has(entry.name)) {
        files.push(...typeScriptFilesUnder(path, skipDirectories));
      }
    } else if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files.sort();
}

/** Read a file for a sweep; one place so every fence reads the same bytes the compiler does. */
export function readSource(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}
