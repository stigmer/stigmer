/**
 * Holds docs/organization-names.md true to the server it describes: the
 * doc's method rows are exactly the organization fields the resolver
 * (interceptors/organization-names.ts) finds in every method the
 * open-source server SERVES (the empty composition's routes replayed into a
 * recorder, as single-organization-inventory.test.ts reads them).
 *
 * The doc is the one inventory and the rule is the one set of functions:
 * this test keeps no list of its own, so a contract change that adds or
 * moves a field named `org` fails here with the row to write, never
 * silently. That is the review a field that breaks the spelling rule (a
 * field called `org` that names no organization) would get. A streaming
 * method, which the interceptor passes untouched, is held to naming no
 * organization at all. The mutation
 * proofs below show the comparison bites in each direction.
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
import {
  annotatedOrganizationPath,
  organizationFieldsOf,
} from "../organization-names.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "../../../..");
const INVENTORY_DOC = path.join(PACKAGE_ROOT, "docs/organization-names.md");

/** A method row: `| Service.method | <field>, <field>, … |`. */
const METHOD_ROW = /^\| ([A-Za-z]+)\.([A-Za-z]+) \| (.+) \|$/;

function rowsOf(doc: string): string[] {
  const rows: string[] = [];
  for (const line of doc.split("\n")) {
    const m = METHOD_ROW.exec(line);
    if (m !== null && m[1] !== "Method") {
      rows.push(`${m[1]}.${m[2]} | ${m[3]}`);
    }
  }
  return rows.sort();
}

/** The row the rule gives a method, or undefined when its input names no organization. */
function ruleRow(method: DescMethod): string | undefined {
  const fields = organizationFieldsOf(method.input);
  const annotated = annotatedOrganizationPath(method);
  if (annotated !== undefined && !fields.includes(annotated)) {
    fields.push(`${annotated} (annotation)`);
  }
  if (fields.length === 0) {
    return undefined;
  }
  const serviceName = method.parent.typeName.split(".").at(-1) ?? "";
  return `${serviceName}.${method.name} | ${fields.map((f) => `\`${f}\``).join(", ")}`;
}

/** What a streaming method's row says: the interceptor resolves unary requests only, so its handler resolves its own. */
const RESOLVED_BY_ITS_HANDLER = " (resolved by its handler)";

function servedRows(server: ComposedServer): string[] {
  return servedMethods(server.routes)
    .map((method) => {
      const row = ruleRow(method);
      return row === undefined || method.methodKind === "unary" ? row : `${row}${RESOLVED_BY_ITS_HANDLER}`;
    })
    .filter((row): row is string => row !== undefined)
    .sort();
}

/** The streaming methods that name an organization, each resolving it in its handler (attention.ts says how). */
const STREAMS_THAT_RESOLVE = ["SessionQueryController.streamAttention"];

describe("the organization-name inventory (docs/organization-names.md) is true to the served server", () => {
  let dir: string;
  let server: ComposedServer;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "organization-names-inventory-test-"));
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

  it("the doc's rows are exactly the rule's answer for every served method that names an organization", () => {
    expect(rowsOf(readFileSync(INVENTORY_DOC, "utf8"))).toEqual(
      servedRows(server),
    );
  });

  it("a served streaming method names an organization only where its handler resolves it: the interceptor resolves unary requests only", () => {
    const streaming = servedMethods(server.routes).filter((method) => method.methodKind !== "unary");
    expect(streaming.length, "the server serves streaming methods to judge").toBeGreaterThan(0);
    expect(
      streaming.flatMap((method) => (ruleRow(method) === undefined ? [] : [`${method.parent.typeName.split(".").at(-1)}.${method.name}`])),
    ).toEqual(STREAMS_THAT_RESOLVE);
  });

  it("the comparison bites: a missing row, an extra row and a moved field each differ", () => {
    const truth = servedRows(server);
    const doc = truth.map((row) => `| ${row} |`);
    expect(rowsOf(doc.join("\n"))).toEqual(truth);

    const missing = doc.slice(1);
    expect(rowsOf(missing.join("\n"))).not.toEqual(truth);

    const extra = [...doc, "| AgentCommandController.nothing | `org` |"];
    expect(rowsOf(extra.join("\n"))).not.toEqual(truth);

    const moved = doc.map((line) => line.replace("`metadata.org`", "`org`"));
    expect(rowsOf(moved.join("\n"))).not.toEqual(truth);
  });
});
