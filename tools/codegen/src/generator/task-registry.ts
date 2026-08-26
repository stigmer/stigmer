// task-registry target: merges the proto-derived task schemas with the
// sidecar metadata into task-kind-registry.json (bundled by the TS server)
// plus one JSON Schema per task kind. Byte-parity port of the Go
// generator's task_registry.go — JSON-schema objects are built as Maps so
// gojson sorts their keys exactly like Go's map[string]interface{}
// marshaling did.

import * as fs from "node:fs";
import * as path from "node:path";

import type { GoJsonStruct, GoJsonValue } from "../gojson.js";
import { marshalIndent } from "../gojson.js";
import { validateSidecarExamples } from "./example-validation.js";
import type { FieldSchema, TaskConfigSchema, TypeSchema, TypeSpec, Validation } from "./schema.js";
import { cleanDescription, kindOrder, loadSharedTypes, loadTaskSchemas, taskKindString, toDisplayName } from "./schema.js";
import type { SidecarMeta } from "./sidecar.js";
import { loadSidecarMetadata } from "./sidecar.js";

/** Port of runTaskRegistryGeneration. */
export function runTaskRegistryGeneration(schemaDir: string, outputDir: string, metaDir: string): void {
  const tasksSchemaDir = path.join(schemaDir, "tasks");
  const typesDir = path.join(tasksSchemaDir, "types");

  const taskSchemas = loadTaskSchemas(tasksSchemaDir);
  const sharedTypes = loadSharedTypes(typesDir);
  const sidecars = loadSidecarMetadata(metaDir);

  validateSidecarExamples(taskSchemas, sidecars);

  const entries = taskSchemas.map((schema) => buildRegistryEntry(schema, sidecars, sharedTypes));
  // Stable sort on kind order (Go used non-stable sort.Slice; ties cannot
  // occur while every kind is in the order table).
  entries.sort((a, b) => kindOrder(a.kind as string) - kindOrder(b.kind as string));

  const registry: GoJsonStruct = {
    version: "1.0.0",
    generatedAt: "generated-by-codegen",
    descriptors: entries,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "task-kind-registry.json"), marshalIndent(registry));

  const schemasDir = path.join(outputDir, "json-schemas");
  fs.mkdirSync(schemasDir, { recursive: true });
  for (const entry of entries) {
    fs.writeFileSync(
      path.join(schemasDir, `${entry.kind as string}.schema.json`),
      marshalIndent(entry.configJsonSchema as GoJsonValue),
    );
  }
  process.stderr.write(`task-registry: ${entries.length} descriptors written to ${outputDir}\n`);
}

/** Port of buildRegistryEntry — field order mirrors TaskKindRegistryEntry. */
function buildRegistryEntry(
  schema: TaskConfigSchema,
  sidecars: Map<string, SidecarMeta>,
  sharedTypes: Map<string, TypeSchema>,
): GoJsonStruct {
  const kind = taskKindString(schema);
  const meta = sidecars.get(kind);

  let displayName: string;
  let description: string;
  let category: string;
  let icon = "";
  let isAiNative = false;
  let requiresExternalService = false;
  let documentationUrl = "";
  let outputJsonSchema: GoJsonValue | undefined;
  let yamlExamples: string[] = [];
  let fieldGroups: GoJsonStruct[] | null = null;
  const fieldToGroup = new Map<string, string>();

  if (meta !== undefined) {
    displayName = meta.displayName;
    description = meta.description;
    category = meta.category;
    icon = meta.icon;
    isAiNative = meta.isAiNative;
    requiresExternalService = meta.requiresExternalService;
    documentationUrl = meta.documentationUrl;
    outputJsonSchema = meta.outputSchema;
    yamlExamples = meta.yamlExamples;

    for (const fg of meta.fieldGroups) {
      // TaskFieldGroupEntry order: id, displayName, description (omitempty).
      (fieldGroups ??= []).push({
        id: fg.id,
        displayName: fg.displayName,
        description: fg.description !== "" ? fg.description : undefined,
      });
      for (const fieldName of fg.fields) {
        fieldToGroup.set(fieldName, fg.id);
      }
    }
  } else {
    displayName = toDisplayName(kind);
    description = cleanDescription(schema.description);
    category = "unspecified";
  }

  let fields: GoJsonStruct[] | null = null;
  for (let i = 0; i < schema.fields.length; i++) {
    const field = schema.fields[i];
    let elementType = "";
    if (field.type.elementType !== undefined) {
      elementType = field.type.elementType.kind;
      if (field.type.elementType.messageType !== undefined && field.type.elementType.messageType !== "") {
        elementType = field.type.elementType.messageType;
      }
    }
    if (field.type.messageType !== undefined && field.type.messageType !== "" && elementType === "") {
      elementType = field.type.messageType;
    }
    const validationHints = field.validation !== undefined ? buildValidationHints(field.validation) : [];
    const groupId = fieldToGroup.get(field.protoField) ?? "";

    // TaskFieldRegistryEntry struct-tag order.
    (fields ??= []).push({
      name: field.protoField,
      displayName: toDisplayName(field.protoField),
      description: cleanDescription(field.description),
      type: mapFieldType(field.type),
      required: field.required,
      isExpression: field.isExpression === true ? true : undefined,
      defaultValue: undefined,
      enumValues:
        field.type.enumValues !== undefined && field.type.enumValues.length > 0
          ? field.type.enumValues
          : undefined,
      groupId: groupId !== "" ? groupId : undefined,
      fieldNumber: i + 1,
      elementType: elementType !== "" ? elementType : undefined,
      validationHints: validationHints.length > 0 ? validationHints : undefined,
    });
  }

  // TaskKindRegistryEntry struct-tag order; fields/fieldGroups/
  // configJsonSchema have no omitempty (nil marshals as null).
  return {
    kind,
    displayName,
    description,
    category,
    icon,
    configProtoType: schema.protoType,
    fields,
    fieldGroups,
    configJsonSchema: generateJsonSchema(schema, sharedTypes),
    outputJsonSchema,
    yamlExamples: yamlExamples.length > 0 ? yamlExamples : undefined,
    documentationUrl,
    isAiNative,
    requiresExternalService,
  };
}

