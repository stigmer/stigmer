// Update-input mapper generation — the inverse of buildXxxProto. The
// platform's update RPCs are FULL-SPEC REPLACEMENTS, so the generated
// toXxxUpdateInput maps a FETCHED resource to a complete XxxInput; editors
// spread it and override only what they change (the wipe-bug class behind
// stigmer/stigmer#319 / oss#293). Byte-parity port of
// sdk_client_ts_update_input.go; the semantic rules live in the emitted
// doc comments.

import type { ServiceSchemaFile } from "./gen-common.js";
import { deriveTSImportBase, isSpecialType, isSyntheticOneof, tsProtoFieldName, tsProtoFileToSuffix } from "./gen-common.js";
import type { TsImportSet } from "./gen-common.js";
import type { SdkResourceConfig } from "./sdk-resource-config.js";
import { META_FIELD_NAMES } from "./sdk-resource-config.js";
import type { FieldSchema, TaskConfigSchema, TypeSchema, TypeSpec } from "./schema.js";

/** True when a command controller exposes Update taking the resource. */
export function tsHasUpdateRPC(schema: ServiceSchemaFile, cfg: SdkResourceConfig): boolean {
  for (const svc of schema.services) {
    for (const m of svc.methods) {
      if (m.name.toLowerCase() === "update" && m.inputType === cfg.protoResType) {
        return true;
      }
    }
  }
  return false;
}

// TYPE import for a nested message (the mapper parameter type) — twin of
// tsAddSchemaImport, which imports the value-level Schema.
function tsAddMessageTypeImport(ts: TypeSchema, imports: TsImportSet, importBase: string): void {
  if (ts.protoFile !== "") {
    let effectiveBase = importBase;
    if (ts.protoType !== "") {
      const parts = ts.protoType.split(".");
      if (parts.length > 1) {
        effectiveBase = deriveTSImportBase(parts.slice(0, -1).join("."));
      }
    }
    imports.addType(effectiveBase + "/" + tsProtoFileToSuffix(ts.protoFile), ts.name);
  } else {
    imports.addType(importBase + "/spec_pb", ts.name);
  }
}

/** Port of generateTSUpdateInputMapper. */
export function generateTSUpdateInputMapper(
  buf: string[],
  schema: ServiceSchemaFile,
  cfg: SdkResourceConfig,
  spec: TaskConfigSchema,
  typeMap: Map<string, TypeSchema>,
  imports: TsImportSet,
): void {
  const importBase = deriveTSImportBase(schema.package);
  const inputName = cfg.inputPrefix + "Input";

  const specFields = spec.fields.filter((f) => !META_FIELD_NAMES.has(f.name));

  // Nested mappers first, mirroring the nested-builder order.
  const emitted = new Set<string>();
  for (const f of specFields) {
    emitTSNestedUpdateInputMappers(buf, f, typeMap, emitted, imports, importBase);
  }

  buf.push("/**\n");
  buf.push(` * Maps a fetched {@link ${cfg.protoResType}} to a complete {@link ${inputName}} for \`update()\`.\n`);
  buf.push(" *\n");
  buf.push(" * The update RPC replaces the ENTIRE spec — spread this mapper's output\n");
  buf.push(" * and override only the fields you edit (spread nested objects the same\n");
  buf.push(" * way):\n");
  buf.push(" *\n");
  buf.push(` *   await client.update({ ...to${cfg.protoResType}UpdateInput(res), description: next });\n`);
  buf.push(" *\n");
  buf.push(" * Proto3 defaults normalize to `undefined`; resource references keep\n");
  buf.push(" * `version` (pinned refs) and `kind`.\n");
  buf.push(" */\n");
  buf.push(`export function to${cfg.protoResType}UpdateInput(resource: ${cfg.protoResType}): ${inputName} {\n`);
  buf.push("  const meta = resource.metadata;\n");
  buf.push(`  const spec = resource.spec ?? create(${spec.name}Schema);\n`);
  buf.push("  return {\n");
  buf.push("    // Exact update addressing (id-first in the update pipeline) — for\n");
  buf.push("    // platform-scoped (org-less) kinds the org+slug fallback cannot\n");
  buf.push("    // match, so the id is the ONLY working address.\n");
  buf.push("    id: meta?.id || undefined,\n");
  buf.push('    name: meta?.name ?? "",\n');
  buf.push("    slug: meta?.slug || undefined,\n");
  if (schema.resource === "organization") {
    // An organization's own metadata.org may be unset; updates address the
    // org by its slug in that case.
    buf.push('    org: meta?.org || meta?.slug || "",\n');
  } else {
    buf.push('    org: meta?.org ?? "",\n');
  }
  buf.push("    labels: meta?.labels && Object.keys(meta.labels).length > 0 ? { ...meta.labels } : undefined,\n");
  buf.push("    visibility: meta?.visibility || undefined,\n");
  if (cfg.isVersioned) {
    buf.push("    // Never carried over: a version message describes the NEXT update.\n");
    buf.push("    versionMessage: undefined,\n");
  }
  emitTSUpdateInputFields(buf, "    ", "spec", specFields, typeMap, imports);
  buf.push("  };\n");
  buf.push("}\n");
}

