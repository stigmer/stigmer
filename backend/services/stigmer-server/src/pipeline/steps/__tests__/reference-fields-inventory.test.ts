/**
 * Holds docs/reference-fields.md true to the contract the server serves:
 * every field that names a resource, in every message the open-source
 * server's methods can carry (the empty composition's routes replayed into
 * a recorder, read transitively through every message field), is a row of
 * the doc with one of its classes, and the doc has no row the contract
 * does not.
 *
 * A field names a resource when it is an ApiResourceReference (singular,
 * repeated or map), a string named `<kind>_id` or `<kind>_ids` for a kind
 * of the contract, a string named `*_slug`, a repeated string named for a
 * kind's plural, or the `slug` of a message that names a resource by `org`
 * and `slug` strings. The class says what the field is: a reference a
 * person writes, a request's, one the server stamps, an id, a display
 * name, a create-time selector, or no resource at all (with why). A class
 * must fit the shape: an ApiResourceReference is one of the three
 * reference classes, and so on (CLASSES_BY_SHAPE).
 *
 * So a contract change that adds a field naming a resource fails here with
 * the row to write, and the row's review is where it is decided whether
 * the field is a reference held by id (the record rule: no reference by
 * slug alone). The mutation proofs below show the comparison bites.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ScalarType } from "@bufbuild/protobuf";
import type { DescField, DescMessage } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import {
  baseConfig,
  servedMethods,
  silentLogger,
} from "../../../extensions/__tests__/composed-support.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "../../../..");
const INVENTORY_DOC = path.join(PACKAGE_ROOT, "docs/reference-fields.md");

/** How a field names a resource, read from its shape. */
type Shape = "reference" | "id" | "slug" | "plural" | "org-slug";

/** The classes a field of each shape may hold; a "not a resource" class carries its reason after a colon. */
const CLASSES_BY_SHAPE: Readonly<Record<Shape, ReadonlyArray<string>>> = {
  reference: ["manifest reference", "request reference", "stamped reference"],
  id: ["stamped id"],
  slug: ["display slug", "not a resource"],
  plural: ["create-time selector", "not a resource"],
  "org-slug": ["request reference", "not a resource"],
};

const KIND_NAMES = new Set(
  Object.keys(ApiResourceKind).filter((key) => Number.isNaN(Number(key))),
);

function childOf(field: DescField): DescMessage | undefined {
  if (field.fieldKind === "message") {
    return field.message;
  }
  if (field.fieldKind === "list" && field.listKind === "message") {
    return field.message;
  }
  if (field.fieldKind === "map" && field.mapKind === "message") {
    return field.message;
  }
  return undefined;
}

function isString(field: DescField): boolean {
  return (
    (field.fieldKind === "scalar" || (field.fieldKind === "list" && field.listKind === "scalar")) &&
    field.scalar === ScalarType.STRING
  );
}

/** The shape a field names a resource by, or undefined when it names none. */
function shapeOf(message: DescMessage, field: DescField): Shape | undefined {
  if (childOf(field)?.typeName === ApiResourceReferenceSchema.typeName) {
    return "reference";
  }
  if (!isString(field)) {
    return undefined;
  }
  const id = /^(.+)_ids?$/.exec(field.name);
  if (id !== null && KIND_NAMES.has(id[1]!)) {
    return "id";
  }
  if (field.name.endsWith("_slug")) {
    return "slug";
  }
  if (field.fieldKind === "list" && KIND_NAMES.has(field.name.replace(/s$/, ""))) {
    return "plural";
  }
  if (
    field.name === "slug" &&
    message.typeName !== ApiResourceReferenceSchema.typeName &&
    message.fields.some((f) => f.name === "org" && isString(f))
  ) {
    return "org-slug";
  }
  return undefined;
}

/** Every message a served method can carry, read transitively. */
function servedMessages(server: ComposedServer): DescMessage[] {
  const seen = new Map<string, DescMessage>();
  const visit = (message: DescMessage): void => {
    if (seen.has(message.typeName)) {
      return;
    }
    seen.set(message.typeName, message);
    for (const field of message.fields) {
      const child = childOf(field);
      if (child !== undefined) {
        visit(child);
      }
    }
  };
  for (const method of servedMethods(server.routes)) {
    visit(method.input);
    visit(method.output);
  }
  return [...seen.values()];
}

/** The fields the contract names resources by: `Message.field` and its shape. */
function namingFields(server: ComposedServer): Map<string, Shape> {
  const out = new Map<string, Shape>();
  for (const message of servedMessages(server)) {
    for (const field of message.fields) {
      const shape = shapeOf(message, field);
      if (shape !== undefined) {
        out.set(`${message.typeName}.${field.name}`, shape);
      }
    }
  }
  return out;
}

/** A field row: `| \`Message.field\` | class |`. */
const FIELD_ROW = /^\| `([A-Za-z0-9_.]+)` \| (.+) \|$/;

function rowsOf(doc: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of doc.split("\n")) {
    const m = FIELD_ROW.exec(line);
    if (m !== null) {
      rows.set(m[1]!, m[2]!);
    }
  }
  return rows;
}

/** Every disagreement between the doc's rows and the contract's fields, as sentences; empty when they agree. */
function disagreements(rows: Map<string, string>, fields: Map<string, Shape>): string[] {
  const out: string[] = [];
  for (const [field, shape] of [...fields].sort(([a], [b]) => a.localeCompare(b))) {
    const row = rows.get(field);
    if (row === undefined) {
      out.push(`${field} names a resource (${shape}) and has no row: classify it as one of ${CLASSES_BY_SHAPE[shape].join(", ")}`);
      continue;
    }
    const fits = CLASSES_BY_SHAPE[shape].some(
      (cls) => row === cls || (cls === "not a resource" && row.startsWith("not a resource: ")),
    );
    if (!fits) {
      out.push(`${field} is classed '${row}', which a ${shape} field cannot be: one of ${CLASSES_BY_SHAPE[shape].join(", ")}`);
    }
  }
  for (const field of rows.keys()) {
    if (!fields.has(field)) {
      out.push(`${field} has a row but no such field names a resource in the served contract: remove the row`);
    }
  }
  return out;
}

describe("the reference-field inventory (docs/reference-fields.md) is true to the served contract", () => {
  let dir: string;
  let server: ComposedServer;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "reference-fields-inventory-test-"));
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

  it("every field that names a resource has a row whose class fits it, and no row names another field", () => {
    expect(disagreements(rowsOf(readFileSync(INVENTORY_DOC, "utf8")), namingFields(server))).toEqual([]);
  });

  it("the comparison bites: a missing row, an extra row and a misfit class each disagree", () => {
    const fields = namingFields(server);
    const truth = rowsOf(readFileSync(INVENTORY_DOC, "utf8"));
    expect(disagreements(truth, fields)).toEqual([]);

    const missing = new Map(truth);
    missing.delete("ai.stigmer.agentic.agent.v1.AgentSpec.skill_refs");
    expect(disagreements(missing, fields)).not.toEqual([]);

    const extra = new Map(truth).set("ai.stigmer.agentic.agent.v1.AgentSpec.nothing", "stamped id");
    expect(disagreements(extra, fields)).not.toEqual([]);

    const misfit = new Map(truth).set("ai.stigmer.agentic.agent.v1.AgentSpec.skill_refs", "display slug");
    expect(disagreements(misfit, fields)).not.toEqual([]);
  });
});
