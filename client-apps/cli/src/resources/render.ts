// Uniform rendering for read verbs.
//
// All resource protos share the ApiResourceMetadata envelope, so the generic
// human (table) view of a single `get` is derived from the protojson
// projection; the kinds a person reads most have a view designed for them
// instead (resources/views), and every other kind keeps this one. The common
// fields it adds are the ones several kinds share by name: the description,
// the settings a run starts from (spec.harness and spec.run_config: an
// agent's run defaults, a share's or channel's saved settings, a session's
// engine), and when it was created and last changed. json/yaml use the canonical protojson
// renderers for full fidelity. Collections render via the
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
 * Render a *list message* (e.g. RunList, SessionList) for a read verb.
 *
 * Unlike `renderCollection`, which serializes a bare slice, json/yaml emit the whole list envelope (including
 * `next_page_token`), while table projects the nested `entries` into a grid.
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
  for (const [key, value] of runSettingFields(spec, asObject(obj.status))) pushField(fields, key, value);
  const { created, updated } = audited(obj);
  pushField(fields, "Created", instant(created));
  pushField(fields, "Updated", instant(updated));

  const width = Math.max(0, ...fields.map(([key]) => key.length));
  const lines = fields.map(([key, value]) => `  ${key}:${" ".repeat(width - key.length + 2)}${value}`);
  return `\n${lines.join("\n")}\n`;
}

/**
 * The engine and run settings a resource names, each empty when not set
 * (protojson omits defaults, so an absent field is "not set here"). A turn
 * records the settings it ran with on status.run_config, resolved from its
 * message, its agent and its lane, so those are shown in place of what the
 * message asked.
 */
export function runSettingFields(spec: JsonObject, status: JsonObject): Array<[string, string | undefined]> {
  const runConfig = asObject(status.run_config ?? spec.run_config);
  return [
    ["Harness", enumWord(spec.harness, "HARNESS_")],
    ["Model", str(runConfig, "model_name")],
    ["Speed tier", enumWord(runConfig.service_tier, "SERVICE_TIER_")],
    ["Thinking", enumWord(runConfig.thinking_mode, "THINKING_MODE_")],
    ["Cost cap", typeof runConfig.max_cost_usd === "number" ? `$${runConfig.max_cost_usd} per message` : undefined],
    ["Tool rounds", typeof runConfig.max_tool_rounds === "number" ? `at most ${runConfig.max_tool_rounds} per message` : undefined],
    [
      "Tool result size",
      typeof runConfig.max_tool_result_chars === "number" ? `at most ${runConfig.max_tool_result_chars} characters` : undefined,
    ],
  ];
}

/**
 * An instant to the minute in UTC, "2026-10-31 09:15 UTC": the same for
 * every reader, wherever their machine is. A value that does not parse is
 * shown as given; none, undefined.
 */
export function instant(value: string): string | undefined {
  if (value === "") return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** When a resource was created and last changed, from its audit ("" for either it does not carry). */
export function audited(json: JsonObject): { created: string; updated: string } {
  const audit = asObject(asObject(asObject(json.status).audit).spec_audit);
  return { created: str(audit, "created_at"), updated: str(audit, "updated_at") };
}

// A protojson enum name as the word a person reads ("HARNESS_CLAUDE" -> "claude").
function enumWord(value: JsonValue | undefined, prefix: string): string | undefined {
  if (typeof value !== "string") return undefined;
  return (value.startsWith(prefix) ? value.slice(prefix.length) : value).toLowerCase();
}

function pushField(fields: Array<[string, string]>, key: string, value: JsonValue | undefined): void {
  if (typeof value === "string" && value !== "") fields.push([key, value]);
}

/** A protojson object, or {} for anything else. */
export function asObject(value: JsonValue | undefined): JsonObject {
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
