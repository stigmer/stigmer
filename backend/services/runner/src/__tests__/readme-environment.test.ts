/**
 * Pins that the runner's README names every environment variable the
 * runner's production source reads.
 *
 * Why it matters: `AGENTS.md` sends an operator to `README.md` for "every
 * environment variable", and the README is the one place a setting's meaning
 * is written down. Nothing checked that promise, and it drifted twelve times:
 * the three timeouts that decide when a stuck run fails, the secret that
 * keeps an approval valid across a restart, and the two switches that let
 * `web_fetch` reach private addresses and a cloud runner start stdio MCP
 * servers, among others. An operator cannot set, or harden, what they cannot
 * learn exists.
 *
 * What counts as reading a setting. An env object is `process.env` (also
 * through a default or namespace import of `node:process`, through
 * `globalThis` or `global`, and with either member written as a literal key,
 * `process["env"]`), `env` taken from `process` (imported, or destructured in
 * a declaration, a parameter, an assignment or a nested pattern), or an
 * identifier whose declaration (a parameter or a variable) is annotated
 * `NodeJS.ProcessEnv`, the injection seam `shared/runner-credential-store.ts`
 * describes, or is initialised or defaulted to `process.env` whatever its
 * type. A destructure follows the same path from the global object down, at
 * any depth, each member by a name or a key rule 2 can tell:
 * `const { process: { env: { NAME } } } = globalThis` reads `NAME`.
 * Parentheses and type assertions (`as`, `satisfies`, `!`, `<T>`) are seen
 * through. Identifiers are matched by name within the file, not by scope:
 * once one `env` in a file is an env object, every `env` there is read as
 * one, which errs toward a loud failure, never a silent miss.
 *
 * Not followed, so a setting read past one of these is not seen: an env
 * object handed on as a call's argument or a property; a spread copy (unless
 * the copy's declaration carries the annotation); a variable or parameter
 * holding `process` itself, whatever its annotation or however it was taken
 * from the global object; and a member of `process` or the global object
 * taken by a key rule 2 cannot tell (`process[k]`, `const { [k]: e } =
 * process`). Refusing that last one would refuse ordinary use of the global
 * object (`globalThis[name]`), which reads no setting.
 *
 *  1. `E.NAME`, `E["NAME"]`, `"NAME" in E`, or a destructure of an env object
 *     wherever the pattern stands: a variable's or parameter's pattern
 *     initialised, defaulted or annotated as one, the object on the left of a
 *     plain `=` whose right side is one, and `{ env: { NAME } }` from
 *     `process` (a computed key in a destructure is judged by rules 2 and 4).
 *  2. `E[K]` or `K in E`, where `K` is a string-literal `const` of the same
 *     file, or one imported by its own name from a relative module that
 *     exports it as a literal (an aliased import is not followed), and `K` is
 *     bound nowhere else in the file: a parameter or a second declaration of
 *     the same name makes the key ambiguous, so it is refused rather than
 *     guessed.
 *  3. The first argument of `requireEnv(...)` or `getRunnerSecret(...)`, a
 *     literal or a `K` as in rule 2.
 *  4. Any other computed-key read of an env object, `in` test, destructured
 *     key of another kind (a number, say) or reader call is refused ("cannot
 *     tell which setting this reads"), except inside the functions
 *     `COMPUTED_READS_ALLOWED` names, each with its reason. A dynamic read
 *     added later fails loudly instead of escaping the check.
 *
 * Writes are never reads: a plain assignment target (a compound one such as
 * `??=` reads the value first), a `delete` operand, a spread, an
 * object-literal key, `Object.entries` over an env object.
 *
 * The shape is `config-boundary.test.ts`'s: the checker lives beside the
 * fixtures that pin it, over the syntax-tree primitives in
 * `__test-utils__/module-specifiers.ts`, so a name in a comment or a string
 * never counts, and the sweep skips tests and test utilities. Both lists are
 * held live: every entry states its reason, and an exception the source no
 * longer reads, or the README now names, and an allowed function that no
 * longer reads by a computed key are refused as stale.
 *
 * What it never asserts: that every README row is read (rows also name what
 * `@stigmer/temporal-codecs` reads, some as `_PATH`/`_DATA` shorthand that
 * module builds from template strings), what a setting's default is, or how
 * a row is worded. A setting only a dependency reads by name is that
 * dependency's to list.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { readSource, typeScriptFilesUnder } from "../__test-utils__/module-specifiers.js";

const SRC_ROOT = fileURLToPath(new URL("../", import.meta.url));
const README_PATH = join(SRC_ROOT, "..", "README.md");
const OUTSIDE_THE_SWEEP = new Set(["__tests__", "__test-utils__"]);

/** The names the global object goes by, through which `process` is reached as a member. */
const GLOBAL_OBJECTS = new Set(["globalThis", "global"]);

