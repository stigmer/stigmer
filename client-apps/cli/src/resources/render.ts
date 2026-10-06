// Uniform rendering for read verbs.
//
// All resource protos share the ApiResourceMetadata envelope, so the human
// (table) view of a single `get` is derived generically from the protojson
// projection — no per-kind formatter. The common spec fields it adds are the
// ones several kinds share by name: the description, and the settings a run
// starts from (spec.harness and spec.run_config: an agent's run defaults, a
// share's or channel's saved settings, a session's engine). json/yaml use the canonical protojson
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

/** How a table cell names an organization value: its label, or the value as given. */
export type OrgLabel = (value: string) => string;

/**
 * A row extractor + headers describing a collection's table view. A table
 * whose rows name organizations lists them in `orgs`, so the caller can
 * label each distinct value once (by slug, in place of the id the rows
 * carry) before the rows render through `orgLabel`.
 */
export interface TableShape {
  readonly resourceName: string;
  readonly headers: readonly string[];
  readonly row: (json: JsonObject, orgLabel: OrgLabel) => readonly string[];
  readonly orgs?: (json: JsonObject) => readonly string[];
}

/**
 * How the human field view renders: `hideOrg` leaves the Org line out (a
 * server that holds one organization never names it); `orgLabel` is how
 * the Org line names it, the organization's slug in place of the id the
 * resource carries.
 */
export interface RenderFieldsOptions {
  readonly hideOrg?: boolean;
  readonly orgLabel?: string;
}

/** Render a single resource for a read verb (json/yaml = protojson, always complete; table = fields). */
export function renderResource(
  schema: DescMessage,
  message: Message,
  format: OutputFormat,
  options: RenderFieldsOptions = {},
): string {
  if (format === "json") return renderProtoJson(schema, message);
  if (format === "yaml") return renderProtoYaml(schema, message);
  return renderResourceFields(protoToJsonValue(schema, message), options);
}

/**
 * Render a collection for a read verb (json/yaml = protojson array, the
 * wire as-is; table = grid, naming each organization by `orgLabels` where
 * it holds one).
 */
export function renderCollection(
  schema: DescMessage,
  messages: readonly Message[],
  format: OutputFormat,
  table: TableShape,
  orgLabels: ReadonlyMap<string, string> = new Map(),
): string {
  if (format === "json") return renderProtoListJson(schema, messages);
  if (format === "yaml") return renderProtoListYaml(schema, messages);
  if (messages.length === 0) return renderEmpty(table.resourceName);
  const label = labelFrom(orgLabels);
  const rows = messages.map((message) => table.row(asObject(protoToJsonValue(schema, message)), label));
  return `\n${renderTable(table.headers, rows)}`;
}

/** The organization values a human table's rows name; none for machine output or a table that names none. */
export function tableOrganizations(
  schema: DescMessage,
  messages: readonly Message[],
  format: OutputFormat,
  table: TableShape,
): readonly string[] {
  const orgs = table.orgs;
  if (format === "json" || format === "yaml" || orgs === undefined) return [];
  return messages.flatMap((message) => orgs(asObject(protoToJsonValue(schema, message))));
}

/**
 * Render a *list message* (e.g. AgentRunList, SessionList) for a read verb.
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
  const label = labelFrom(new Map());
  const rows = (Array.isArray(list) ? list : []).map((entry) => table.row(asObject(entry), label));
  if (rows.length === 0) return renderEmpty(table.resourceName);
  return `\n${renderTable(table.headers, rows)}`;
}

// How a table names an organization: its label where one is known, else the value as given.
function labelFrom(orgLabels: ReadonlyMap<string, string>): OrgLabel {
  return (value) => orgLabels.get(value) ?? value;
}

// Human field view of a resource's metadata envelope (+ common spec fields).
function renderResourceFields(json: JsonValue, options: RenderFieldsOptions): string {
  const obj = asObject(json);
  const metadata = asObject(obj.metadata);
  const spec = asObject(obj.spec);

  const fields: Array<[string, string]> = [];
  pushField(fields, "ID", metadata.id);
  pushField(fields, "Name", metadata.name);
  pushField(fields, "Slug", metadata.slug);
  if (options.hideOrg !== true) pushField(fields, "Org", options.orgLabel ?? metadata.org);
  pushField(fields, "Visibility", metadata.visibility);
  pushField(fields, "Description", spec.description);
  pushRunSettings(fields, spec, asObject(obj.status));

  const width = Math.max(0, ...fields.map(([key]) => key.length));
  const lines = fields.map(([key, value]) => `  ${key}:${" ".repeat(width - key.length + 2)}${value}`);
  return `\n${lines.join("\n")}\n`;
}

// The engine and run settings a resource names, each only when set (protojson
// omits defaults, so an absent field is "not set here"). A turn records the
// settings it ran with on status.run_config, resolved from its message, its
// agent and its lane, so those are shown in place of what the message asked.
function pushRunSettings(fields: Array<[string, string]>, spec: JsonObject, status: JsonObject): void {
  pushField(fields, "Engine", enumWord(spec.harness, "HARNESS_"));
  const runConfig = asObject(status.run_config ?? spec.run_config);
  pushField(fields, "Model", runConfig.model_name);
  pushField(fields, "Speed tier", enumWord(runConfig.service_tier, "SERVICE_TIER_"));
  pushField(fields, "Thinking", enumWord(runConfig.thinking_mode, "THINKING_MODE_"));
  if (typeof runConfig.max_cost_usd === "number") {
    fields.push(["Cost cap", `$${runConfig.max_cost_usd} per message`]);
  }
  if (typeof runConfig.max_tool_rounds === "number") {
    fields.push(["Tool rounds", `at most ${runConfig.max_tool_rounds} per message`]);
  }
  if (typeof runConfig.max_tool_result_chars === "number") {
    fields.push(["Tool result size", `at most ${runConfig.max_tool_result_chars} characters`]);
  }
}

// A protojson enum name as the word a person reads ("HARNESS_CURSOR" -> "cursor").
function enumWord(value: JsonValue | undefined, prefix: string): string | undefined {
  if (typeof value !== "string") return undefined;
  return (value.startsWith(prefix) ? value.slice(prefix.length) : value).toLowerCase();
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
