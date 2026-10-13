/**
 * Holds the write rule structurally: no write in the server stores a copy
 * of a row it read earlier. A write that builds on a stored row either names
 * its fields inside the store's atomic write (`updateResource`, a port's
 * `modifyById`) or stores a whole row by compare-and-swap on the bytes it
 * read (`swapResource`, a port's `swap`, pipeline/guarded-write.ts), so a
 * write that lands in between is never undone.
 *
 * Two shapes would break it, and the scan refuses both:
 *   - a `saveResource` call, the store's upsert, outside the modules listed
 *     below, each a create (the row is new: a refusal of a held id precedes
 *     it, or a fresh id) and none a write onto a row the caller read;
 *   - a whole-row write member on a port of a kind kept outside the shared
 *     store (`update` or `replace` taking the row): such a port offers
 *     `readForWrite` and `swap` instead (store/guarded-port.ts).
 *
 * The scan parses each module with the TypeScript compiler API, so a call
 * split across lines or a comment that names the method is read for what it
 * is. A new `saveResource` caller fails here with its module and line, and
 * joins the list only as a create.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../..");

/** Every module that may call saveResource, and why its row is new. */
const SAVE_RESOURCE_CREATES: Readonly<Record<string, string>> = {
  "pipeline/steps/persist.ts":
    "Persist saves only when its chain loaded no row (a create); an update swaps on the loaded bytes, and a push stores a found row by swap",
  "domain/iampolicy/resource-store.ts":
    "save refuses a held id before it writes; a policy row is never rewritten",
  "domain/identityaccount/resource-store.ts":
    "save refuses a held id before it writes; an update swaps",
  "domain/platformclient/resource-store.ts":
    "save refuses a held id or client_id before it writes; an update swaps",
};

/** The ports of kinds kept outside the shared store, and the file each is declared in. */
const GUARDED_PORTS: ReadonlyArray<readonly [name: string, module: string]> = [
  ["IdentityAccountStore", "domain/identityaccount/store.ts"],
  ["PlatformClientStore", "domain/platformclient/store.ts"],
];

/** A port member that would store a whole row with no compare. */
const WHOLE_ROW_WRITES: ReadonlySet<string> = new Set(["update", "replace"]);

function modules(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") {
        found.push(...modules(full));
      }
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      found.push(full);
    }
  }
  return found;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

function forEachNode(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => forEachNode(child, visit));
}

/** Every `<anything>.saveResource(...)` call, as module:line. */
function saveResourceCalls(): string[] {
  const calls: string[] = [];
  for (const file of modules(SRC)) {
    const source = parse(file);
    forEachNode(source, (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "saveResource"
      ) {
        const line =
          source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        calls.push(`${path.relative(SRC, file)}:${line}`);
      }
    });
  }
  return calls;
}

/** The names of an interface's members, read from its declaration in `module`. */
function interfaceMembers(module: string, name: string): string[] {
  const source = parse(path.join(SRC, module));
  let members: string[] | undefined;
  forEachNode(source, (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
      members = node.members.flatMap((member) =>
        member.name !== undefined && ts.isIdentifier(member.name)
          ? [member.name.text]
          : [],
      );
    }
  });
  if (members === undefined) {
    throw new Error(`interface ${name} is not declared in ${module}`);
  }
  return members;
}

describe("write discipline", () => {
  it("calls saveResource only from the listed creates", () => {
    const outside = saveResourceCalls().filter(
      (call) =>
        !(call.slice(0, call.lastIndexOf(":")) in SAVE_RESOURCE_CREATES),
    );
    expect(outside).toEqual([]);
  });

  it("lists no create that no longer calls saveResource", () => {
    const callers = new Set(
      saveResourceCalls().map((call) => call.slice(0, call.lastIndexOf(":"))),
    );
    expect(
      Object.keys(SAVE_RESOURCE_CREATES).filter(
        (module) => !callers.has(module),
      ),
    ).toEqual([]);
  });

  it.each(GUARDED_PORTS)(
    "%s offers the guarded write and no whole-row write",
    (name, module) => {
      const members = interfaceMembers(module, name);
      expect(members.filter((member) => WHOLE_ROW_WRITES.has(member))).toEqual(
        [],
      );
      const source = readFileSync(path.join(SRC, module), "utf8");
      expect(source).toMatch(
        new RegExp(`interface ${name} extends GuardedWritePort<`),
      );
    },
  );
});