/** What a destructure takes apart: the global object, `process`, or an env object. */
type DestructureSource = "global" | "process" | "env";

/** The member each source hands a level down, the path of `globalThis.process.env`. */
const HANDED_DOWN: ReadonlyMap<DestructureSource, { readonly member: string; readonly source: DestructureSource }> = new Map([
  ["global", { member: "process", source: "process" }],
  ["process", { member: "env", source: "env" }],
]);

/** The functions whose first argument names the setting they read (rule 3). */
const READERS = new Set(["requireEnv", "getRunnerSecret"]);

/** Names the runner reads that the README deliberately does not list, each with its reason. */
const NOT_SETTINGS: ReadonlyMap<string, string> = new Map([
  ["HOME", "the operating system's home directory, read to place the platform directory and the workspace lock"],
  ["USERPROFILE", "HOME's Windows counterpart, read beside it"],
  [
    "STIGMER_OPENAI_BACKEND",
    "only `public` works until the Azure adapter ships, and advertising it would point operators at a value that fails (shared/llm-backend.ts)",
  ],
]);

/**
 * Where a computed-key read is expected, as `<file under src>#<function>`, each with its reason. A
 * function goes by its own name, or by the variable, object property or class field holding it.
 */
const COMPUTED_READS_ALLOWED: ReadonlyMap<string, string> = new Map([
  ["config.ts#requireEnv", "its callers name the setting, and rule 3 reads it there"],
  [
    `${join("shared", "runner-credential-store.ts")}#captureRunnerSecrets`,
    "captures RUNNER_SECRET_ENV_KEYS at boot; each name is read where getRunnerSecret names it (rule 3)",
  ],
  [`${join("shared", "runner-credential-store.ts")}#getRunnerSecret`, "its callers name the setting, and rule 3 reads it there"],
  [`${join("shared", "llm-backend.ts")}#preflightLlmBackends`, "loops over two constants the same file reads directly (rule 2)"],
  [
    `${join("activities", "run-env.ts")}#buildRunEnv`,
    "forwards the operating system's base variables (RUN_ENV_BASE_KEYS) to a run task's child; it reads no runner setting",
  ],
]);

// ── The checker ──────────────────────────────────────────────────────────────

/** Resolves a constant a file imports: the literal `specifier` exports as `name`, if any. */
type ImportResolver = (specifier: string, name: string) => string | undefined;

interface Refusal {
  readonly line: number;
  readonly how: string;
}

interface SettingsRead {
  /** Every setting the file reads, sorted. */
  readonly names: readonly string[];
  /** Reads whose setting the checker cannot tell (rule 4). */
  readonly refused: readonly Refusal[];
  /** The allowed functions in which a computed-key read was found. */
  readonly computedIn: readonly string[];
}

