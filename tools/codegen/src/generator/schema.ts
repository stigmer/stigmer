// Schema loading for the Stage 2 generator: the committed JSON files under
// tools/codegen/schemas are the generator's only structural input (the Go
// generator's TaskConfigSchema/TypeSchema/FieldSchema types, as interfaces
// over the parsed JSON).

import * as fs from "node:fs";
import * as path from "node:path";

import { goTrimSpace } from "../internalcomment/internalcomment.js";

export interface TaskConfigSchema {
  name: string;
  kind?: string;
  description: string;
  protoType: string;
  protoFile: string;
  discriminatorValue?: string;
  fields: FieldSchema[];
}

export interface TypeSchema {
  name: string;
  description: string;
  protoType: string;
  protoFile: string;
  fields: FieldSchema[];
  /** Derived at load time from the proto namespace, not part of the JSON. */
  domain?: string;
}

export interface FieldSchema {
  name: string;
  jsonName: string;
  protoField: string;
  type: TypeSpec;
  description: string;
  required: boolean;
  isExpression?: boolean;
  referenceKind?: number;
  discriminatedBy?: string;
  oneofGroup?: string;
  validation?: Validation;
}

export interface TypeSpec {
  kind: string;
  keyType?: TypeSpec;
  valueType?: TypeSpec;
  elementType?: TypeSpec;
  messageType?: string;
  enumType?: string;
  enumValues?: string[];
}

export interface Validation {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  min?: number;
  max?: number;
  minItems?: number;
  maxItems?: number;
  enum?: string[];
}

/** Directory entries in sorted order — Go's os.ReadDir contract. */
export function readDirSorted(dir: string): fs.Dirent[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return entries;
}

/** Port of loadTaskSchemas: every *.json in dir, in filename order. */
export function loadTaskSchemas(dir: string): TaskConfigSchema[] {
  const schemas: TaskConfigSchema[] = [];
  for (const entry of readDirSorted(dir)) {
    if (entry.isDirectory() || !entry.name.endsWith(".json")) continue;
    const data = fs.readFileSync(path.join(dir, entry.name), "utf8");
    schemas.push(JSON.parse(data) as TaskConfigSchema);
  }
  return schemas;
}

/** Port of loadSharedTypes: keyed by type name; missing dir → empty map. */
export function loadSharedTypes(dir: string): Map<string, TypeSchema> {
  const types = new Map<string, TypeSchema>();
  let entries: fs.Dirent[];
  try {
    entries = readDirSorted(dir);
  } catch {
    return types;
  }
  for (const entry of entries) {
    if (entry.isDirectory() || !entry.name.endsWith(".json")) continue;
    try {
      const data = fs.readFileSync(path.join(dir, entry.name), "utf8");
      const ts = JSON.parse(data) as TypeSchema;
      types.set(ts.name, ts);
    } catch {
      continue;
    }
  }
  return types;
}

/**
 * Port of taskDocsKindString: the discriminator value when present,
 * otherwise the lowercased schema kind.
 */
export function taskKindString(schema: TaskConfigSchema): string {
  if (schema.discriminatorValue !== undefined && schema.discriminatorValue !== "") {
    return schema.discriminatorValue;
  }
  return (schema.kind ?? "").toLowerCase();
}

// kindOrder maps task kind names to their enum values for stable sorting;
// unknown kinds sort last.
const KIND_ORDER = new Map<string, number>([
  ["set_vars", 1],
  ["http_call", 2],
  ["grpc_call", 3],
  ["activity_call", 4],
  ["switch_case", 5],
  ["for_each", 6],
  ["fork", 7],
  ["try_catch", 8],
  ["listen", 9],
  ["wait", 10],
  ["raise_error", 11],
  ["run_workflow", 12],
  ["agent_call", 13],
  ["llm_call", 14],
  ["transform", 15],
  ["human_input", 16],
  ["validate", 17],
  ["emit_event", 18],
  ["notification", 19],
  ["eval", 20],
]);

export function kindOrder(kind: string): number {
  return KIND_ORDER.get(kind) ?? 99;
}

/**
 * Port of cleanDescription: drop @since lines, trim each line, join with
 * spaces, collapse runs of spaces.
 */
export function cleanDescription(desc: string): string {
  const cleaned: string[] = [];
  for (const line of desc.split("\n")) {
    const trimmed = goTrimSpace(line);
    if (trimmed.startsWith("@since")) continue;
    cleaned.push(trimmed);
  }
  let result = cleaned.join(" ");
  while (result.includes("  ")) {
    result = result.replaceAll("  ", " ");
  }
  return goTrimSpace(result);
}

/** Port of toDisplayName: snake_case → Space Separated Title-ish Case. */
export function toDisplayName(snakeCase: string): string {
  const parts = snakeCase.split("_");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length > 0) {
      parts[i] = p.slice(0, 1).toUpperCase() + p.slice(1);
    }
  }
  return parts.join(" ");
}
