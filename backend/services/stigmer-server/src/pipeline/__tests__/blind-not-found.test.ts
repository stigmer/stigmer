/**
 * Holds the error contract's store-fault rule structurally: no error handler
 * in the server answers NotFound without looking at the error it caught.
 * Only a typed not-found (`ResourceNotFoundError` and its kin) means the
 * record is missing; any other failure is an infrastructure fault answered
 * through `internalError` (`src/pipeline/errors.ts`), because a client told
 * "not found" may discard state that still exists
 * (`.agents/skills/ts-server-dev-guidelines/SKILL.md`, "Errors").
 *
 * A *blind NotFound* is a `throw` of a NotFound that is a direct statement of
 * a `catch` block or of a `.catch(...)` callback — not nested under any
 * condition. That is the defect's exact shape: a discriminating handler throws
 * its NotFound under `if (error instanceof ...)` or a code check, so it passes
 * whatever error class it tests, and the guard needs no list of them. A throw
 * constructs a NotFound when it is `new ConnectError(..., Code.NotFound)` or
 * a call to a NotFound constructor; the constructors are derived from the
 * source (`notFoundError`, plus every function whose body is a single
 * `return` of a NotFound construction, to a fixed point), so a domain's own
 * wrapper cannot hide a blind site, and a discriminating mapper is not one.
 *
 * The scan parses each module with the TypeScript compiler API rather than a
 * regular expression, because a catch block's extent (nested braces, a log
 * line before the throw) is a syntax question. `PENDING` is the list of known
 * blind sites still to be fixed; the scan must equal it exactly, so a new
 * blind site fails here, and so does a fixed site still listed.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../..");

/** Known blind sites by module (relative to `src`), with their count. */
const PENDING: ReadonlyMap<string, number> = new Map([
  // Store loads, stigmer/stigmer#1345 (fixed domain by domain).
  ["domain/agent/controller.ts", 1],
  ["domain/agentchannel/controller.ts", 1],
  ["domain/agentinstance/controller.ts", 1],
  ["domain/agentshare/controller.ts", 1],
  ["domain/artifact/controller.ts", 1],
  ["domain/environment/controller.ts", 1],
  ["domain/environment/steps.ts", 1],
  ["domain/mcpserver/complete-oauth-connect.ts", 1],
  ["domain/mcpserver/connect.ts", 1],
  ["domain/mcpserver/controller.ts", 1],
  ["domain/mcpserver/initiate-oauth-connect.ts", 1],
  ["domain/mcpserver/start-connect.ts", 2],
  ["domain/plugin/controller.ts", 1],
  ["domain/skill/controller.ts", 1],
  ["domain/workflow/controller.ts", 1],
  ["domain/workflowinstance/controller.ts", 1],
  // Parent loads through the in-process chain that fold every RPC error,
  // validation included, stigmer/stigmer#1351.
  ["domain/agentinstance/steps.ts", 1],
  ["domain/workflowinstance/steps.ts", 1],
]);

interface BlindSite {
  readonly module: string;
  readonly line: number;
}

function isCodeNotFound(node: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "Code" &&
    node.name.text === "NotFound"
  );
}

function isNotFoundConstruction(
  node: ts.Expression | undefined,
  constructors: ReadonlySet<string>,
): boolean {
  if (node === undefined) {
    return false;
  }
  if (ts.isCallExpression(node)) {
    return (
      ts.isIdentifier(node.expression) && constructors.has(node.expression.text)
    );
  }
  if (ts.isNewExpression(node)) {
    return (
      ts.isIdentifier(node.expression) &&
      node.expression.text === "ConnectError" &&
      (node.arguments ?? []).some(isCodeNotFound)
    );
  }
  return false;
}

function forEachNode(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => forEachNode(child, visit));
}

/** `notFoundError` plus every single-`return` wrapper of a NotFound. */
function notFoundConstructors(
  sources: readonly ts.SourceFile[],
): ReadonlySet<string> {
  const constructors = new Set(["notFoundError"]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const source of sources) {
      forEachNode(source, (node) => {
        if (
          !ts.isFunctionDeclaration(node) ||
          node.name === undefined ||
          node.body === undefined ||
          node.body.statements.length !== 1 ||
          constructors.has(node.name.text)
        ) {
          return;
        }
        const only = node.body.statements[0];
        if (
          only !== undefined &&
          ts.isReturnStatement(only) &&
          isNotFoundConstruction(only.expression, constructors)
        ) {
          constructors.add(node.name.text);
          grew = true;
        }
      });
    }
  }
  return constructors;
}

