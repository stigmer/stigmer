/**
 * Holds the credential binding's one rule structurally: which organizations
 * a bound credential reaches is the binding's to answer
 * (authorization/credential-binding.ts `admitsOrganization` and `verdict`:
 * the bound organization and its children, a run's credential its run's
 * organization alone), so no lane may compare `CallerIdentity.boundOrg`
 * with an organization itself. Such a comparison is the shape that once
 * held a parent's key out of its children on every write lane, and it
 * compiles and passes every test that only uses one organization.
 *
 * A read is a call of `boundOrgOf(...)` or a property access `.boundOrg`
 * on anything but an API key's spec (`spec.boundOrg` is the key's stored
 * limit, a different fact). Writing the field (`{ boundOrg: org }`, a
 * verifier stamping it) is not a read. Every non-test module of the server
 * and of Stigmer Enterprise is scanned with the TypeScript compiler API,
 * the house form of a structural guard (pipeline/__tests__/
 * blind-not-found.test.ts), and every module that reads outside the
 * binding module is held to an inventory with its count and the reason it
 * needs the bound organization itself rather than the binding's answer,
 * as skip-lane-inventory.test.ts holds the skip lanes. A new read fails
 * here with its module and line; a read that goes away fails too, so the
 * inventory never names a reason nothing needs.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.resolve(HERE, "../..");
const ENTERPRISE_SRC = path.resolve(HERE, "../../../../../../ee/server/src");

/** The rule's own module, whose every read is the rule. */
const BINDING_MODULE = "server:authorization/credential-binding.ts";

/** Every module outside the binding that reads the bound organization, how often, and why. */
const INVENTORY: Readonly<Record<string, { readonly reads: number; readonly reason: string }>> = {
  "server:extensions/identity.ts": {
    reads: 1,
    reason: "`boundOrgOf` itself: the one reading every consumer shares, a blank never counting as an organization",
  },
  "server:domain/apikey/controller.ts": {
    reads: 3,
    reason: "a service account's key is created limited to the account's own organization, which its caller form carries",
  },
  "server:domain/apikey/steps.ts": {
    reads: 1,
    reason: "the key create fills an empty `bound_org` with the caller's own organization; any other it asks of the binding",
  },
  "server:domain/apikey/verifier.ts": {
    reads: 1,
    reason: "a service account's key must name its account's own organization; one that names another is corrupt",
  },
  "server:domain/organization/steps.ts": {
    reads: 1,
    reason: "a bound credential creates exactly a child of its own organization (a child has no children, so the binding's wider reach adds nothing)",
  },
  "server:domain/token/mint.ts": {
    reads: 1,
    reason: "the minting service account's own organization, whose embedding settings the mint reads",
  },
  "server:domain/vault/connect-link.ts": {
    reads: 1,
    reason: "whether the link's creator was bound at all; a bound creator's link replays bound to the link's own organization",
  },
};

interface Read {
  readonly module: string;
  readonly line: number;
}

function forEachNode(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => forEachNode(child, visit));
}

function isRead(node: ts.Node): boolean {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "boundOrgOf"
  ) {
    return true;
  }
  if (ts.isPropertyAccessExpression(node) && node.name.text === "boundOrg") {
    const receiver = node.expression;
    return !(
      ts.isPropertyAccessExpression(receiver) && receiver.name.text === "spec"
    );
  }
  return false;
}

function readsIn(source: ts.SourceFile, module: string): Read[] {
  const reads: Read[] = [];
  forEachNode(source, (node) => {
    if (isRead(node)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      reads.push({ module, line: line + 1 });
    }
  });
  return reads;
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
}

/** Every non-test module under `root`, parsed, keyed `<label>:<path>`. */
function sourcesUnder(root: string, label: string): Array<[string, ts.SourceFile]> {
  const sources: Array<[string, ts.SourceFile]> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__" && entry.name !== "__test-utils__") {
          walk(full);
        }
      } else if (
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".d.ts") &&
        !entry.name.endsWith(".test.ts")
      ) {
        const module = `${label}:${path.relative(root, full).split(path.sep).join("/")}`;
        sources.push([module, parse(full, readFileSync(full, "utf8"))]);
      }
    }
  };
  walk(root);
  return sources;
}

/** The rule applied to one inline module, for the rule's own cases. */
function readLinesOf(text: string): number[] {
  return readsIn(parse("fixture.ts", text), "fixture.ts").map((read) => read.line);
}

describe("the bound-organization read rule", () => {
  it("counts a boundOrgOf call and a boundOrg read on a caller", () => {
    expect(
      readLinesOf(`
        const bound = boundOrgOf(caller);
        if (caller.boundOrg !== org) refuse();
        const own = account?.boundOrg ?? "";
      `),
    ).toEqual([2, 3, 4]);
  });

  it("does not count a key's stored limit or a write of the field", () => {
    expect(
      readLinesOf(`
        const limit = key.spec?.boundOrg;
        resource.spec.boundOrg = org;
        return { ...caller, boundOrg: org };
      `),
    ).toEqual([]);
  });
});

describe("reads of a credential's bound organization", () => {
  const reads = [
    ...sourcesUnder(SERVER_SRC, "server"),
    ...sourcesUnder(ENTERPRISE_SRC, "enterprise"),
  ].flatMap(([module, source]) => readsIn(source, module));

  it("finds the binding module's own reads, so the scan sees what it guards", () => {
    expect(reads.some((read) => read.module === BINDING_MODULE)).toBe(true);
  });

  it("happen outside the binding only where the inventory says, as often as it says", () => {
    const outside = reads.filter((read) => read.module !== BINDING_MODULE);
    const counted = new Map<string, Read[]>();
    for (const read of outside) {
      counted.set(read.module, [...(counted.get(read.module) ?? []), read]);
    }
    const drift: string[] = [];
    for (const [module, found] of counted) {
      const declared = INVENTORY[module];
      if (declared?.reads !== found.length) {
        drift.push(
          `${module}: ${found.length} read(s) at line(s) ${found.map((read) => read.line).join(", ")}, inventory says ${declared?.reads ?? 0}; ask the binding (admitsOrganization, verdict) instead, or add the module with its reason`,
        );
      }
    }
    for (const module of Object.keys(INVENTORY)) {
      if (!counted.has(module)) {
        drift.push(`${module}: the inventory names it, but it reads the bound organization nowhere`);
      }
    }
    expect(drift).toEqual([]);
  });
});
