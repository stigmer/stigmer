// mcp-ts target: TypeScript MCP apply-input modules (zod schemas + toProto
// bridges) for the apply-capable resources. Byte-parity port of mcp_ts.go —
// the emitter consumes the shared McpGen model, so the flattened ergonomic
// projection is computed once, exactly as the retired Go emitter did.

import * as fs from "node:fs";
import * as path from "node:path";

import type { SatelliteDir } from "./gen-common.js";
import {
  detectExpandStructFromSchema,
  deriveTSImportBase,
  discoverDomains,
  goQuote,
  indexSatellites,
  loadResourceSchemas,
  lowerFirst,
  protoTypeName,
  sanitizeDescription,
  tsMemberAccess,
  tsObjectKey,
  tsProtoFieldName,
  tsProtoFileToSuffix,
  tsProtoPkg,
  TsImportSet,
  tsResolveEnumImportSmart,
} from "./gen-common.js";
import type { McpGen, McpInputField, McpInputType } from "./mcp-model.js";
import { buildMcpGen, parseMapType } from "./mcp-model.js";
import { apiResourceKindEnumNames, versionedKinds } from "./resource-kind.js";

// Resources the TS MCP server exposes an apply_* tool for; each entry is a
// "<domain>/<resource>" schema directory.
const MCP_TS_APPLY_RESOURCES = ["agentic/agent", "agentic/environment", "agentic/mcpserver", "agentic/workflow"];

/** Port of runMCPTSGeneration. */
export function runMCPTSGeneration(schemaDir: string, outputDir: string): void {
  fs.mkdirSync(outputDir, { recursive: true });

  writeApplyRuntime(outputDir);

  const [, satellitePaths] = discoverDomains(schemaDir);
  const satellites = indexSatellites(satellitePaths);

  for (const rel of MCP_TS_APPLY_RESOURCES) {
    const resourceSchemaDir = path.join(schemaDir, rel);
    generateOne(resourceSchemaDir, outputDir, satellites);
  }
  process.stderr.write(`mcp-ts: generated ${MCP_TS_APPLY_RESOURCES.length} TS apply modules\n`);
}

function generateOne(resourceSchemaDir: string, outputDir: string, satellites: SatelliteDir[]): void {
  const gen = loadResourceSchemas(resourceSchemaDir);
  detectExpandStructFromSchema(gen, satellites);
  const m = buildMcpGen(gen, outputDir);
  generateTSFile(m);
}

// --------------------------------------------------------------------
// TS field classification (interpreting the McpInputField model)
// --------------------------------------------------------------------

type TsCollection = "singular" | "array" | "map";

interface TsField {
  key: string;
  camel: string;
  required: boolean;
  desc: string;
  coll: TsCollection;
  expanded: boolean;
  nested: McpInputType | null;
  isRef: boolean;
  refEnum: string;
  refVersioned: boolean;
  enumType: string;
  isStruct: boolean;
  isValue: boolean;
  isTimestamp: boolean;
  scalar: string;
  isInt64: boolean;
  oneof: string;
}

function classifyField(m: McpGen, f: McpInputField): TsField {
  const tf: TsField = {
    key: f.protoField,
    camel: tsProtoFieldName(f.protoField),
    required: !f.jsonTag.includes("omitempty"),
    desc: f.schemaTag,
    coll: "singular",
    expanded: f.isExpandedConfig,
    nested: null,
    isRef: false,
    refEnum: "",
    refVersioned: false,
    enumType: "",
    isStruct: false,
    isValue: false,
    isTimestamp: false,
    scalar: "",
    isInt64: false,
    oneof: "",
  };
  if (f.oneofGroup !== "" && !f.oneofGroup.startsWith("_")) {
    tf.oneof = tsProtoFieldName(f.oneofGroup);
  }

  // Struct/Value/Timestamp are leaf kinds whose Go type would otherwise be
  // misread as a collection or scalar.
  if (f.isStruct) {
    tf.isStruct = true;
    return tf;
  }
  if (f.isValue) {
    tf.isValue = true;
    return tf;
  }
  if (f.isTimestamp) {
    tf.isTimestamp = true;
    return tf;
  }

  let goType = f.goType;
  if (goType.startsWith("[]") && goType !== "[]byte") {
    tf.coll = "array";
    goType = goType.slice(2);
  } else if (goType.startsWith("map[")) {
    tf.coll = "map";
    [, goType] = parseMapType(goType);
  }
  if (goType.startsWith("*")) goType = goType.slice(1);

  if (f.inputTypeName !== "") {
    let name = f.inputTypeName;
    if (name.startsWith("[]")) name = name.slice(2);
    if (name.startsWith("*")) name = name.slice(1);
    tf.nested = m.findInputType(name);
    if (tf.nested !== null && tf.nested.isReference) {
      tf.isRef = true;
      tf.refEnum = apiResourceKindEnumNames.get(tf.nested.refKindVal) ?? "";
      tf.refVersioned = versionedKinds.has(tf.nested.refKindVal);
    }
  } else if (f.enumType !== "") {
    tf.enumType = f.enumType;
  } else if (goType === "[]byte") {
    tf.scalar = "bytes";
  } else {
    tf.scalar = goType;
    tf.isInt64 = goType === "int64" || goType === "uint64";
  }
  return tf;
}