function stringLiteralText(node: ts.Node | undefined): string | undefined {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

/** The expression inside parentheses and type assertions (`as`, `satisfies`, `!`, `<T>`), which change no value. */
function unwrapped(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** The member a property access or a literal-keyed element access names: `o.m` and `o["m"]` alike. */
function memberName(node: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return ts.isElementAccessExpression(node) ? stringLiteralText(node.argumentExpression) : undefined;
}

/** The file's string-literal `const` declarations, by name; `exportedOnly` keeps the exported top-level ones. */
function stringConstants(sourceFile: ts.SourceFile, exportedOnly: boolean): Map<string, string> {
  const constants = new Map<string, string>();
  const collect = (list: ts.VariableDeclarationList): void => {
    if ((list.flags & ts.NodeFlags.Const) === 0) return;
    for (const declaration of list.declarations) {
      const text = stringLiteralText(declaration.initializer);
      if (ts.isIdentifier(declaration.name) && text !== undefined) constants.set(declaration.name.text, text);
    }
  };
  if (exportedOnly) {
    for (const statement of sourceFile.statements) {
      const exported = ts.isVariableStatement(statement)
        && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (exported) collect(statement.declarationList);
    }
    return constants;
  }
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclarationList(node)) collect(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return constants;
}

/**
 * How many times each name is bound in the file: parameters, variables,
 * destructured names, functions, classes and imports. Matching is by name,
 * not scope, so a constant key resolves only when its name is bound once.
 */
function bindingCounts(sourceFile: ts.SourceFile): Map<string, number> {
  const counts = new Map<string, number>();
  const bind = (name: ts.Node | undefined): void => {
    if (name !== undefined && ts.isIdentifier(name)) counts.set(name.text, (counts.get(name.text) ?? 0) + 1);
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isBindingElement(node)
      || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
      || ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || ts.isImportClause(node)
    ) {
      bind(node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return counts;
}

/** The real tree's resolver: a relative `.js` specifier names the `.ts` module beside the importing file. */
function resolveFromTree(fromFile: string): ImportResolver {
  return (specifier, name) => {
    const target = resolve(dirname(fromFile), specifier.replace(/\.js$/, ".ts"));
    if (!existsSync(target)) return undefined;
    const sourceFile = ts.createSourceFile(target, readSource(target), ts.ScriptTarget.Latest, true);
    return stringConstants(sourceFile, true).get(name);
  };
}

/** The name a function-like node goes by: its own, or the variable, object property or class field holding it. */
function functionName(node: ts.Node): string | undefined {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name !== undefined && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return undefined;
  const holder = node.parent;
  if (ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)) return holder.name.text;
  if ((ts.isPropertyAssignment(holder) || ts.isPropertyDeclaration(holder)) && (ts.isIdentifier(holder.name) || ts.isStringLiteral(holder.name))) {
    return holder.name.text;
  }
  return undefined;
}

/** A plain assignment target or a `delete` operand; a compound assignment (`??=`, `+=`) reads the value first. */
function isWrite(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isDeleteExpression(parent)) return true;
  return ts.isBinaryExpression(parent) && parent.left === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
}

/** An object destructure in either syntax: a binding pattern, or an object literal that an assignment writes into. */
type ObjectPattern = ts.ObjectBindingPattern | ts.ObjectLiteralExpression;

/** One element of an object destructure: the property it takes and where that value goes. */
interface DestructuredElement {
  readonly node: ts.Node;
  readonly property: ts.PropertyName;
  readonly target: ts.Node;
}

function isObjectPattern(node: ts.Node): node is ObjectPattern {
  return ts.isObjectBindingPattern(node) || ts.isObjectLiteralExpression(node);
}

/** A plain `=` (a compound one such as `??=` cannot destructure). */
function isPlainAssignment(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken;
}

/**
 * The elements of a destructure, in either syntax, with a rest element left
 * out: it copies the remainder and names no setting. An assignment element's
 * default (`{ NAME: v = "d" }`) is stripped, so its target is `v`.
 */
function destructuredElements(pattern: ObjectPattern): DestructuredElement[] {
  const elements: DestructuredElement[] = [];
  if (ts.isObjectBindingPattern(pattern)) {
    for (const element of pattern.elements) {
      const property = element.propertyName ?? (ts.isIdentifier(element.name) ? element.name : undefined);
      if (element.dotDotDotToken === undefined && property !== undefined) elements.push({ node: element, property, target: element.name });
    }
    return elements;
  }
  for (const element of pattern.properties) {
    if (ts.isShorthandPropertyAssignment(element)) {
      elements.push({ node: element, property: element.name, target: element.name });
    } else if (ts.isPropertyAssignment(element)) {
      const target = isPlainAssignment(element.initializer) ? element.initializer.left : element.initializer;
      elements.push({ node: element, property: element.name, target });
    }
  }
  return elements;
}

/** A property's name when it is written as a name or a string, the only forms a setting is named by. */
function propertyText(property: ts.PropertyName): string | undefined {
  return ts.isIdentifier(property) || ts.isStringLiteral(property) ? property.text : undefined;
}

/**
 * The settings one file reads, by the four rules in the header.
 * `allowedFunctions` are the functions of this file where a computed-key read
 * is expected.
 */
function settingsReadIn(
  fileName: string,
  source: string,
  allowedFunctions: ReadonlySet<string>,
  resolveImport: ImportResolver,
): SettingsRead {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /* setParentNodes */ true);
  const constants = stringConstants(sourceFile, false);
  /** The names `process` is bound to: the global, and a default or namespace import of the module. */
  const processNames = new Set(["process"]);
  const envIdentifiers = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause === undefined) continue;
    if (specifier === "node:process" || specifier === "process") {
      if (clause.name !== undefined) processNames.add(clause.name.text);
      const named = clause.namedBindings;
      if (named !== undefined && ts.isNamespaceImport(named)) processNames.add(named.name.text);
      if (named !== undefined && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          if ((element.propertyName ?? element.name).text === "env") envIdentifiers.add(element.name.text);
        }
      }
    } else if (specifier.startsWith(".") && clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (element.propertyName !== undefined || constants.has(element.name.text)) continue;
        const text = resolveImport(specifier, element.name.text);
        if (text !== undefined) constants.set(element.name.text, text);
      }
    }
  }

  const isGlobalObject = (node: ts.Expression): boolean => {
    const value = unwrapped(node);
    return ts.isIdentifier(value) && GLOBAL_OBJECTS.has(value.text);
  };
  /** `process` itself: a name it is bound to, or the global's member on `globalThis` or `global`. */
  const isProcess = (node: ts.Expression): boolean => {
    const value = unwrapped(node);
    if (ts.isIdentifier(value)) return processNames.has(value.text);
    return (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value))
      && memberName(value) === "process"
      && isGlobalObject(value.expression);
  };
  const isProcessEnv = (node: ts.Expression | undefined): boolean => {
    if (node === undefined) return false;
    const value = unwrapped(node);
    return (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value))
      && memberName(value) === "env"
      && isProcess(value.expression);
  };
  const isEnvObject = (node: ts.Expression): boolean => {
    const value = unwrapped(node);
    return isProcessEnv(value) || (ts.isIdentifier(value) && envIdentifiers.has(value.text));
  };
  const isAnnotatedProcessEnv = (declaration: ts.ParameterDeclaration | ts.VariableDeclaration): boolean =>
    declaration.type?.getText(sourceFile) === "NodeJS.ProcessEnv";

  const bound = bindingCounts(sourceFile);
  const keyOf = (node: ts.Expression | undefined): string | undefined =>
    stringLiteralText(node)
    ?? (node !== undefined && ts.isIdentifier(node) && bound.get(node.text) === 1 ? constants.get(node.text) : undefined);
  /** The key a destructured element takes, by a name or a string, or by a computed key rule 2 can tell. */
  const elementKey = (property: ts.PropertyName): string | undefined =>
    propertyText(property) ?? (ts.isComputedPropertyName(property) ? keyOf(property.expression) : undefined);
  const sourceOf = (value: ts.Expression | undefined): DestructureSource | undefined => {
    if (value === undefined) return undefined;
    if (isEnvObject(value)) return "env";
    if (isProcess(value)) return "process";
    return isGlobalObject(value) ? "global" : undefined;
  };

  /**
   * Patterns nested under a member `HANDED_DOWN` names, each with the source it
   * takes apart. A nested pattern is read from the element holding it, never
   * from its own parent node, so one with a default is read whatever that
   * default is.
   */
  const nestedPatterns = new Map<ObjectPattern, DestructureSource>();
  /** The destructure a node is, and what it takes apart: a declaration's or parameter's pattern, the object a plain `=` writes into, or a nested pattern. */
  const destructureAt = (node: ts.Node): { readonly pattern: ObjectPattern; readonly source: DestructureSource } | undefined => {
    let pattern: ObjectPattern;
    let source: DestructureSource | undefined;
    if (isObjectPattern(node) && nestedPatterns.has(node)) {
      pattern = node;
      source = nestedPatterns.get(node);
    } else if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isObjectBindingPattern(node.name)) {
      pattern = node.name;
      source = isAnnotatedProcessEnv(node) ? "env" : sourceOf(node.initializer);
    } else if (isPlainAssignment(node) && ts.isObjectLiteralExpression(node.left)) {
      pattern = node.left;
      source = sourceOf(node.right);
    } else {
      return undefined;
    }
    return source === undefined ? undefined : { pattern, source };
  };

  /**
   * Env identifiers, and the patterns nested down the path. Source order is
   * the walk's order, so a pattern is filed before the walk reaches the ones
   * nested in it.
   */
  const collectEnvIdentifiers = (node: ts.Node): void => {
    if (
      (ts.isParameter(node) || ts.isVariableDeclaration(node))
      && ts.isIdentifier(node.name)
      && (isAnnotatedProcessEnv(node) || isProcessEnv(node.initializer))
    ) {
      envIdentifiers.add(node.name.text);
    }
    const destructure = destructureAt(node);
    const step = destructure === undefined ? undefined : HANDED_DOWN.get(destructure.source);
    if (destructure !== undefined && step !== undefined) {
      for (const { property, target } of destructuredElements(destructure.pattern)) {
        if (elementKey(property) !== step.member) continue;
        if (isObjectPattern(target)) nestedPatterns.set(target, step.source);
        else if (step.source === "env" && ts.isIdentifier(target)) envIdentifiers.add(target.text);
      }
    }
    ts.forEachChild(node, collectEnvIdentifiers);
  };
  collectEnvIdentifiers(sourceFile);

  const lineOf = (node: ts.Node): number => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const names = new Set<string>();
  const refused: Refusal[] = [];
  const computedIn = new Set<string>();
  const unresolved = (node: ts.Node, enclosing: string | undefined, how: string): void => {
    if (enclosing !== undefined && allowedFunctions.has(enclosing)) computedIn.add(enclosing);
    else refused.push({ line: lineOf(node), how });
  };
  /** Rule 1 for a destructure of an env object, its computed keys by rules 2 and 4, any other key kind refused. */
  const readDestructure = (pattern: ObjectPattern, enclosing: string | undefined): void => {
    for (const { node, property } of destructuredElements(pattern)) {
      const text = propertyText(property);
      if (text !== undefined) {
        names.add(text);
      } else if (ts.isComputedPropertyName(property)) {
        const key = keyOf(property.expression);
        if (key !== undefined) names.add(key);
        else unresolved(node, enclosing, `destructures ${property.getText(sourceFile)}, whose setting cannot be told`);
      } else {
        unresolved(node, enclosing, `destructures ${property.getText(sourceFile)}, a key the checker does not read`);
      }
    }
  };

  const visit = (node: ts.Node, enclosing: string | undefined): void => {
    const here = functionName(node) ?? enclosing;
    const destructure = destructureAt(node);
    if (ts.isPropertyAccessExpression(node) && isEnvObject(node.expression) && !isWrite(node)) {
      names.add(node.name.text);
    } else if (ts.isElementAccessExpression(node) && isEnvObject(node.expression) && !isWrite(node)) {
      const key = keyOf(node.argumentExpression);
      if (key !== undefined) names.add(key);
      else unresolved(node, here, `reads ${node.getText(sourceFile)}, whose setting cannot be told`);
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InKeyword && isEnvObject(node.right)) {
      const key = keyOf(node.left);
      if (key !== undefined) names.add(key);
      else unresolved(node, here, `tests ${node.getText(sourceFile)}, whose setting cannot be told`);
    } else if (destructure?.source === "env") {
      readDestructure(destructure.pattern, here);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && READERS.has(node.expression.text)) {
      const key = keyOf(node.arguments[0]);
      if (key !== undefined) names.add(key);
      else unresolved(node, here, `calls ${node.expression.text} with a name that cannot be told`);
    }
    ts.forEachChild(node, (child) => visit(child, here));
  };
  visit(sourceFile, undefined);

  return { names: [...names].sort(), refused, computedIn: [...computedIn].sort() };
}