/** The handler block of a `.catch(fn)` call, when `fn` has a block body. */
function catchCallbackBlock(node: ts.Node): ts.Block | undefined {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== "catch"
  ) {
    return undefined;
  }
  const handler = node.arguments[0];
  if (
    handler !== undefined &&
    (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) &&
    ts.isBlock(handler.body)
  ) {
    return handler.body;
  }
  return undefined;
}

function blindSites(
  source: ts.SourceFile,
  module: string,
  constructors: ReadonlySet<string>,
): BlindSite[] {
  const sites: BlindSite[] = [];
  forEachNode(source, (node) => {
    const block = ts.isCatchClause(node)
      ? node.block
      : catchCallbackBlock(node);
    if (block === undefined) {
      return;
    }
    for (const statement of block.statements) {
      if (
        ts.isThrowStatement(statement) &&
        isNotFoundConstruction(statement.expression, constructors)
      ) {
        const { line } = source.getLineAndCharacterOfPosition(
          statement.getStart(source),
        );
        sites.push({ module, line: line + 1 });
      }
    }
  });
  return sites;
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
}

/** Every non-test module under `src`, parsed. */
function serverSources(): ts.SourceFile[] {
  const sources: ts.SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") {
          walk(full);
        }
      } else if (
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".d.ts") &&
        !entry.name.endsWith(".test.ts")
      ) {
        sources.push(parse(full, readFileSync(full, "utf8")));
      }
    }
  };
  walk(SRC);
  return sources;
}

/** The rule applied to one inline module, for the rule's own cases. */
function blindLinesOf(text: string): number[] {
  const source = parse("fixture.ts", text);
  return blindSites(source, "fixture.ts", notFoundConstructors([source])).map(
    (site) => site.line,
  );
}

describe("the blind-NotFound rule", () => {
  it("flags an unconditional NotFound in a catch block, bound or not", () => {
    expect(
      blindLinesOf(`
        try { load(); } catch { throw notFoundError("agent", id); }
        try { load(); } catch (error) {
          log(error);
          throw new ConnectError(copy(id), Code.NotFound);
        }
      `),
    ).toEqual([2, 5]);
  });

  it("flags a NotFound built by a derived wrapper and one in a .catch callback", () => {
    expect(
      blindLinesOf(`
        function missing(id: string) { return notFoundError("agent", id); }
        function missingAgain(id: string) { return missing(id); }
        try { load(); } catch { throw missingAgain(id); }
        load().catch(() => { throw missing(id); });
      `),
    ).toEqual([4, 5]);
  });

  it("passes a NotFound thrown only under a test of the error", () => {
    expect(
      blindLinesOf(`
        try { load(); } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            throw notFoundError("agent", id);
          }
          throw internalError(error, "failed to load agent");
        }
      `),
    ).toEqual([]);
  });

  it("does not treat a discriminating mapper as a constructor", () => {
    expect(
      blindLinesOf(`
        function mapNotFound(error: unknown, id: string): unknown {
          if (error instanceof WorkflowNotFoundError) {
            return notFoundError("workflow", id);
          }
          return error;
        }
        try { load(); } catch (error) { throw mapNotFound(error, id); }
      `),
    ).toEqual([]);
  });
});

describe("the server source", () => {
  it("has no blind NotFound beyond the pending list, and the list names only live sites", () => {
    const sources = serverSources();
    const constructors = notFoundConstructors(sources);
    const found = new Map<string, number[]>();
    for (const source of sources) {
      const module = path
        .relative(SRC, source.fileName)
        .split(path.sep)
        .join("/");
      for (const site of blindSites(source, module, constructors)) {
        found.set(module, [...(found.get(module) ?? []), site.line]);
      }
    }

    const counts = Object.fromEntries(
      [...found].map(([module, lines]) => [module, lines.length]),
    );
    const where = [...found]
      .flatMap(([module, lines]) => lines.map((line) => `${module}:${line}`))
      .join("\n");
    expect(counts, `blind NotFound sites found:\n${where}`).toEqual(
      Object.fromEntries(PENDING),
    );
  });
});