function tsToProtoFn(it: McpInputType): string {
  return lowerFirst(it.name) + "ToProto";
}

function tsSchemaConst(name: string): string {
  return name + "Schema";
}

// --------------------------------------------------------------------
// Dependency graph + cycle detection
// --------------------------------------------------------------------

function typeDeps(it: McpInputType): string[] {
  const deps: string[] = [];
  for (const f of it.fields) {
    if (f.inputTypeName === "") continue;
    let name = f.inputTypeName;
    if (name.startsWith("[]")) name = name.slice(2);
    if (name.startsWith("*")) name = name.slice(1);
    deps.push(name);
  }
  return deps;
}

function cyclicTypes(m: McpGen): Set<string> {
  const graph = new Map<string, string[]>();
  for (const it of m.inputTypes) {
    graph.set(it.name, typeDeps(it));
  }
  const cyclic = new Set<string>();
  for (const start of m.inputTypes) {
    const seen = new Set<string>();
    const stack = [...(graph.get(start.name) ?? [])];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (n === start.name) {
        cyclic.add(start.name);
        break;
      }
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...(graph.get(n) ?? []));
    }
  }
  return cyclic;
}

// --------------------------------------------------------------------
// File generation
// --------------------------------------------------------------------

function generateTSFile(m: McpGen): void {
  const resourceName = m.spec.name.endsWith("Spec") ? m.spec.name.slice(0, -4) : m.spec.name;
  const kind = resourceName;
  const apiVersion = m.deriveApiVersion(m.spec.protoType);
  const resourceBase = deriveTSImportBase(tsProtoPkg(m.spec.protoType));

  const cyclic = cyclicTypes(m);
  const imports = new TsImportSet();
  imports.addValue("zod", "z");
  imports.addValue("@bufbuild/protobuf", "create");
  imports.addValue(resourceBase + "/api_pb", kind + "Schema");
  imports.addType(resourceBase + "/api_pb", kind);
  imports.addValue("./apply-runtime.js", "generateSlug");
  imports.addValue("./apply-runtime.js", "visibilityFromString");

  const body: string[] = [];

  genTSTopLevelSchema(m, body, kind, imports);
  for (const it of m.inputTypes.slice(1)) {
    genTSNestedSchema(m, body, it, cyclic, imports);
  }

  body.push("\n");
  genTSTopLevelToProto(m, body, kind, apiVersion, resourceBase, imports);
  for (const it of m.inputTypes.slice(1)) {
    genTSNestedToProto(m, body, it, imports);
  }

  const full: string[] = [];
  full.push("// Code generated by stigmer-codegen --target=mcp-ts. DO NOT EDIT.\n");
  full.push("//\n");
  full.push(`// Flattened apply-input zod schema + toProto bridge for the ${kind} resource.\n`);
  full.push(`// Source proto package: ${tsProtoPkg(m.spec.protoType)}\n\n`);
  imports.emit(full);
  full.push(...body);

  // Match the schema directory's resource name, not the proto Kind.
  const filename = lowerFirst(resourceName).toLowerCase();
  fs.writeFileSync(path.join(m.outputDir, filename + ".ts"), full.join(""));
}

// --------------------------------------------------------------------
// Zod schema emission
// --------------------------------------------------------------------