describe("settingsReadIn (the checker itself)", () => {
  const file = join(SRC_ROOT, "shared", "some-module.ts");
  const noImports: ImportResolver = () => undefined;
  const otherModule: ImportResolver = (specifier, name) => (specifier === "./other.js" && name === "K" ? "STIGMER_A" : undefined);
  const read = (source: string, resolveImport: ImportResolver = noImports, allowed: ReadonlySet<string> = new Set()): SettingsRead =>
    settingsReadIn(file, source, allowed, resolveImport);

  it.each([
    ["a property read", "const v = process.env.STIGMER_A;"],
    ["an element read with a literal key", 'const v = process.env["STIGMER_A"];'],
    ["a key held in a same-file constant", 'const K = "STIGMER_A"; const v = process.env[K];'],
    ["a property read on an injected env parameter", "function f(env: NodeJS.ProcessEnv = process.env) { return env.STIGMER_A?.trim(); }"],
    ["a constant key on an injected env parameter", 'const K = "STIGMER_A"; function f(env: NodeJS.ProcessEnv) { return env[K]; }'],
    ["a destructured read, its rest element not a setting", "const { STIGMER_A, ...rest } = process.env;"],
    ["a destructure through a constant key", 'const K = "STIGMER_A"; const { [K]: v } = process.env;'],
    ["a compound assignment, which reads the value first", 'process.env.STIGMER_A ??= "x";'],
    ["a read through an unannotated alias", "const env = process.env; const v = env.STIGMER_A;"],
    ["a read on env destructured from process", "const { env } = process; const v = env.STIGMER_A;"],
    ["a read on env imported from node:process", 'import { env } from "node:process"; const v = env.STIGMER_A;'],
    ["a read through a namespace import of node:process", 'import * as proc from "node:process"; const v = proc.env.STIGMER_A;'],
    [
      "a read on a parameter of another type that defaults to process.env",
      "function f(env: Record<string, string | undefined> = process.env) { return env.STIGMER_A; }",
    ],
    ["a reader call with a literal", 'const v = getRunnerSecret("STIGMER_A");'],
    ["a reader call with a constant", 'const ENV_VAR = "STIGMER_A"; const v = requireEnv(ENV_VAR);'],
    ["a parameter's destructure defaulted to process.env", "function f({ STIGMER_A } = process.env) { return STIGMER_A; }"],
    ["a parameter's destructure annotated NodeJS.ProcessEnv", "function f({ STIGMER_A }: NodeJS.ProcessEnv) { return STIGMER_A; }"],
    ["an assignment destructure into a renamed target", "let v; ({ STIGMER_A: v } = process.env);"],
    ["a shorthand assignment destructure with a default", 'let STIGMER_A; ({ STIGMER_A = "x" } = process.env);'],
    ["an assignment destructure through a constant key", 'const K = "STIGMER_A"; let v; ({ [K]: v } = process.env);'],
    ["an assignment destructure, its rest element not a setting", "let STIGMER_A, rest; ({ STIGMER_A, ...rest } = process.env);"],
    ["a destructure of env nested in a destructure of process", "const { env: { STIGMER_A } } = process;"],
    ["a nested destructure of env with a default", "const { env: { STIGMER_A } = {} } = process;"],
    ["a nested assignment destructure of env with a default", "let STIGMER_A; ({ env: { STIGMER_A } = {} } = process);"],
    ["a read on env destructured from process in a parameter", "function f({ env } = process) { return env.STIGMER_A; }"],
    ["a read on env destructured from process by assignment", "let env; ({ env } = process); const v = env.STIGMER_A;"],
    ["env taken by a literal key in a destructure of process", 'const { ["env"]: { STIGMER_A } } = process;'],
    ["a read on env destructured from process by a literal key", 'const { ["env"]: e } = process; const v = e.STIGMER_A;'],
    ["a destructure down from the global object", "const { process: { env: { STIGMER_A } } } = globalThis;"],
    ["a read on env destructured down from the global object", "const { process: { env } } = globalThis; const v = env.STIGMER_A;"],
    ["a property read through a type assertion", "const v = (process.env as Record<string, string>).STIGMER_A;"],
    ["a read through an alias initialised with a type assertion", "const env = process.env as Record<string, string>; const v = env.STIGMER_A;"],
    ["a destructure of a non-null assertion", "const { STIGMER_A } = process.env!;"],
    ["a read through satisfies", "const v = (process.env satisfies NodeJS.ProcessEnv).STIGMER_A;"],
    ["a read through globalThis.process", "const v = globalThis.process.env.STIGMER_A;"],
    ["a read through global.process", "const v = global.process.env.STIGMER_A;"],
    ["a read through a literal-keyed process member", 'const v = globalThis["process"].env.STIGMER_A;'],
    ["a read through a literal-keyed env member", 'const v = process["env"].STIGMER_A;'],
    ["a read through an angle-bracket assertion", "const v = (<NodeJS.ProcessEnv>process.env).STIGMER_A;"],
    ["an in test with a literal key", 'const set = "STIGMER_A" in process.env;'],
    ["an in test with a constant key", 'const K = "STIGMER_A"; const set = K in process.env;'],
  ])("reads %s", (_label, source) => {
    expect(read(source)).toEqual({ names: ["STIGMER_A"], refused: [], computedIn: [] });
  });

  it("reads a key imported by name from a relative module", () => {
    expect(read('import { K } from "./other.js";\nconst v = process.env[K];', otherModule)).toEqual({
      names: ["STIGMER_A"],
      refused: [],
      computedIn: [],
    });
  });

  it.each([
    ["a plain assignment", 'process.env.STIGMER_A = "x";'],
    ["a delete", 'delete process.env["STIGMER_A"];'],
    ["a write through a computed key", 'function f(name: string) { process.env[name] = "x"; }'],
    ["a spread", "const copy = { ...process.env };"],
    ["an object-literal key", 'const K = "STIGMER_A"; const child = { [K]: "x" };'],
    ["Object.entries over an env object", "for (const [k, v] of Object.entries(process.env)) console.log(k, v);"],
    ["a name in a comment", "// process.env.STIGMER_A\nconst v = 1;"],
    ["a name in a string", 'const hint = "process.env.STIGMER_A";'],
    ["a property of an object that is not an env object", "const config = { STIGMER_A: 1 }; const v = config.STIGMER_A;"],
    ["a plain-record parameter with no process.env default", "function f(env: Record<string, string>) { return env.STIGMER_A; }"],
    ["an assignment destructure of an object that is not an env object", "let v; ({ STIGMER_A: v } = config);"],
    ["a parameter's destructure whose default is not an env object", "function f({ STIGMER_A } = defaults) { return STIGMER_A; }"],
    ["a for-in over process.env", "for (const name in process.env) console.log(name);"],
  ])("does not read %s", (_label, source) => {
    expect(read(source)).toEqual({ names: [], refused: [], computedIn: [] });
  });

  it.each([
    ["a computed key", "function f(name: string) { return process.env[name]; }"],
    ["a computed key on an injected env parameter", "function f(env: NodeJS.ProcessEnv, name: string) { return env[name]; }"],
    ["a computed key through an unannotated alias", "const env = process.env; export const g = (name: string) => env[name];"],
    ["a destructure through a computed key", "export function f(k: string) { const { [k]: v } = process.env; return v; }"],
    ["a reader call with a computed name", "function f(n: string) { return getRunnerSecret(n); }"],
    ["a parameter's destructure through a computed key", "function f(k: string, { [k]: v } = process.env) { return v; }"],
    ["an assignment destructure through a computed key", "function f(k: string) { let v; ({ [k]: v } = process.env); return v; }"],
    ["an in test with a computed key", "function f(k: string) { return k in process.env; }"],
    ["a destructure through a numeric key", "const { 0: v } = process.env;"],
  ])("refuses %s", (_label, source) => {
    const result = read(source);
    expect(result.names).toEqual([]);
    expect(result.refused).toHaveLength(1);
  });

  it("refuses an aliased import, which it does not follow", () => {
    const result = read('import { K as R } from "./other.js";\nconst v = process.env[R];', otherModule);
    expect(result.names).toEqual([]);
    expect(result.refused).toEqual([{ line: 2, how: "reads process.env[R], whose setting cannot be told" }]);
  });

  it("refuses a constant key whose name a parameter also binds, rather than guess the scope", () => {
    const result = read('const K = "STIGMER_A";\nfunction f(K: string) { return process.env[K]; }');
    expect(result.names).toEqual([]);
    expect(result.refused).toEqual([{ line: 2, how: "reads process.env[K], whose setting cannot be told" }]);
  });

  it("never files an aliased import under its exported name, so a later local of that name is refused, not misread", () => {
    const result = read('import { K as R } from "./other.js";\nfunction f(K: string) { return process.env[K]; }', otherModule);
    expect(result.names).toEqual([]);
    expect(result.refused).toEqual([{ line: 2, how: "reads process.env[K], whose setting cannot be told" }]);
  });

  it("allows a computed read inside a named function, and reports where it saw one", () => {
    const source = "function requireEnv(name: string) { return process.env[name]; }\nconst other = (n: string) => process.env[n];";
    expect(read(source, noImports, new Set(["requireEnv"]))).toEqual({
      names: [],
      refused: [{ line: 2, how: "reads process.env[n], whose setting cannot be told" }],
      computedIn: ["requireEnv"],
    });
  });

  it.each([
    ["an object property", "const reader = { readSetting: (name: string) => process.env[name] };"],
    ["a class field", "class Reader { readSetting = (name: string) => process.env[name]; }"],
  ])("allows a computed read in an arrow held by %s, under the property's name", (_label, source) => {
    expect(read(source, noImports, new Set(["readSetting"]))).toEqual({ names: [], refused: [], computedIn: ["readSetting"] });
  });
});