/** Port of generateJsonSchema — a Map so keys marshal sorted. */
function generateJsonSchema(
  schema: TaskConfigSchema,
  sharedTypes: Map<string, TypeSchema>,
): Map<string, GoJsonValue> {
  const jsonSchema = new Map<string, GoJsonValue>([
    ["$schema", "https://json-schema.org/draft/2020-12/schema"],
    ["title", schema.name],
    ["type", "object"],
    ["additionalProperties", false],
  ]);

  const properties = new Map<string, GoJsonValue>();
  const required: string[] = [];

  for (const field of schema.fields) {
    properties.set(field.protoField, fieldToJsonSchemaProperty(field, sharedTypes, new Set()));
    if (field.required) {
      required.push(field.protoField);
    }
  }

  jsonSchema.set("properties", properties);
  if (required.length > 0) {
    jsonSchema.set("required", required);
  }

  return jsonSchema;
}

/** Port of fieldToJsonSchemaProperty. */
function fieldToJsonSchemaProperty(
  field: FieldSchema,
  sharedTypes: Map<string, TypeSchema>,
  seen: Set<string>,
): Map<string, GoJsonValue> {
  const prop = new Map<string, GoJsonValue>();

  const desc = cleanDescription(field.description);
  if (desc !== "") {
    prop.set("description", desc);
  }

  const v: Validation | undefined = field.validation;
  switch (field.type.kind) {
    case "string":
      prop.set("type", "string");
      if (field.type.enumType !== undefined && field.type.enumType !== "" && (field.type.enumValues?.length ?? 0) > 0) {
        prop.set("enum", field.type.enumValues as string[]);
      }
      if (v !== undefined) {
        if ((v.minLength ?? 0) > 0) prop.set("minLength", v.minLength as number);
        if ((v.maxLength ?? 0) > 0) prop.set("maxLength", v.maxLength as number);
        if (v.pattern !== undefined && v.pattern !== "") prop.set("pattern", v.pattern);
      }
      break;
    case "int32":
    case "int64":
    case "uint32":
      prop.set("type", "integer");
      if (v !== undefined) {
        if ((v.min ?? 0) !== 0) prop.set("minimum", v.min as number);
        if ((v.max ?? 0) !== 0) prop.set("maximum", v.max as number);
      }
      break;
    case "float":
    case "double":
      prop.set("type", "number");
      if (v !== undefined) {
        if ((v.min ?? 0) !== 0) prop.set("minimum", v.min as number);
        if ((v.max ?? 0) !== 0) prop.set("maximum", v.max as number);
      }
      break;
    case "bool":
      prop.set("type", "boolean");
      break;
    case "struct":
      prop.set("type", "object");
      break;
    case "value":
      // google.protobuf.Value — any JSON value; no "type" constraint so
      // scalars, arrays, and objects all validate.
      break;
    case "map":
      prop.set("type", "object");
      if (field.type.valueType !== undefined && field.type.valueType.kind === "string") {
        prop.set("additionalProperties", new Map<string, GoJsonValue>([["type", "string"]]));
      } else {
        prop.set("additionalProperties", true);
      }
      break;
    case "array":
      prop.set("type", "array");
      if (field.type.elementType !== undefined) {
        prop.set("items", typeSpecToJsonSchema(field.type.elementType, sharedTypes, seen));
      }
      if (v !== undefined && (v.minItems ?? 0) > 0) {
        prop.set("minItems", v.minItems as number);
      }
      break;
    case "message":
      // Expand the nested message into a full typed sub-schema so authors
      // get validation and autocomplete inside it (stigmer/stigmer#358).
      expandMessageSchema(prop, field.type.messageType ?? "", sharedTypes, seen);
      break;
    case "timestamp":
      prop.set("type", "string");
      prop.set("format", "date-time");
      break;
    case "bytes":
      prop.set("type", "string");
      prop.set("contentEncoding", "base64");
      break;
    default:
      prop.set("type", "string");
      break;
  }

  return prop;
}