// The six hoisted identity fields shared by every top-level apply input.
function identityZodFields(w: string[]): void {
  w.push(`  name: z.string().describe(${goQuote("Human-readable name of the resource.")}),\n`);
  w.push(`  slug: z.string().optional().describe(${goQuote("URL-friendly identifier (lowercase alphanumeric with hyphens). Auto-generated from name if omitted.")}),\n`);
  w.push(`  org: z.string().describe(${goQuote("Organization that owns this resource (e.g. acme).")}),\n`);
  w.push(`  visibility: z.string().optional().describe(${goQuote("Resource visibility: PRIVATE or PUBLIC. Applied at create; on updates a changed value is landed through the guarded UpdateVisibility RPC. Omit to leave unchanged.")}),\n`);
  w.push(`  labels: z.record(z.string()).optional().describe(${goQuote("Key-value labels for organization and filtering.")}),\n`);
  w.push(`  tags: z.array(z.string()).optional().describe(${goQuote("Tags for categorization and discovery.")}),\n`);
}

function genTSTopLevelSchema(m: McpGen, w: string[], kind: string, imports: TsImportSet): void {
  const top = m.inputTypes[0];
  if (top.description !== "") {
    w.push(`/** ${sanitizeDescription(top.description)} */\n`);
  }
  w.push(`export const ${kind}InputShape = {\n`);
  identityZodFields(w);
  for (const f of top.fields) {
    genTSZodField(w, classifyField(m, f));
  }
  w.push("} as const;\n\n");
  w.push(`export const ${kind}InputSchema = z.object(${kind}InputShape);\n`);
  w.push(`export type ${kind}Input = z.infer<typeof ${kind}InputSchema>;\n\n`);
}

function genTSNestedSchema(m: McpGen, w: string[], it: McpInputType, cyclic: Set<string>, imports: TsImportSet): void {
  if (it.isReference) {
    w.push(`const ${tsSchemaConst(it.name)} = z.object({\n`);
    for (const f of it.fields) {
      genTSZodField(w, classifyField(m, f));
    }
    w.push("});\n");
    w.push(`type ${it.name} = z.infer<typeof ${tsSchemaConst(it.name)}>;\n\n`);
    return;
  }

  if (cyclic.has(it.name)) {
    genTSInterface(m, w, it);
    w.push(`const ${tsSchemaConst(it.name)}: z.ZodType<${it.name}> = z.lazy(() => z.object({\n`);
    for (const f of it.fields) {
      genTSZodField(w, classifyField(m, f));
    }
    w.push("}));\n\n");
    return;
  }

  w.push(`const ${tsSchemaConst(it.name)} = z.object({\n`);
  for (const f of it.fields) {
    genTSZodField(w, classifyField(m, f));
  }
  w.push("});\n");
  w.push(`type ${it.name} = z.infer<typeof ${tsSchemaConst(it.name)}>;\n\n`);
}

function genTSZodField(w: string[], tf: TsField): void {
  const leaf = tsZodLeaf(tf);
  let expr = leaf;
  if (tf.coll === "array") expr = `z.array(${leaf})`;
  else if (tf.coll === "map") expr = `z.record(${leaf})`;
  if (!tf.required) expr += ".optional()";
  if (tf.desc !== "") expr += `.describe(${goQuote(tf.desc)})`;
  w.push(`  ${tsObjectKey(tf.key)}: ${expr},\n`);
}

function tsZodLeaf(tf: TsField): string {
  if (tf.nested !== null) {
    return `z.lazy(() => ${tsSchemaConst(tf.nested.name)})`;
  }
  if (tf.enumType !== "") return "z.string()";
  if (tf.isStruct) return "z.record(z.unknown())";
  if (tf.isValue) return "z.unknown()";
  if (tf.isTimestamp) return "z.string()";
  return tsZodScalar(tf.scalar);
}

function tsZodScalar(goType: string): string {
  switch (goType) {
    case "string":
    case "bytes":
      return "z.string()";
    case "bool":
      return "z.boolean()";
    case "int32":
    case "uint32":
    case "float32":
    case "float64":
      return "z.number()";
    case "int64":
    case "uint64":
      return "z.union([z.number(), z.string()])";
    default:
      return "z.string()";
  }
}

// --------------------------------------------------------------------
// Explicit interface emission (recursive types only)
// --------------------------------------------------------------------

