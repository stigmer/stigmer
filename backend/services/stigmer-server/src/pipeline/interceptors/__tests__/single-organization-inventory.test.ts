/**
 * Holds docs/single-organization.md true to the server it describes: the
 * doc's method rows are exactly what `fillRuleFor`
 * (interceptors/single-organization.ts) answers for every method the
 * open-source server SERVES and that takes an organization (the empty
 * composition's routes replayed into a recorder, as
 * authorization/__tests__/skip-lane-inventory.test.ts reads them).
 *
 * The doc is the one inventory and the rule is the one function: this test
 * keeps no list of its own, so a contract change that adds, moves or
 * re-scopes an organization field fails here with the row to write, never
 * silently. The mutation proofs below show the comparison bites in each
 * direction.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { DescMethod } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import {
  baseConfig,
  servedMethods,
  silentLogger,
} from "../../../extensions/__tests__/composed-support.js";
import { fillRuleFor } from "../single-organization.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "../../../..");
const INVENTORY_DOC = path.join(PACKAGE_ROOT, "docs/single-organization.md");

/** A method row: `| Service.method | <fill> |`, where the fill is `org`, `metadata.org` or `not filled: <reason>`. */
const METHOD_ROW =
  /^\| ([A-Za-z]+)\.([A-Za-z]+) \| (org|metadata\.org|not filled: [a-z ]+) \|$/;

function rowsOf(doc: string): string[] {
  const rows: string[] = [];
  for (const line of doc.split("\n")) {
    const m = METHOD_ROW.exec(line);
    if (m !== null) {
      rows.push(`${m[1]}.${m[2]} | ${m[3]}`);
    }
  }
  return rows.sort();
}

/** The row the rule gives a method, or undefined when the method takes no organization. */
function ruleRow(method: DescMethod): string | undefined {
  const rule = fillRuleFor(method);
  const serviceName = method.parent.typeName.split(".").at(-1) ?? "";
  if (rule.path !== undefined) {
    return `${serviceName}.${method.name} | ${rule.path}`;
  }
  if (rule.notFilled !== undefined) {
    return `${serviceName}.${method.name} | not filled: ${rule.notFilled}`;
  }
  return undefined;
}

function servedRows(server: ComposedServer): string[] {
  return servedMethods(server.routes)
    .map(ruleRow)
    .filter((row): row is string => row !== undefined)
    .sort();
}

describe("the single-organization fill inventory (docs/single-organization.md) is true to the served server", () => {
  let dir: string;
  let server: ComposedServer;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "single-org-inventory-test-"));
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the doc's rows are exactly the rule's answer for every served method that takes an organization", () => {
    expect(rowsOf(readFileSync(INVENTORY_DOC, "utf8"))).toEqual(
      servedRows(server),
    );
  });

  it("the comparison bites: a missing row, an extra row and a moved path each differ", () => {
    const truth = servedRows(server);
    const doc = truth.map((row) => `| ${row} |`);
    expect(rowsOf(doc.join("\n"))).toEqual(truth);

    const missing = doc.slice(1);
    expect(rowsOf(missing.join("\n"))).not.toEqual(truth);

    const extra = [...doc, "| AgentCommandController.nothing | org |"];
    expect(rowsOf(extra.join("\n"))).not.toEqual(truth);

    const moved = doc.map((line) =>
      line.includes("| metadata.org |")
        ? line.replace("| metadata.org |", "| org |")
        : line,
    );
    expect(rowsOf(moved.join("\n"))).not.toEqual(truth);
  });
});
