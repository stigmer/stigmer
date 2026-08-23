/**
 * Proto reflection helpers for the sqlite driver — ports the private
 * helpers in backend/libs/go/store/sqlite/store.go (extractFieldValue
 * :991, toSnakeCase :1027, extractLabelValue :951) plus the kind-name
 * mapping Go gets from `kind.String()`.
 *
 * The kind's PROTO NAME is a physical-layout constant: it is the value of
 * the `kind` column in every table the Go server ever wrote, so the TS
 * driver must produce the identical string for the identical enum value —
 * byte-pinned by __tests__/proto-fields.test.ts.
 */
import { enumToJson } from "@bufbuild/protobuf";
import type { DescField, DescMessage } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";
import type { Message } from "@bufbuild/protobuf";

import {
  ApiResourceKind,
  ApiResourceKindSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

/**
 * The kind's proto enum value name (Go: kind.String()), e.g.
 * ApiResourceKind.organization → "organization". An unknown value throws
 * (enumToJson's own error) — an unknown kind reaching storage is a
 * programming error, never data.
 */
export function apiResourceKindName(kind: ApiResourceKind): string {
  return enumToJson(ApiResourceKindSchema, kind) as string;
}

/**
 * Extracts a field value as a string by dot-notation path (e.g.
 * "spec.executionId"). Path parts match the proto field name directly,
 * then fall back through camelCase→snake_case — exactly Go's two-probe
 * lookup, so the same fieldPath strings the Go callers pass keep working.
 * Returns "" when the path does not resolve.
 */
export function extractFieldValue(
  schema: DescMessage,
  msg: Message,
  fieldPath: string,
): string {
  const parts = fieldPath.split(".");
  let current: ReflectMessage = reflect(schema, msg);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const field = findFieldByProtoName(current, part);
    if (field === undefined) {
      return "";
    }

    if (i === parts.length - 1) {
      return scalarString(current, field);
    }

    if (field.fieldKind !== "message") {
      return "";
    }
    current = current.get(field);
  }

  return "";
}

/**
 * Reads metadata.labels[labelKey] via reflection; "" when the metadata
 * field, the labels map, or the key is absent. Works for any API resource
 * carrying the standard metadata.labels field.
 */
export function extractLabelValue(
  schema: DescMessage,
  msg: Message,
  labelKey: string,
): string {
  const root = reflect(schema, msg);

  const metadataField = root.fields.find((f) => f.name === "metadata");
  if (metadataField === undefined || metadataField.fieldKind !== "message") {
    return "";
  }
  const metadata = root.get(metadataField);

  const labelsField = metadata.fields.find((f) => f.name === "labels");
  if (labelsField === undefined || labelsField.fieldKind !== "map") {
    return "";
  }
  const labels = metadata.get(labelsField);
  const value = labels.get(labelKey);
  return typeof value === "string" ? value : "";
}

function findFieldByProtoName(
  message: ReflectMessage,
  part: string,
): DescField | undefined {
  return (
    message.fields.find((f) => f.name === part) ??
    message.fields.find((f) => f.name === toSnakeCase(part))
  );
}

/**
 * Field value → string, mirroring Go protoreflect.Value.String() for the
 * kinds the callers use: strings pass through, numbers/bools/enums print
 * their primitive form. List/map/message values are not addressable as
 * terminal path parts in Go either — they return "".
 */
function scalarString(message: ReflectMessage, field: DescField): string {
  if (field.fieldKind === "list" || field.fieldKind === "map") {
    return "";
  }
  if (field.fieldKind === "message") {
    return "";
  }
  // Enum values reflect as their numbers — matching Go, whose
  // protoreflect.Value.String() prints an enum's number, not its name.
  const value = message.get(field);
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value instanceof Uint8Array) {
    // Go's Value.String() on bytes stringifies the raw bytes; no store
    // caller queries a bytes field, so latin1 is a faithful stand-in.
    return Buffer.from(value).toString("latin1");
  }
  return "";
}

/** camelCase → snake_case (Go toSnakeCase): "executionId" → "execution_id". */
export function toSnakeCase(value: string): string {
  let result = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (i > 0 && ch >= "A" && ch <= "Z") {
      result += "_";
    }
    result += ch;
  }
  return result.toLowerCase();
}