function genTSInterface(m: McpGen, w: string[], it: McpInputType): void {
  w.push(`interface ${it.name} {\n`);
  for (const f of it.fields) {
    const tf = classifyField(m, f);
    const opt = tf.required ? "" : "?";
    w.push(`  ${tsObjectKey(tf.key)}${opt}: ${tsTypeLeaf(tf)};\n`);
  }
  w.push("}\n");
}

function tsTypeLeaf(tf: TsField): string {
  let leaf: string;
  if (tf.nested !== null) leaf = tf.nested.name;
  else if (tf.enumType !== "") leaf = "string";
  else if (tf.isStruct) leaf = "Record<string, unknown>";
  else if (tf.isValue) leaf = "unknown";
  else if (tf.isTimestamp) leaf = "string";
  else leaf = tsScalarType(tf.scalar);

  if (tf.coll === "array") return leaf + "[]";
  if (tf.coll === "map") return `Record<string, ${leaf}>`;
  return leaf;
}

function tsScalarType(goType: string): string {
  switch (goType) {
    case "string":
    case "bytes":
      return "string";
    case "bool":
      return "boolean";
    case "int32":
    case "uint32":
    case "float32":
    case "float64":
      return "number";
    case "int64":
    case "uint64":
      return "number | string";
    default:
      return "string";
  }
}

// --------------------------------------------------------------------
// toProto emission
// --------------------------------------------------------------------

function genTSTopLevelToProto(m: McpGen, w: string[], kind: string, apiVersion: string, resourceBase: string, imports: TsImportSet): void {
  const top = m.inputTypes[0];
  const specName = protoTypeName(m.spec.protoType);
  const specSuffix = tsProtoFileToSuffix(m.spec.protoFile);
  imports.addValue(resourceBase + "/" + specSuffix, specName + "Schema");
  imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb", "ApiResourceMetadataSchema");

  w.push(`/** Build the fully-formed ${kind} proto from the flat MCP apply input. */\n`);
  w.push(`export function ${lowerFirst(kind)}InputToProto(input: ${kind}Input): ${kind} {\n`);
  w.push("  const slug = input.slug && input.slug.length > 0 ? input.slug : generateSlug(input.name);\n");
  w.push(`  const spec = create(${specName}Schema);\n`);
  genTSSpecAssignments(m, w, top, "spec", imports);
  w.push(`  return Object.assign(create(${kind}Schema), {\n`);
  w.push(`    apiVersion: ${goQuote(apiVersion)},\n`);
  w.push(`    kind: ${goQuote(kind)},\n`);
  w.push("    metadata: Object.assign(create(ApiResourceMetadataSchema), {\n");
  w.push("      name: input.name,\n");
  w.push("      slug,\n");
  w.push("      org: input.org,\n");
  w.push("      ...(input.visibility !== undefined && { visibility: visibilityFromString(input.visibility) }),\n");
  w.push("      ...(input.labels !== undefined && { labels: input.labels }),\n");
  w.push("      ...(input.tags !== undefined && { tags: input.tags }),\n");
  w.push("    }),\n");
  w.push("    spec,\n");
  w.push(`  }) as ${kind};\n`);
  w.push("}\n\n");
}

function genTSNestedToProto(m: McpGen, w: string[], it: McpInputType, imports: TsImportSet): void {
  if (it.isReference) {
    imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceReferenceSchema");
    imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb", "ApiResourceKind");
    const enumName = apiResourceKindEnumNames.get(it.refKindVal) ?? "";
    w.push(`function ${tsToProtoFn(it)}(input: ${it.name}) {\n`);
    w.push("  return create(ApiResourceReferenceSchema, {\n");
    w.push("    org: input.org,\n");
    w.push("    slug: input.slug,\n");
    w.push(`    kind: ApiResourceKind.${enumName},\n`);
    if (versionedKinds.has(it.refKindVal)) {
      w.push("    version: input.version,\n");
    }
    w.push("  });\n");
    w.push("}\n\n");
    return;
  }

  const protoName = protoTypeName(it.protoType);
  const suffix = tsProtoFileToSuffix(it.protoFile);
  const base = deriveTSImportBase(tsProtoPkg(it.protoType));
  imports.addValue(base + "/" + suffix, protoName + "Schema");

  w.push(`function ${tsToProtoFn(it)}(input: ${it.name}) {\n`);
  w.push(`  const result = create(${protoName}Schema);\n`);
  genTSSpecAssignments(m, w, it, "result", imports);
  w.push("  return result;\n");
  w.push("}\n\n");
}

