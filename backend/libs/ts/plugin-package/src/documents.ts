/**
 * Reading one document through its cap, and the JSON shape checks every
 * dialect reader repeats.
 *
 * `readText` is the only place the library calls `PluginFiles.read`: the
 * declared size is checked against the document class's cap first, the
 * returned length second, and an over-cap document becomes a
 * `document-too-large` finding instead of a read. The JSON helpers turn a
 * parse failure into a finding of the caller's kind and leave the value
 * `unknown`, so each reader narrows fields with the `expect*` helpers and
 * reports a wrong type with the field's name rather than trusting a cast.
 */

import { decodeUtf8, PLUGIN_DOCUMENT_LIMITS, type PluginDocumentClass, type PluginFileIndex } from "./files.js";
import type { Findings } from "./messages.js";
import type { PluginErrorKind } from "./outcome.js";

/** The document's text, or `undefined` after a `document-too-large` finding. */
export function readText(
  index: PluginFileIndex,
  path: string,
  cls: PluginDocumentClass,
  findings: Findings,
): string | undefined {
  const bytes = readBytes(index, path, cls, findings);
  return bytes === undefined ? undefined : decodeUtf8(bytes);
}

/** The document's bytes, or `undefined` after a `document-too-large` finding. */
export function readBytes(
  index: PluginFileIndex,
  path: string,
  cls: PluginDocumentClass,
  findings: Findings,
): Uint8Array | undefined {
  const limit = PLUGIN_DOCUMENT_LIMITS[cls];
  const entry = index.entry(path);
  if (entry === undefined) {
    throw new Error(`plugin file '${path}' is not listed`);
  }
  if (entry.size > limit) {
    findings.error("document-too-large", { path, subject: String(entry.size), detail: String(limit) });
    return undefined;
  }
  const bytes = index.files.read(path);
  if (bytes.length > limit) {
    findings.error("document-too-large", { path, subject: String(bytes.length), detail: String(limit) });
    return undefined;
  }
  return bytes;
}

/** A parsed JSON object (non-null, non-array), or `undefined` after a finding of `kind`. */
export function parseJsonObject(
  text: string,
  path: string,
  kind: Extract<PluginErrorKind, "manifest-unreadable" | "mcp-config-unreadable">,
  findings: Findings,
): JsonObject | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    findings.error(kind, { path, detail: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
  if (!isJsonObject(value)) {
    findings.error(kind, { path, detail: "the document is not a JSON object" });
    return undefined;
  }
  return value;
}

export type JsonObject = Readonly<Record<string, unknown>>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return isJsonObject(value) && Object.values(value).every((item) => typeof item === "string");
}

/** A JSON value as a sentence can quote it: a string as itself, anything else serialised. */
export function describeValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * The fields of `object`, in the document's own order. `Object.entries`
 * reads own enumerable properties only, so a `__proto__` key in the JSON is
 * just another entry here and never reaches a prototype.
 */
export function fields(object: JsonObject): readonly (readonly [string, unknown])[] {
  return Object.entries(object);
}

/** A string field or `undefined`; a present non-string reports `manifest-field-type`. */
export function optionalString(object: JsonObject, field: string, path: string, findings: Findings): string | undefined {
  const value = object[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    findings.error("manifest-field-type", { path, subject: field, detail: "a string" });
    return undefined;
  }
  return value;
}

/** A string-array field or `undefined`; a present non-array-of-strings reports `manifest-field-type`. */
export function optionalStringArray(
  object: JsonObject,
  field: string,
  path: string,
  findings: Findings,
): readonly string[] | undefined {
  const value = object[field];
  if (value === undefined) return undefined;
  if (!isStringArray(value)) {
    findings.error("manifest-field-type", { path, subject: field, detail: "an array of strings" });
    return undefined;
  }
  return value;
}

/**
 * A field that may be one string or an array of strings (the vendor
 * dialects' path fields), normalised to an array; `undefined` when absent.
 */
export function stringOrStringArray(
  object: JsonObject,
  field: string,
  path: string,
  findings: Findings,
): readonly string[] | undefined {
  const value = object[field];
  if (value === undefined) return undefined;
  if (typeof value === "string") return [value];
  if (isStringArray(value)) return value;
  findings.error("manifest-field-type", { path, subject: field, detail: "a string or an array of strings" });
  return undefined;
}
