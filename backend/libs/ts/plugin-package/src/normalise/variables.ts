/**
 * Variable declarations, from the dialects that have them, reconciled with
 * the references the servers make.
 *
 * Cursor declares `variables` as a JSON Schema object with no sensitivity
 * flag, so every Cursor variable is a secret on Stigmer (a token treated as
 * plain text is the costly mistake; a region name treated as a secret is
 * an inconvenience). Claude declares `userConfig` entries with `sensitive`
 * and `required`, plus `default`, `options`, `multiple`, `min`, `max` and
 * the `directory`, `file`, `number`, `boolean` types, none of which a
 * Stigmer variable carries (values are strings supplied by the user, and a
 * local path means nothing in the sandbox); each is warned once.
 *
 * Reconciliation is what makes an imported server start: the runner
 * filters a stdio server's environment to its declared keys and resolves
 * `${VAR}` in headers and arguments strictly, so a variable a server
 * references but no manifest declares would never reach it. Such a variable
 * is declared here as a required secret, with a warning naming the server.
 * A declared variable no server references is warned too; it is not wrong,
 * only useless.
 */

import type { ManifestSet } from "../detect.js";
import { describeValue, fields, isJsonObject, isStringArray, type JsonObject } from "../documents.js";
import type { Findings } from "../messages.js";
import { VARIABLE_NAME_PATTERN } from "../placeholders.js";
import type { PluginVariable } from "../types.js";
import type { McpServersResult } from "./mcp-servers.js";

export function normaliseVariables(set: ManifestSet, servers: McpServersResult, findings: Findings): readonly PluginVariable[] {
  const declared = new Map<string, PluginVariable>();
  const declaredIn = new Map<string, string>();
  for (const manifest of set.manifests) {
    const declaration = manifest.variables;
    if (declaration === undefined) continue;
    const variables =
      declaration.dialect === "cursor"
        ? readCursorVariables(declaration.value, declaration.manifest, findings)
        : readClaudeVariables(declaration.value, declaration.manifest, findings);
    for (const variable of variables) {
      // Two manifests declaring one name: the identity manifest's wins.
      if (declared.has(variable.name)) continue;
      declared.set(variable.name, variable);
      declaredIn.set(variable.name, declaration.manifest);
    }
  }

  const referencedBy = new Map<string, string>();
  for (const server of servers.servers) {
    for (const name of server.env) {
      if (!referencedBy.has(name)) referencedBy.set(name, server.name);
    }
  }

  // A refused server's references are unknown, so an "unreferenced"
  // warning would be a consequence of the refusal, not advice.
  if (servers.refused === 0) {
    for (const [name, variable] of declared) {
      if (!referencedBy.has(name)) {
        findings.warn("variable-unreferenced", { subject: variable.name, path: declaredIn.get(name) });
      }
    }
  }

  const inferred: PluginVariable[] = [];
  for (const [name, server] of [...referencedBy].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (declared.has(name)) continue;
    findings.warn("variable-inferred", { subject: name, detail: server });
    inferred.push({ name, isSecret: true, optional: false, declaredBy: "inferred" });
  }

  return [...declared.values(), ...inferred];
}

/**
 * Cursor: `{ type: "object", properties: { NAME: { type, title, description } }, required: [NAME] }`.
 */
function readCursorVariables(value: unknown, manifest: string, findings: Findings): readonly PluginVariable[] {
  if (!isJsonObject(value) || value["type"] !== "object") {
    findings.error("manifest-field-type", { path: manifest, subject: "variables", detail: "a JSON Schema object with type 'object'" });
    return [];
  }
  const properties = value["properties"] ?? {};
  if (!isJsonObject(properties)) {
    findings.error("manifest-field-type", { path: manifest, subject: "variables.properties", detail: "an object" });
    return [];
  }
  const required = value["required"] ?? [];
  if (!isStringArray(required)) {
    findings.error("manifest-field-type", { path: manifest, subject: "variables.required", detail: "an array of strings" });
    return [];
  }

  const variables: PluginVariable[] = [];
  for (const [name, schema] of fields(properties)) {
    if (!VARIABLE_NAME_PATTERN.test(name)) {
      findings.error("variable-name-invalid", { subject: name, path: manifest });
      continue;
    }
    const property = isJsonObject(schema) ? schema : {};
    const type = property["type"];
    if (type !== undefined && type !== "string") {
      findings.warn("variable-type-narrowed", { subject: name, path: manifest, detail: describeValue(type) });
    }
    if (property["default"] !== undefined) findings.warn("variable-default-dropped", { subject: name, path: manifest });
    if (property["enum"] !== undefined) findings.warn("variable-option-dropped", { subject: name, path: manifest, detail: "enum" });
    const description = describe(property);
    variables.push({
      name,
      ...(description !== undefined && { description }),
      isSecret: true,
      optional: !required.includes(name),
      declaredBy: "cursor",
    });
  }
  return variables;
}

/**
 * Claude: `{ KEY: { type, title, description, sensitive, required, default, options, multiple, min, max } }`.
 */
function readClaudeVariables(value: unknown, manifest: string, findings: Findings): readonly PluginVariable[] {
  if (!isJsonObject(value)) {
    findings.error("manifest-field-type", { path: manifest, subject: "userConfig", detail: "an object" });
    return [];
  }
  const variables: PluginVariable[] = [];
  for (const [name, entry] of fields(value)) {
    if (!VARIABLE_NAME_PATTERN.test(name)) {
      findings.error("variable-name-invalid", { subject: name, path: manifest });
      continue;
    }
    if (!isJsonObject(entry)) {
      findings.error("manifest-field-type", { path: manifest, subject: `userConfig.${name}`, detail: "an object" });
      continue;
    }
    const type = entry["type"];
    if (type !== undefined && type !== "string") {
      findings.warn("variable-type-narrowed", { subject: name, path: manifest, detail: describeValue(type) });
    }
    if (entry["default"] !== undefined) findings.warn("variable-default-dropped", { subject: name, path: manifest });
    for (const option of ["options", "multiple", "min", "max"]) {
      if (entry[option] !== undefined) findings.warn("variable-option-dropped", { subject: name, path: manifest, detail: option });
    }
    const description = describe(entry);
    variables.push({
      name,
      ...(description !== undefined && { description }),
      isSecret: entry["sensitive"] === true,
      optional: entry["required"] !== true,
      declaredBy: "claude",
    });
  }
  return variables;
}

/** `title` and `description` joined, whichever are present. */
function describe(entry: JsonObject): string | undefined {
  const parts = [entry["title"], entry["description"]].filter((part): part is string => typeof part === "string" && part !== "");
  return parts.length === 0 ? undefined : parts.join(": ");
}
