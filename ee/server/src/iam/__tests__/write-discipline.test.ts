/**
 * Holds the write rule over Enterprise's own stores, as the library's
 * store/__tests__/write-discipline.test.ts holds it over the server's: no
 * write stores a copy of a row it read earlier. Enterprise keeps its kinds
 * in its own tables, so the shapes that would break it are a store member
 * that writes a whole row with no compare (`update` or `replace`) and a
 * call of the library store's upsert, `saveResource`. A team and an
 * federation issuer are updated through the guarded write
 * (`readForWrite` and `swap`, the library's store/guarded-port.ts); an
 * invitation changes only through writes that name their fields under its
 * row lock (redemption, its release, revoke).
 *
 * The scan parses each module with the TypeScript compiler API, so a call
 * split across lines or a comment that names a method is read for what it
 * is.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../..");

/** Each store port Enterprise declares, its module, and whether it offers the guarded write. */
const PORTS: ReadonlyArray<
  readonly [name: string, module: string, guarded: boolean]
> = [
  ["TeamStore", "iam/team/store.ts", true],
  ["FederationIssuerStore", "iam/issuer/store.ts", true],
  ["InvitationStore", "iam/invitation/store.ts", false],
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

describe("write discipline", () => {
  it("never calls the library store's upsert", () => {
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
    expect(calls).toEqual([]);
  });

  it.each(PORTS)("%s has no whole-row write", (name, module, guarded) => {
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
    expect(members, `interface ${name} is declared in ${module}`).toBeDefined();
    expect(
      (members ?? []).filter((member) => WHOLE_ROW_WRITES.has(member)),
    ).toEqual([]);
    if (guarded) {
      expect(source.text).toMatch(
        new RegExp(`interface ${name}\\s+extends GuardedWritePort<`),
      );
    }
  });
});