function genTSSpecAssignments(m: McpGen, w: string[], it: McpInputType, dst: string, imports: TsImportSet): void {
  for (const f of it.fields) {
    const tf = classifyField(m, f);
    if (tf.expanded) continue; // handled by the task_config switch
    genTSFieldAssign(w, tf, dst, imports);
  }
  if (m.hasExpandedConfigFields(it)) {
    genTSConfigSwitch(m, w, it, dst, imports);
  }
}

function genTSFieldAssign(w: string[], tf: TsField, dst: string, imports: TsImportSet): void {
  const inExpr = "input." + tsMemberAccess(tf.key);

  // Real oneof member: assign the { case, value } wrapper.
  if (tf.oneof !== "") {
    const val = tsLeafValueExpr(tf, inExpr, imports);
    w.push(`  if (${inExpr} !== undefined) ${dst}.${tf.oneof} = { case: ${goQuote(tf.camel)}, value: ${val} };\n`);
    return;
  }

  if (tf.enumType !== "") {
    const [from, enumName] = tsResolveEnumImportSmart(tf.enumType);
    imports.addValue(from, enumName);
    imports.addValue("./apply-runtime.js", "enumFromString");
    if (tf.coll === "array") {
      w.push(`  if (${inExpr} !== undefined) ${dst}.${tf.camel} = ${inExpr}.map((v) => enumFromString(${enumName}, v) as ${enumName});\n`);
    } else {
      w.push(`  ${dst}.${tf.camel} = enumFromString(${enumName}, ${inExpr}) as ${enumName};\n`);
    }
  } else if (tf.isStruct) {
    imports.addType("@bufbuild/protobuf", "JsonObject");
    w.push(`  if (${inExpr} !== undefined) ${dst}.${tf.camel} = ${inExpr} as JsonObject;\n`);
  } else if (tf.isValue) {
    imports.addValue("@bufbuild/protobuf", "fromJson");
    imports.addType("@bufbuild/protobuf", "JsonValue");
    imports.addValue("@bufbuild/protobuf/wkt", "ValueSchema");
    w.push(`  if (${inExpr} !== undefined) ${dst}.${tf.camel} = fromJson(ValueSchema, ${inExpr} as JsonValue);\n`);
  } else if (tf.isTimestamp) {
    imports.addValue("./apply-runtime.js", "toTimestamp");
    w.push(`  if (${inExpr} !== undefined) ${dst}.${tf.camel} = toTimestamp(${inExpr});\n`);
  } else if (tf.nested !== null) {
    if (tf.coll === "array") {
      w.push(`  if (${inExpr} !== undefined) ${dst}.${tf.camel} = ${inExpr}.map(${tsToProtoFn(tf.nested)});\n`);
    } else if (tf.coll === "map") {
      w.push(`  if (${inExpr} !== undefined) {\n`);
      w.push(`    for (const [k, v] of Object.entries(${inExpr})) ${dst}.${tf.camel}[k] = ${tsToProtoFn(tf.nested)}(v);\n`);
      w.push("  }\n");
    } else {
      w.push(`  if (${inExpr} !== undefined) ${dst}.${tf.camel} = ${tsToProtoFn(tf.nested)}(${inExpr});\n`);
    }
  } else {
    if (tf.isInt64 && tf.coll === "singular") {
      w.push(`  if (${inExpr} !== undefined) ${dst}.${tf.camel} = BigInt(${inExpr});\n`);
      return;
    }
    if (tf.isInt64 && tf.coll === "array") {
      w.push(`  if (${inExpr} !== undefined) ${dst}.${tf.camel} = ${inExpr}.map((v) => BigInt(v));\n`);
      return;
    }
    w.push(`  if (${inExpr} !== undefined) ${dst}.${tf.camel} = ${inExpr};\n`);
  }
}

