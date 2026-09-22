/**
 * The module specifiers a TypeScript file names, read off its syntax tree —
 * the primitive behind the runner's import fences.
 *
 * Four fences stand on it: `src/harness/` and production `src/shared/` never
 * import `src/activities/` (`harness/__tests__/import-direction.test.ts`,
 * the rule the turn runtime is written under); the Cursor adapter never
 * imports `@temporalio/*` (`execute-cursor/__tests__/adapter-is-temporal-
 * free.test.ts`, what lets the contract kit run it outside an activity);
 * `src/harness/transcript/` names no package outside a short allow-list
 * (`harness/__tests__/transcript-is-engine-free.test.ts`, what keeps the one
 * transcript builder engine-neutral); and `loadConfig` is bound by `main.ts`
 * alone (`__tests__/config-boundary.test.ts`, what keeps one live credential
 * ref per process — `importedBindings` below reads the NAMES a file imports,
 * where the other fences read the modules).
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
 * The module specifiers a file LOADS when it is itself loaded: static
 * imports and re-exports that are not type-only. A `import type` is erased
 * by the compiler and a dynamic `import()` runs only when its call runs, so
 * neither is on the static graph — which is what the SDK-free fences on the
 * adapters' lifecycle modules ask about (`harness-adapters.ts`'s rule: the
 * roots import the table before they boot it, so an adapter loads its SDK
 * inside `boot`, never at the top of its module).
 */
export function staticRuntimeSpecifiers(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /* setParentNodes */ false);
  const specifiers: string[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (statement.importClause?.isTypeOnly) continue;
      specifiers.push(statement.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (statement.isTypeOnly) continue;
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
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

/**
 * The packages `source` names — every specifier that is neither a relative
 * path nor a `node:` builtin, reduced to its package (`@scope/name` or
 * `name`, the subpath dropped), deduplicated, in first-appearance order.
 *
 * What an ALLOW-list fence compares against, where `packageImports` serves a
 * deny: a deny-list must be extended for every SDK that does not exist yet,
 * an allow-list refuses it on the day it is written.
 */
export function packageNames(filePath: string, source: string): string[] {
  const names = new Set<string>();
  for (const specifier of moduleSpecifiers(filePath, source)) {
    if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
    names.add(packageName(specifier));
  }
  return [...names];
}

/** `@scope/name/sub/path` → `@scope/name`; `name/sub/path` → `name`. */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  const [first, second] = parts;
  if (first === undefined) return specifier;
  return first.startsWith("@") && second !== undefined ? `${first}/${second}` : first;
}

/** One name a file binds from a module: the exported name (`"*"` for a namespace import) and the specifier it came from. */
export interface ImportedBinding {
  readonly specifier: string;
  readonly name: string;
}

/**
 * Every name a file imports by static `import` declaration, in source order,
 * type-only included (a fence on a VALUE reads the same list; a type import
 * of a function is a smell the fence should see too). A namespace import
 * binds every export at once and is reported as `"*"`. Dynamic `import()`
 * binds nothing at the declaration and is not listed — a fence on a name
 * that must also refuse `(await import(m)).name` pairs this with
 * {@link moduleSpecifiers}.
 */
export function importedBindings(fileName: string, source: string): ImportedBinding[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /* setParentNodes */ false);
  const bindings: ImportedBinding[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause === undefined) continue;
    if (clause.name !== undefined) {
      bindings.push({ specifier, name: "default" });
    }
    const named = clause.namedBindings;
    if (named === undefined) continue;
    if (ts.isNamespaceImport(named)) {
      bindings.push({ specifier, name: "*" });
    } else {
      for (const element of named.elements) {
        bindings.push({ specifier, name: (element.propertyName ?? element.name).text });
      }
    }
  }
  return bindings;
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
