// Uniform rendering for read verbs.
//
// All resource protos share the ApiResourceMetadata envelope, so the human
// (table) view of a single `get` is derived generically from the protojson
// projection — no per-kind formatter. json/yaml use the canonical protojson
// renderers for full fidelity and Go byte-parity. Collections render via the
// shared table renderer with a caller-supplied row extractor.
//
// The render boundary intentionally uses the base proto types (DescMessage /
// Message) so generic verb dispatch can pass a (schema, message) pair without
// threading a concrete type parameter through the registry.

import type { DescMessage, JsonValue, Message } from "@bufbuild/protobuf";
import type { OutputFormat } from "../output/index.js";
import {
  protoToJsonValue,
  renderEmpty,
  renderProtoJson,
  renderProtoListJson,
  renderProtoListYaml,
  renderProtoYaml,
  renderTable,
} from "../output/index.js";

export type JsonObject = Record<string, JsonValue>;

/** A row extractor + headers describing a collection's table view. */
export interface TableShape {
  readonly resourceName: string;
  readonly headers: readonly string[];
  readonly row: (json: JsonObject) => readonly string[];
}

/** Render a single resource for a read verb (json/yaml = protojson; table = fields). */
export function renderResource(schema: DescMessage, message: Message, format: OutputFormat): string {
  if (format === "json") return renderProtoJson(schema, message);
  if (format === "yaml") return renderProtoYaml(schema, message);
  return renderResourceFields(protoToJsonValue(schema, message));
}

/** Render a collection for a read verb (json/yaml = protojson array; table = grid). */
export function renderCollection(
  schema: DescMessage,
  messages: readonly Message[],
  format: OutputFormat,
  table: TableShape,
): string {
  if (format === "json") return renderProtoListJson(schema, messages);
  if (format === "yaml") return renderProtoListYaml(schema, messages);
  if (messages.length === 0) return renderEmpty(table.resourceName);
  const rows = messages.map((message) => table.row(asObject(protoToJsonValue(schema, message))));
  return `\n${renderTable(table.headers, rows)}`;
}

/**
 * Render a *list message* (e.g. AgentExecutionList, SessionList) for a read verb.
 *
 * Unlike `renderCollection`, which serializes a bare slice, this mirrors Go's
 * `DisplayProto(list, ...)`: json/yaml emit the whole list envelope (including
 * `total_pages`), while table projects the nested `entries` into a grid.
 */
export function renderListMessage(
  schema: DescMessage,
  message: Message,
  format: OutputFormat,
  table: TableShape,
): string {
  if (format === "json") return renderProtoJson(schema, message);
  if (format === "yaml") return renderProtoYaml(schema, message);
  const entries = protoToJsonValue(schema, message);
  const list = asObject(entries).entries;
  const rows = (Array.isArray(list) ? list : []).map((entry) => table.row(asObject(entry)));
  if (rows.length === 0) return renderEmpty(table.resourceName);
  return `\n${renderTable(table.headers, rows)}`;
}

// Human field view of a resource's metadata envelope (+ common spec fields).
function renderResourceFields(json: JsonValue): string {
  const obj = asObject(json);
  const metadata = asObject(obj.metadata);
  const spec = asObject(obj.spec);

  const fields: Array<[string, string]> = [];
  pushField(fields, "ID", metadata.id);
  pushField(fields, "Name", metadata.name);
  pushField(fields, "Slug", metadata.slug);
  pushField(fields, "Org", metadata.org);
  pushField(fields, "Visibility", metadata.visibility);
  pushField(fields, "Description", spec.description);

  const width = Math.max(0, ...fields.map(([key]) => key.length));
  const lines = fields.map(([key, value]) => `  ${key}:${" ".repeat(width - key.length + 2)}${value}`);
  return `\n${lines.join("\n")}\n`;
}

function pushField(fields: Array<[string, string]>, key: string, value: JsonValue | undefined): void {
  if (typeof value === "string" && value !== "") fields.push([key, value]);
}

function asObject(value: JsonValue | undefined): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : {};
}

/** Read a string field from a protojson object, defaulting to "". */
export function str(json: JsonObject, key: string): string {
  const value = json[key];
  return typeof value === "string" ? value : "";
}

/** Read a nested object field from a protojson object, defaulting to {}. */
export function obj(json: JsonObject, key: string): JsonObject {
  return asObject(json[key]);
}

/** Boolean field from a protojson object (defaults to false). */
export function bool(json: JsonObject, key: string): boolean {
  return json[key] === true;
}