function tsLeafValueExpr(tf: TsField, inExpr: string, imports: TsImportSet): string {
  if (tf.nested !== null) {
    return `${tsToProtoFn(tf.nested)}(${inExpr})`;
  }
  if (tf.isValue) {
    imports.addValue("@bufbuild/protobuf", "fromJson");
    imports.addType("@bufbuild/protobuf", "JsonValue");
    imports.addValue("@bufbuild/protobuf/wkt", "ValueSchema");
    return `fromJson(ValueSchema, ${inExpr} as JsonValue)`;
  }
  if (tf.isTimestamp) {
    imports.addValue("./apply-runtime.js", "toTimestamp");
    return `toTimestamp(${inExpr})`;
  }
  if (tf.enumType !== "") {
    const [from, enumName] = tsResolveEnumImportSmart(tf.enumType);
    imports.addValue(from, enumName);
    imports.addValue("./apply-runtime.js", "enumFromString");
    return `enumFromString(${enumName}, ${inExpr}) as ${enumName}`;
  }
  return inExpr;
}

// The workflow task_config discriminated-union switch: each kind sets the
// google.protobuf.Struct task_config from the typed per-kind config proto.
function genTSConfigSwitch(m: McpGen, w: string[], it: McpInputType, dst: string, imports: TsImportSet): void {
  imports.addValue("@bufbuild/protobuf", "toJson");
  imports.addType("@bufbuild/protobuf", "JsonObject");
  const structFieldCamel = tsProtoFieldName(m.expandStruct!.structField);

  w.push("  switch (input.kind) {\n");
  for (const f of it.fields) {
    if (!f.isExpandedConfig) continue;
    const cfgType = m.findInputType(f.inputTypeName);
    if (cfgType === null) continue;
    const cfgProtoName = protoTypeName(cfgType.protoType);
    const cfgSuffix = tsProtoFileToSuffix(cfgType.protoFile);
    const cfgBase = deriveTSImportBase(tsProtoPkg(cfgType.protoType));
    imports.addValue(cfgBase + "/" + cfgSuffix, cfgProtoName + "Schema");

    const inExpr = "input." + tsMemberAccess(f.protoField);
    w.push(`    case ${goQuote(f.protoField)}:\n`);
    w.push(`      if (${inExpr} !== undefined) ${dst}.${structFieldCamel} = toJson(${cfgProtoName}Schema, ${tsToProtoFn(cfgType)}(${inExpr})) as JsonObject;\n`);
    w.push("      break;\n");
  }
  w.push("    default:\n");
  w.push('      if (input.kind !== undefined && input.kind !== "") {\n');
  w.push("        throw new Error(`unknown task kind: ${input.kind}`);\n");
  w.push("      }\n");
  w.push("  }\n");
}

// --------------------------------------------------------------------
// apply-runtime.ts (shared, generated helpers)
// --------------------------------------------------------------------

function writeApplyRuntime(outputDir: string): void {
  const content = `// Code generated by stigmer-codegen --target=mcp-ts. DO NOT EDIT.
//
// Shared runtime helpers for the generated apply-input toProto bridges.

import { timestampFromDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

/**
 * Slugify a resource name: lowercase, collapse each run of non-alphanumeric
 * characters into a single hyphen, then trim leading/trailing hyphens.
 */
export function generateSlug(name: string): string {
  if (!name) return "";
  let out = "";
  let lastHyphen = false;
  for (const ch of name.toLowerCase()) {
    if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) {
      out += ch;
      lastHyphen = false;
    } else if (!lastHyphen) {
      out += "-";
      lastHyphen = true;
    }
  }
  return out.replace(/^-+/, "").replace(/-+$/, "");
}

/** Map the PUBLIC/PRIVATE apply input string to the visibility enum. */
export function visibilityFromString(s: string | undefined): ApiResourceVisibility {
  if (s && s.toUpperCase() === "PUBLIC") return ApiResourceVisibility.visibility_public;
  if (s && s.toUpperCase() === "PRIVATE") return ApiResourceVisibility.visibility_private;
  return ApiResourceVisibility.api_resource_visibility_unspecified;
}

/**
 * Resolve an enum value-name string to its numeric value, leniently: an unknown
 * or missing value yields 0 (the proto UNSPECIFIED sentinel), matching the Go
 * generator's EnumType_value[input] lookup.
 */
export function enumFromString(
  enumObj: Record<string, string | number>,
  value: string | undefined,
): number {
  if (value === undefined) return 0;
  const v = enumObj[value];
  return typeof v === "number" ? v : 0;
}

/** Convert an ISO-8601 string to a protobuf Timestamp message. */
export function toTimestamp(value: string): Timestamp {
  return timestampFromDate(new Date(value));
}
`;
  fs.writeFileSync(path.join(outputDir, "apply-runtime.ts"), content);
}