/** Port of typeSpecToJsonSchema. */
function typeSpecToJsonSchema(
  ts: TypeSpec,
  sharedTypes: Map<string, TypeSchema>,
  seen: Set<string>,
): Map<string, GoJsonValue> {
  switch (ts.kind) {
    case "string":
      if (ts.enumType !== undefined && ts.enumType !== "" && (ts.enumValues?.length ?? 0) > 0) {
        return new Map<string, GoJsonValue>([
          ["type", "string"],
          ["enum", ts.enumValues as string[]],
        ]);
      }
      return new Map([["type", "string"]]);
    case "int32":
    case "int64":
    case "uint32":
      return new Map([["type", "integer"]]);
    case "float":
    case "double":
      return new Map([["type", "number"]]);
    case "bool":
      return new Map([["type", "boolean"]]);
    case "struct":
      return new Map([["type", "object"]]);
    case "value":
      return new Map();
    case "message": {
      const prop = new Map<string, GoJsonValue>();
      expandMessageSchema(prop, ts.messageType ?? "", sharedTypes, seen);
      return prop;
    }
    default:
      return new Map([["type", "string"]]);
  }
}

// Port of expandMessageSchema: falls back to a bare "object" when the type
// schema is unavailable or recursive, so unknown types never make the
// schema stricter than the data.
function expandMessageSchema(
  prop: Map<string, GoJsonValue>,
  messageType: string,
  sharedTypes: Map<string, TypeSchema>,
  seen: Set<string>,
): void {
  prop.set("type", "object");

  const typeSchema = sharedTypes.get(messageType);
  if (typeSchema === undefined || seen.has(messageType)) {
    return;
  }
  seen.add(messageType);
  try {
    const properties = new Map<string, GoJsonValue>();
    const required: string[] = [];
    for (const field of typeSchema.fields) {
      properties.set(field.protoField, fieldToJsonSchemaProperty(field, sharedTypes, seen));
      if (field.required) {
        required.push(field.protoField);
      }
    }

    prop.set("additionalProperties", false);
    prop.set("properties", properties);
    if (required.length > 0) {
      prop.set("required", required);
    }
  } finally {
    seen.delete(messageType);
  }
}

/** Port of mapFieldType. */
function mapFieldType(ts: TypeSpec): string {
  switch (ts.kind) {
    case "string":
      return ts.enumType !== undefined && ts.enumType !== "" ? "enum" : "string";
    case "int32":
    case "int64":
    case "uint32":
      return "int32";
    case "float":
    case "double":
      return "float";
    case "bool":
      return "bool";
    case "struct":
      return "struct";
    case "value":
      return "value";
    case "map":
      return "map";
    case "array":
      return "repeated";
    case "message":
      return "message";
    case "timestamp":
      return "string";
    default:
      return "string";
  }
}

/** Port of buildValidationHints. */
function buildValidationHints(v: Validation): string[] {
  const hints: string[] = [];
  if (v.required === true) hints.push("required");
  if ((v.minLength ?? 0) > 0) hints.push(`min_length: ${v.minLength}`);
  if ((v.maxLength ?? 0) > 0) hints.push(`max_length: ${v.maxLength}`);
  if (v.pattern !== undefined && v.pattern !== "") hints.push(`pattern: ${v.pattern}`);
  if ((v.min ?? 0) !== 0) hints.push(`min: ${v.min}`);
  if ((v.max ?? 0) !== 0) hints.push(`max: ${v.max}`);
  if ((v.minItems ?? 0) > 0) hints.push(`min_items: ${v.minItems}`);
  return hints;
}
