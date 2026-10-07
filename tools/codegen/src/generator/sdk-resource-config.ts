// Per-resource SDK generation config, auto-derived from the service schema
// JSON — the port of sdk_client.go's sdkResourceConfig / deriveResourceConfig
// / resolveResourceKind / loadSpecSchemaWithTypes, shared by the SDK client
// emitters in every language.

import * as fs from "node:fs";
import * as path from "node:path";

import type { ServiceSchemaFile } from "./gen-common.js";
import { isIDType, pascalToSnake } from "./gen-common.js";
import { isOrglessKind, isVersionedKind } from "./resource-kind.js";
import type { FieldSchema, SpecSchema, TypeSchema } from "./schema.js";
import { readDirSorted } from "./schema.js";

export interface SdkResourceConfig {
  clientName: string;
  protoResType: string;
  inputPrefix: string;
  idType: string;
  specSchema: string;
  apiVersion: string;
  idPrefix: string;
  resourceKind: string;
  isVersioned: boolean;
  /**
   * The kind has no organization (kind_meta scope_type NONE): its inputs
   * carry no required org and its docs show none.
   */
  isOrgless: boolean;
}

// Fields that always come from ApiResourceMetadata; spec fields with these
// names are skipped to avoid conflicts with the metadata-derived input
// header. "Tags" is deliberately NOT here (McpServer has a real spec-level
// tags field).
export const META_FIELD_NAMES = new Set(["Name", "Org", "Visibility", "Labels"]);

/**
 * Whether a spec field takes its value from the input header's org rather
 * than from an input field of its own: the contract spells every
 * organization field `org`, and the header's org is the organization the
 * resource is written in, so a spec `org` (a credential owned by its
 * organization) is that same organization. The input declares no second
 * org; the builders read the header's, and the update mappers carry it back
 * through the header alone. A member of a real oneof keeps the oneof's
 * first-member-wins order, so a set earlier member (a credential's person)
 * still holds the oneof.
 */
export function isHeaderOrgSpecField(f: FieldSchema): boolean {
  return f.name === "Org" && f.type.kind === "string" && (f.type.enumType ?? "") === "";
}

/**
 * The spec fields a builder converts onto the proto: every field the input
 * declares, plus a spec `org` filled from the header (isHeaderOrgSpecField).
 */
export function specBuildFields(fields: readonly FieldSchema[]): FieldSchema[] {
  return fields.filter((f) => !META_FIELD_NAMES.has(f.name) || isHeaderOrgSpecField(f));
}

/** Tracks generated type names per resource for client.ts generation. */
export interface ResourceGenInfo {
  resource: string;
  clientName: string;
  inputTypes: string[];
  streamTypes: string[];
}

/** Port of deriveResourceConfig. */
export function deriveResourceConfig(schema: ServiceSchemaFile, schemaDir: string): SdkResourceConfig {
  const cfg: SdkResourceConfig = {
    clientName: "",
    protoResType: "",
    inputPrefix: "",
    idType: "",
    specSchema: "",
    apiVersion: "",
    idPrefix: "",
    resourceKind: "",
    isVersioned: false,
    isOrgless: false,
  };

  // protoResType: prefer the update or delete method's output type over
  // create (which may return a wrapper).
  for (const svc of schema.services) {
    if (svc.role === "command" && svc.methods.length > 0) {
      cfg.protoResType = svc.methods[0].outputType;
      for (const m of svc.methods) {
        const lower = m.name.toLowerCase();
        if (lower === "update" || lower === "delete") {
          cfg.protoResType = m.outputType;
          break;
        }
      }
      break;
    }
  }
  if (cfg.protoResType === "") {
    for (const svc of schema.services) {
      if (svc.role === "query" && svc.methods.length > 0) {
        cfg.protoResType = svc.methods[0].outputType;
        break;
      }
    }
  }

  cfg.clientName = cfg.protoResType + "Client";
  cfg.inputPrefix = cfg.protoResType;

  for (const svc of schema.services) {
    for (const m of svc.methods) {
      if (m.name === "Get" && isIDType(m.inputType)) {
        cfg.idType = m.inputType;
        break;
      }
    }
  }

  // Spec schema path by convention: <namespace>/<resource>/<resource>.json.
  const parts = schema.package.split(".");
  if (parts.length >= 5) {
    const namespace = parts[2];
    const resource = parts[3];
    const candidate = path.join(namespace, resource, resource + ".json");
    if (fs.existsSync(path.join(schemaDir, candidate))) {
      cfg.specSchema = candidate;
    }
  }

  cfg.apiVersion = deriveApiVersion(schema.package);
  cfg.resourceKind = resolveResourceKind(schema);
  cfg.isVersioned = isVersionedKind(cfg.resourceKind);
  cfg.isOrgless = isOrglessKind(cfg.resourceKind);

  return cfg;
}

/** "ai.stigmer.agentic.agent.v1" → "agentic.stigmer.ai/v1". */
export function deriveApiVersion(pkg: string): string {
  const parts = pkg.split(".");
  if (parts.length >= 5) {
    return parts[2] + ".stigmer.ai/v1";
  }
  return "stigmer.ai/v1";
}

// Match the ApiResourceKind enum value whose underscore-stripped name equals
// schema.resource; fall back to pascalToSnake.
function resolveResourceKind(schema: ServiceSchemaFile): string {
  for (const e of schema.enumTypes ?? []) {
    if (e.name === "ApiResourceKind") {
      for (const v of e.values ?? []) {
        if (v.name.replaceAll("_", "") === schema.resource) {
          return v.name;
        }
      }
    }
  }
  return pascalToSnake(schema.resource);
}

/** Port of loadSpecSchemaWithTypes. */
export function loadSpecSchemaWithTypes(specPath: string): [SpecSchema, TypeSchema[]] {
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8")) as SpecSchema;

  const typesDir = path.join(path.dirname(specPath), "types");
  const types: TypeSchema[] = [];
  try {
    for (const e of readDirSorted(typesDir)) {
      if (e.isDirectory() || !e.name.endsWith(".json")) continue;
      try {
        types.push(JSON.parse(fs.readFileSync(path.join(typesDir, e.name), "utf8")) as TypeSchema);
      } catch {
        continue;
      }
    }
  } catch {
    // types dir is optional
  }
  return [spec, types];
}