// ── The README against the tree ──────────────────────────────────────────────

/** Every name the README writes in backticks. */
function readmeNames(markdown: string): Set<string> {
  return new Set([...markdown.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((match) => match[1]!));
}

describe("the runner README names every setting the runner reads", () => {
  const visited: string[] = [];
  const readers = new Map<string, string[]>();
  const refused: string[] = [];
  const computedIn = new Set<string>();
  for (const file of typeScriptFilesUnder(SRC_ROOT, OUTSIDE_THE_SWEEP)) {
    const relativeFile = relative(SRC_ROOT, file);
    visited.push(relativeFile);
    const allowed = new Set(
      [...COMPUTED_READS_ALLOWED.keys()].filter((key) => key.startsWith(`${relativeFile}#`)).map((key) => key.slice(relativeFile.length + 1)),
    );
    const result = settingsReadIn(file, readSource(file), allowed, resolveFromTree(file));
    for (const name of result.names) readers.set(name, [...(readers.get(name) ?? []), relativeFile]);
    for (const refusal of result.refused) refused.push(`  ${relativeFile}:${refusal.line} ${refusal.how}`);
    for (const fn of result.computedIn) computedIn.add(`${relativeFile}#${fn}`);
  }
  const documented = readmeNames(readFileSync(README_PATH, "utf-8"));

  it("inspected the production tree and found its settings (the walk is rooted where it claims)", () => {
    expect(visited).toEqual(
      expect.arrayContaining(["config.ts", "main.ts", join("shared", "llm-backend.ts"), join("tools", "url-guard.ts")]),
    );
    expect(visited.some((f) => f.includes("__tests__") || f.includes("__test-utils__"))).toBe(false);
    expect(readers.size).toBeGreaterThan(40);
  });

  it("can tell which setting every read names", () => {
    expect(refused, `reads whose setting cannot be told; name it, or add the function to COMPUTED_READS_ALLOWED with its reason:\n${refused.join("\n")}`).toEqual([]);
  });

  it("gives every exception and every allowed computed read its reason", () => {
    const reasonless = [...NOT_SETTINGS, ...COMPUTED_READS_ALLOWED].filter(([, reason]) => reason.trim() === "").map(([entry]) => entry);
    expect(reasonless, "an entry with no reason is a hole, not an exception").toEqual([]);
  });

  it("holds every allowed computed read live", () => {
    const stale = [...COMPUTED_READS_ALLOWED.keys()].filter((key) => !computedIn.has(key));
    expect(stale, "COMPUTED_READS_ALLOWED names a function that no longer reads by a computed key").toEqual([]);
  });

  it("holds every exception live", () => {
    const stale = [...NOT_SETTINGS.keys()].filter((name) => !readers.has(name) || documented.has(name));
    expect(stale, "NOT_SETTINGS names a variable the runner no longer reads, or one the README now lists").toEqual([]);
  });

  it("finds every setting the runner reads named in the README", () => {
    const missing = [...readers.keys()].filter((name) => !NOT_SETTINGS.has(name) && !documented.has(name)).sort();
    expect(
      missing,
      `settings the runner reads that README.md does not name; add each to its table:\n${missing
        .map((name) => `  ${name} (read in ${readers.get(name)!.join(", ")})`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