function emitTSUpdateInputFields(
  buf: string[],
  indent: string,
  src: string,
  fields: FieldSchema[],
  typeMap: Map<string, TypeSchema>,
  imports: TsImportSet,
): void {
  for (const f of fields) {
    const fieldName = tsProtoFieldName(f.protoField);
    let expr: string;
    if (f.oneofGroup !== undefined && f.oneofGroup !== "" && !isSyntheticOneof(f.oneofGroup)) {
      expr = tsUpdateInputOneofExpr(f, src, typeMap, imports);
    } else {
      expr = tsUpdateInputFieldExpr(f, src + "." + fieldName, imports);
    }
    buf.push(`${indent}${fieldName}: ${expr},\n`);
  }
}

// One oneof member: set when the oneof's case matches, undefined otherwise.
function tsUpdateInputOneofExpr(
  f: FieldSchema,
  src: string,
  typeMap: Map<string, TypeSchema>,
  imports: TsImportSet,
): string {
  const group = src + "." + tsProtoFieldName(f.oneofGroup ?? "");
  const member = tsProtoFieldName(f.protoField);
  const guard = `${group}?.case === "${member}"`;
  const value = group + ".value";

  const msgType = f.type.messageType ?? "";
  if (msgType === "ApiResourceReference") {
    imports.addValue("./proto-utils", "toResourceRefInput");
    return `${guard} ? toResourceRefInput(${value}) : undefined`;
  }
  if (msgType !== "" && !isSpecialType(msgType)) {
    if (typeMap.has(msgType)) {
      return `${guard} ? to${msgType}Input(${value}) : undefined`;
    }
    return `${guard} ? ${value} : undefined`;
  }
  return `${guard} ? ${value} : undefined`;
}

// TS zero-value literal for a required scalar Input field.
function tsZeroValueForScalar(ts: TypeSpec): string {
  switch (ts.kind) {
    case "string":
      if (ts.enumType !== undefined && ts.enumType !== "") return "0";
      return '""';
    case "bool":
      return "false";
    case "int64":
      return "0n";
    default:
      return "0";
  }
}

