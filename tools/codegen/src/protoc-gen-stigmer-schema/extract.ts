// Message, field, type, and enum extraction — the port of the Go
// extractor's parse*/extract*/collect* family.
//
// Schema values are built as plain objects whose KEY INSERTION ORDER equals
// the Go struct-tag order and where `undefined` reproduces `omitempty`; the
// gojson serializer turns that into the exact committed bytes. Values that
// Go left as nil slices (marshaling to `null`) are represented as explicit
// `null`.

import type { DescEnum, DescField, DescFile, DescMessage } from "@bufbuild/protobuf";
import { ScalarType } from "@bufbuild/protobuf";

import type { GoJsonStruct, GoJsonValue } from "../gojson.js";
import { stripText } from "../internalcomment/internalcomment.js";
import type { CommentIndex } from "./comments.js";
import { extractTaskKind, toCamelCase } from "./gostrings.js";
import type { OptionsReader, ValidationRules } from "./options.js";

/** Shared context threaded through extraction. */
export interface ExtractContext {
  comments: CommentIndex;
  options: OptionsReader;
}

export interface TypeSpecValue extends GoJsonStruct {
  kind: string;
  keyType?: TypeSpecValue;
  valueType?: TypeSpecValue;
  elementType?: TypeSpecValue;
  messageType?: string;
  enumType?: string;
  enumValues?: string[];
}

export interface FieldSchemaValue extends GoJsonStruct {
  name: string;
  jsonName: string;
  protoField: string;
  type: TypeSpecValue;
  description: string;
  required: boolean;
  isExpression?: boolean;
  referenceKind?: number;
  discriminatedBy?: string;
  oneofGroup?: string;
  validation?: GoJsonStruct;
}

export interface TypeSchemaValue extends GoJsonStruct {
  name: string;
  description: string;
  protoType: string;
  protoFile: string;
  fields: FieldSchemaValue[];
}

export interface EnumSchemaValue extends GoJsonStruct {
  name: string;
  description: string;
  protoType: string;
  values: GoJsonValue;
}

/** Message comment reduced to SDK-facing text (the Go extractComments). */
export function messageDescription(msg: DescMessage, ctx: ExtractContext): string {
  return stripText(ctx.comments.message(msg));
}

/** Port of parseTaskConfig — used for both TaskConfig and Spec messages. */
export function parseTaskConfig(msg: DescMessage, ctx: ExtractContext): GoJsonStruct {
  const kind = extractTaskKind(msg.name);
  const discriminatorValue = ctx.options.discriminatorValue(msg);
  return {
    name: msg.name,
    kind: kind !== "" ? kind : undefined,
    description: messageDescription(msg, ctx),
    protoType: `${msg.file.proto.package}.${msg.name}`,
    protoFile: `apis/${msg.file.proto.name}`,
    discriminatorValue: discriminatorValue !== "" ? discriminatorValue : undefined,
    fields: msg.fields.map((f) => extractFieldSchema(f, ctx)),
  };
}

/** Port of parseSharedType. */
export function parseSharedType(msg: DescMessage, ctx: ExtractContext): TypeSchemaValue {
  return {
    name: msg.name,
    description: messageDescription(msg, ctx),
    protoType: `${msg.file.proto.package}.${msg.name}`,
    protoFile: `apis/${msg.file.proto.name}`,
    fields: msg.fields.map((f) => extractFieldSchema(f, ctx)),
  };
}

/** Port of extractFieldSchema. */
export function extractFieldSchema(field: DescField, ctx: ExtractContext): FieldSchemaValue {
  const validation = ctx.options.validation(field);
  const isExpression = ctx.options.isExpression(field);
  const referenceKind = ctx.options.referenceKind(field);
  const discriminatedBy = ctx.options.discriminatedBy(field);
  return {
    name: toCamelCase(field.name, true),
    jsonName: field.jsonName,
    protoField: field.name,
    type: extractTypeSpec(field),
    description: stripText(ctx.comments.field(field)),
    required: validation !== null && validation.required,
    isExpression: isExpression ? true : undefined,
    referenceKind: referenceKind !== 0 ? referenceKind : undefined,
    discriminatedBy: discriminatedBy !== "" ? discriminatedBy : undefined,
    oneofGroup: oneofGroupName(field),
    validation: validation !== null ? validationStruct(validation) : undefined,
  };
}

// Go's protoreflect reported SYNTHETIC oneofs too (a proto3 `optional int32
// depth` field carries oneofGroup "_depth" in the committed schemas), while
// protobuf-es's field.oneof deliberately hides them. Real oneofs come from
// field.oneof; synthetic ones are detected via proto3Optional (oneofIndex
// itself can't be presence-checked on the plain message shape — proto2
// optionals surface as 0 when unset).
function oneofGroupName(field: DescField): string | undefined {
  if (field.oneof !== undefined) return field.oneof.name;
  if (field.proto.proto3Optional) {
    return field.parent.proto.oneofDecl[field.proto.oneofIndex]?.name;
  }
  return undefined;
}

