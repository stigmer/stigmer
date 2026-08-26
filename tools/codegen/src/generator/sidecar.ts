// Sidecar metadata loading: one YAML file per task kind under
// apis/ai/stigmer/agentic/workflow/v1/tasks/meta/, carrying the
// presentation metadata (display names, categories, output schemas, YAML
// examples) that the protos deliberately don't.

import * as fs from "node:fs";
import * as path from "node:path";

import { parse as parseYaml } from "yaml";

import type { GoJsonValue } from "../gojson.js";
import { readDirSorted } from "./schema.js";

export interface SidecarMeta {
  kind: string;
  displayName: string;
  description: string;
  category: string;
  icon: string;
  isAiNative: boolean;
  requiresExternalService: boolean;
  documentationUrl: string;
  /** Free-form JSON-Schema-ish value; undefined when absent (Go nil map). */
  outputSchema: GoJsonValue | undefined;
  fieldGroups: SidecarFieldGroup[];
  yamlExamples: string[];
}

export interface SidecarFieldGroup {
  id: string;
  displayName: string;
  description: string;
  fields: string[];
}

/** Port of loadSidecarMetadata: kind → parsed sidecar. */
export function loadSidecarMetadata(dir: string): Map<string, SidecarMeta> {
  const sidecars = new Map<string, SidecarMeta>();
  for (const entry of readDirSorted(dir)) {
    if (entry.isDirectory() || !entry.name.endsWith(".yaml")) continue;
    const data = fs.readFileSync(path.join(dir, entry.name), "utf8");
    const raw = parseYaml(data) as Record<string, unknown>;
    const meta: SidecarMeta = {
      kind: str(raw.kind),
      displayName: str(raw.display_name),
      description: str(raw.description),
      category: str(raw.category),
      icon: str(raw.icon),
      isAiNative: raw.is_ai_native === true,
      requiresExternalService: raw.requires_external_service === true,
      documentationUrl: str(raw.documentation_url),
      outputSchema: raw.output_schema === undefined || raw.output_schema === null
        ? undefined
        : yamlToGoJson(raw.output_schema),
      fieldGroups: fieldGroups(raw.field_groups),
      yamlExamples: strList(raw.yaml_examples),
    };
    sidecars.set(meta.kind, meta);
  }
  return sidecars;
}

function fieldGroups(value: unknown): SidecarFieldGroup[] {
  if (!Array.isArray(value)) return [];
  return value.map((g) => {
    const raw = g as Record<string, unknown>;
    return {
      id: str(raw.id),
      displayName: str(raw.display_name),
      description: str(raw.description),
      fields: strList(raw.fields),
    };
  });
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v : String(v)));
}

/**
 * Converts a parsed YAML value into the gojson value model: mappings become
 * Maps (Go marshals map[string]interface{} with sorted keys), sequences
 * become arrays, scalars pass through.
 */
export function yamlToGoJson(value: unknown): GoJsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return value;
  if (Array.isArray(value)) {
    return value.map(yamlToGoJson);
  }
  if (value instanceof Map) {
    const out = new Map<string, GoJsonValue>();
    for (const [k, v] of value) out.set(String(k), yamlToGoJson(v));
    return out;
  }
  if (typeof value === "object") {
    const out = new Map<string, GoJsonValue>();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.set(k, yamlToGoJson(v));
    }
    return out;
  }
  return String(value);
}