function tsUpdateInputFieldExpr(f: FieldSchema, access: string, imports: TsImportSet): string {
  const t = f.type;
  const required = f.required;

  if (t.kind === "timestamp") {
    imports.addValue("@bufbuild/protobuf/wkt", "timestampDate");
    if (required) return `${access} ? timestampDate(${access}) : new Date(0)`;
    return `${access} ? timestampDate(${access}) : undefined`;
  }
  if (t.kind === "value") {
    imports.addValue("@bufbuild/protobuf", "toJson");
    imports.addValue("@bufbuild/protobuf/wkt", "ValueSchema");
    if (required) return `${access} ? toJson(ValueSchema, ${access}) : null`;
    return `${access} ? toJson(ValueSchema, ${access}) : undefined`;
  }
  if (t.kind === "struct") {
    if (required) return `${access} ?? {}`;
    return access;
  }
  if (t.kind === "bytes") {
    if (required) return access;
    return `${access}?.length ? ${access} : undefined`;
  }
  if (
    t.kind === "string" || t.kind === "bool" || t.kind === "int32" ||
    t.kind === "int64" || t.kind === "uint32" || t.kind === "float" ||
    t.kind === "double"
  ) {
    if (required) return `${access} ?? ${tsZeroValueForScalar(t)}`;
    return `${access} || undefined`;
  }
  if (t.kind === "message" && t.messageType === "EnvironmentSpec") {
    imports.addValue("./proto-utils", "toEnvSpecInput");
    if (required) return `toEnvSpecInput(${access}) ?? { variables: {} }`;
    return `toEnvSpecInput(${access})`;
  }
  if (t.kind === "message" && t.messageType === "ApiResourceReference") {
    imports.addValue("./proto-utils", "toResourceRefInput");
    if (required) return `toResourceRefInput(${access}) ?? { org: "", slug: "" }`;
    return `toResourceRefInput(${access})`;
  }
  if (t.kind === "message") {
    const msgType = t.messageType ?? "";
    if (required) return `to${msgType}Input(${access} ?? create(${msgType}Schema))`;
    return `${access} ? to${msgType}Input(${access}) : undefined`;
  }
  if (t.kind === "array" && t.elementType?.kind === "message" && t.elementType.messageType === "ApiResourceReference") {
    imports.addValue("./proto-utils", "toResourceRefInputs");
    if (required) return `toResourceRefInputs(${access}) ?? []`;
    return `toResourceRefInputs(${access})`;
  }
  if (t.kind === "array" && t.elementType?.kind === "message") {
    const elemMsg = t.elementType.messageType ?? "";
    if (required) return `(${access} ?? []).map(to${elemMsg}Input)`;
    return `${access}?.length ? ${access}.map(to${elemMsg}Input) : undefined`;
  }
  if (t.kind === "array") {
    if (required) return `[...(${access} ?? [])]`;
    return `${access}?.length ? [...${access}] : undefined`;
  }
  if (t.kind === "map" && t.valueType?.messageType === "EnvironmentValue") {
    imports.addValue("./proto-utils", "toEnvVarInputMap");
    if (required) return `toEnvVarInputMap(${access}) ?? {}`;
    return `toEnvVarInputMap(${access})`;
  }
  if (t.kind === "map" && t.valueType?.messageType === "ExecutionValue") {
    imports.addValue("./proto-utils", "toExecVarInputMap");
    if (required) return `toExecVarInputMap(${access}) ?? {}`;
    return `toExecVarInputMap(${access})`;
  }
  if (t.kind === "map" && t.valueType?.kind === "message") {
    const elemMsg = t.valueType.messageType ?? "";
    const mapExpr = `Object.fromEntries(Object.entries(${access}).map(([k, v]) => [k, to${elemMsg}Input(v)]))`;
    if (required) {
      return `Object.fromEntries(Object.entries(${access} ?? {}).map(([k, v]) => [k, to${elemMsg}Input(v)]))`;
    }
    return `Object.keys(${access} ?? {}).length > 0 ? ${mapExpr} : undefined`;
  }
  if (t.kind === "map") {
    if (required) return `{ ...${access} }`;
    return `Object.keys(${access} ?? {}).length > 0 ? { ...${access} } : undefined`;
  }
  return access;
}

// One private toXxxInput(msg) helper per non-special nested message type,
// in the same order as the nested builders (sub-types first).
function emitTSNestedUpdateInputMappers(
  buf: string[],
  f: FieldSchema,
  typeMap: Map<string, TypeSchema>,
  emitted: Set<string>,
  imports: TsImportSet,
  importBase: string,
): void {
  let msgName: string;
  const t = f.type;
  if (t.kind === "message") {
    msgName = t.messageType ?? "";
  } else if (t.kind === "array" && t.elementType?.kind === "message") {
    msgName = t.elementType.messageType ?? "";
  } else if (t.kind === "map" && t.valueType?.kind === "message") {
    msgName = t.valueType.messageType ?? "";
  } else {
    return;
  }

  if (isSpecialType(msgName) || emitted.has(msgName)) return;
  const ts = typeMap.get(msgName);
  if (ts === undefined) return;
  emitted.add(msgName);

  for (const field of ts.fields) {
    emitTSNestedUpdateInputMappers(buf, field, typeMap, emitted, imports, importBase);
  }

  tsAddMessageTypeImport(ts, imports, importBase);

  buf.push(`function to${msgName}Input(msg: ${msgName}): ${msgName}Input {\n`);
  buf.push("  return {\n");
  emitTSUpdateInputFields(buf, "    ", "msg", ts.fields, typeMap, imports);
  buf.push("  };\n");
  buf.push("}\n\n");
}