// Maps captured rules onto the Validation struct's tag order with omitempty
// semantics (zero values drop — including a computed Min of 0, exactly as
// Go's `int` + omitempty did).
function validationStruct(v: ValidationRules): GoJsonStruct {
  return {
    required: v.required ? true : undefined,
    minLength: v.minLength !== 0 ? v.minLength : undefined,
    maxLength: v.maxLength !== 0 ? v.maxLength : undefined,
    pattern: v.pattern !== "" ? v.pattern : undefined,
    min: v.min !== 0 ? v.min : undefined,
    max: v.max !== 0 ? v.max : undefined,
    minItems: v.minItems !== 0 ? v.minItems : undefined,
    maxItems: v.maxItems !== 0 ? v.maxItems : undefined,
    enum: v.enum.length > 0 ? v.enum : undefined,
  };
}

/** Port of extractTypeSpec: map, then array, then scalar/message/enum. */
export function extractTypeSpec(field: DescField): TypeSpecValue {
  if (field.fieldKind === "map") {
    return {
      kind: "map",
      keyType: scalarTypeSpec(field.mapKey, undefined, undefined),
      valueType: scalarTypeSpec(
        field.mapKind === "scalar" ? field.scalar : undefined,
        field.mapKind === "message" ? field.message : undefined,
        field.mapKind === "enum" ? field.enum : undefined,
      ),
    };
  }
  if (field.fieldKind === "list") {
    return {
      kind: "array",
      elementType: scalarTypeSpec(
        field.listKind === "scalar" ? field.scalar : undefined,
        field.listKind === "message" ? field.message : undefined,
        field.listKind === "enum" ? field.enum : undefined,
      ),
    };
  }
  return scalarTypeSpec(field.scalar, field.message, field.enum);
}

/** Port of extractScalarTypeSpec over the element's type parts. */
function scalarTypeSpec(
  scalar: ScalarType | undefined,
  message: DescMessage | undefined,
  enumDesc: DescEnum | undefined,
): TypeSpecValue {
  if (message !== undefined) {
    switch (message.typeName) {
      case "google.protobuf.Struct":
        return { kind: "struct" };
      case "google.protobuf.Value":
        return { kind: "value" };
      case "google.protobuf.Timestamp":
        return { kind: "timestamp" };
      default:
        return { kind: "message", messageType: message.name };
    }
  }
  if (enumDesc !== undefined) {
    const fqn = `${enumDesc.file.proto.package}.${enumDesc.name}`;
    const enumValues: string[] = [];
    for (const v of enumDesc.values) {
      if (v.number === 0) continue;
      enumValues.push(v.name);
    }
    return {
      kind: "string",
      enumType: fqn,
      enumValues: enumValues.length > 0 ? enumValues : undefined,
    };
  }
  switch (scalar) {
    case ScalarType.STRING:
      return { kind: "string" };
    case ScalarType.INT32:
      return { kind: "int32" };
    case ScalarType.UINT32:
      return { kind: "uint32" };
    case ScalarType.INT64:
      return { kind: "int64" };
    case ScalarType.BOOL:
      return { kind: "bool" };
    case ScalarType.FLOAT:
      return { kind: "float" };
    case ScalarType.DOUBLE:
      return { kind: "double" };
    case ScalarType.BYTES:
      return { kind: "bytes" };
    default:
      return { kind: "string" }; // fallback, as in Go
  }
}

/**
 * Port of collectNestedTypes: recursively collects message types referenced
 * by fields (map values first, then message/list-of-message fields), keyed
 * by SHORT name with first-seen-wins, skipping google.protobuf.* types.
 */
export function collectNestedTypes(
  msg: DescMessage,
  sharedTypes: Map<string, TypeSchemaValue>,
  ctx: ExtractContext,
): void {
  for (const field of msg.fields) {
    if (field.fieldKind === "map") {
      if (field.mapKind === "message" && !field.message.typeName.startsWith("google.protobuf")) {
        const typeName = field.message.name;
        if (!sharedTypes.has(typeName)) {
          sharedTypes.set(typeName, parseSharedType(field.message, ctx));
          collectNestedTypes(field.message, sharedTypes, ctx);
        }
      }
      continue;
    }
    const messageType =
      field.fieldKind === "message"
        ? field.message
        : field.fieldKind === "list" && field.listKind === "message"
          ? field.message
          : undefined;
    if (messageType !== undefined && !messageType.typeName.startsWith("google.protobuf")) {
      const typeName = messageType.name;
      if (!sharedTypes.has(typeName)) {
        sharedTypes.set(typeName, parseSharedType(messageType, ctx));
        collectNestedTypes(messageType, sharedTypes, ctx);
      }
    }
  }
}

/** Port of parseEnumSchema: values skip the 0 sentinel; nil values → null. */
export function parseEnumSchema(enumDesc: DescEnum, ctx: ExtractContext): EnumSchemaValue {
  const values: GoJsonStruct[] = [];
  for (const v of enumDesc.values) {
    if (v.number === 0) continue;
    values.push({
      name: v.name,
      number: v.number,
      description: stripText(ctx.comments.enumValue(v)),
    });
  }
  return {
    name: enumDesc.name,
    description: stripText(ctx.comments.enum(enumDesc)),
    protoType: `${enumDesc.file.proto.package}.${enumDesc.name}`,
    values: values.length > 0 ? values : null,
  };
}

/** Files that declare a top-level message with the given short name. */
export function findTopLevelMessage(files: DescFile[], name: string): DescMessage | undefined {
  for (const fd of files) {
    for (const msg of fd.messages) {
      if (msg.name === name) return msg;
    }
  }
  return undefined;
}
