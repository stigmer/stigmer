// sdk-client-ts target: typed resource clients for the TypeScript SDK
// (sdk/typescript/src/gen). Byte-parity port of sdk_client_ts.go — per
// resource: the client class over the Connect service stubs, the flattened
// XxxInput interfaces, the buildXxxProto builders, and the
// toXxxUpdateInput mappers; plus the aggregate client.ts and the kind-meta
// files.

import * as fs from "node:fs";
import * as path from "node:path";

import type { MethodSchema, ServiceDefinition, ServiceSchemaFile } from "./gen-common.js";
import {
  deriveTSImportBase,
  goQuote,
  isCommonsType,
  isEmptyType,
  isIDType,
  isSpecialType,
  isSyntheticOneof,
  searchListSupersedesMethod,
  tsClientFieldName,
  TsImportSet,
  tsMethodName,
  tsProtoFieldName,
  tsProtoFileToSuffix,
  tsResolveCommonsImport,
  tsResolveEnumImport,
  tsServiceImportSuffix,
} from "./gen-common.js";
import type { ResourceGenInfo, SdkResourceConfig } from "./sdk-resource-config.js";
import { deriveResourceConfig, loadSpecSchemaWithTypes, META_FIELD_NAMES } from "./sdk-resource-config.js";
import { generateTSBidiStream, generateTSErrors, generateTSProtoUtils, generateTSTypes } from "./sdk-client-ts-static.js";
import { generateTSUpdateInputMapper, tsHasUpdateRPC } from "./sdk-client-ts-update.js";
import { generateTSKindMeta } from "./sdk-kind-meta-ts.js";
import type { FieldSchema, TaskConfigSchema, TypeSchema, TypeSpec } from "./schema.js";
import { readDirSorted } from "./schema.js";

/** Port of runSDKClientTSGeneration. */
export function runSDKClientTSGeneration(schemaDir: string, outputDir: string): void {
  const servicesDir = path.join(schemaDir, "services");
  const entries = readDirSorted(servicesDir);
  fs.mkdirSync(outputDir, { recursive: true });

  generateTSErrors(outputDir);
  generateTSProtoUtils(outputDir);
  generateTSTypes(outputDir);
  generateTSBidiStream(outputDir);

  const allResources: ResourceGenInfo[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() || !entry.name.endsWith(".json")) continue;
    const resource = entry.name.slice(0, -".json".length);
    if (resource === "search" || resource === "commons") continue;

    const schema = JSON.parse(fs.readFileSync(path.join(servicesDir, entry.name), "utf8")) as ServiceSchemaFile;
    const cfg = deriveResourceConfig(schema, schemaDir);

    let specSchema: TaskConfigSchema | null = null;
    let specTypes: TypeSchema[] = [];
    if (cfg.specSchema !== "") {
      [specSchema, specTypes] = loadSpecSchemaWithTypes(path.join(schemaDir, cfg.specSchema));
    }

    const [code, genInfo] = generateTSResourceClient(schema, cfg, specSchema, specTypes);
    fs.writeFileSync(path.join(outputDir, resource + ".ts"), code);
    allResources.push(genInfo);
  }

  allResources.sort((a, b) => (a.resource < b.resource ? -1 : a.resource > b.resource ? 1 : 0));

  generateTSClientFile(outputDir, allResources);
  generateTSKindMeta(outputDir);
  process.stderr.write(`sdk-client-ts: generated ${allResources.length} resource clients in ${outputDir}\n`);
}

// =========================================================================
// Per-resource client generation
// =========================================================================

function generateTSResourceClient(
  schema: ServiceSchemaFile,
  cfg: SdkResourceConfig,
  specSchema: TaskConfigSchema | null,
  specTypes: TypeSchema[],
): [string, ResourceGenInfo] {
  const importBase = deriveTSImportBase(schema.package);
  const hasInputType = specSchema !== null;
  const needsSearch = schema.listVia === "SearchService";

  const genInfo: ResourceGenInfo = {
    resource: schema.resource,
    clientName: cfg.clientName,
    inputTypes: [],
    streamTypes: [],
  };

  const imports = new TsImportSet();

  imports.addValue("@connectrpc/connect", "createClient");
  imports.addType("@connectrpc/connect", "Client");
  imports.addType("@connectrpc/connect", "Transport");
  imports.addValue("./errors", "wrapError");

  for (const svc of schema.services) {
    const file = tsServiceImportSuffix(svc);
    imports.addValue(importBase + "/" + file, svc.name);
  }

  if (cfg.idType !== "" && cfg.idType !== "ApiResourceId") {
    imports.addValue(importBase + "/io_pb", cfg.idType + "Schema");
  }

  imports.addValue(importBase + "/api_pb", cfg.protoResType + "Schema");
  imports.addType(importBase + "/api_pb", cfg.protoResType);

  const specTypeNames = new Set<string>();
  const specTypeFileMap = new Map<string, string>();
  for (const t of specTypes) {
    specTypeNames.add(t.name);
    if (t.protoFile !== "") {
      specTypeFileMap.set(t.name, tsProtoFileToSuffix(t.protoFile));
    }
  }

  const methodTypeFileMap = new Map<string, string>();
  for (const mt of schema.methodTypes ?? []) {
    if (mt.protoFile !== "") {
      methodTypeFileMap.set(mt.name, tsProtoFileToSuffix(mt.protoFile));
    }
  }

  let needsApiResourceId = false;
  let needsApiResourceRef = false;
  let needsApiResourceDeleteInput = false;
  let needsEmptySchema = false;
  let needsCreate = false;

  for (const svc of schema.services) {
    for (const m of svc.methods) {
      if (searchListSupersedesMethod(schema, m)) continue;
      if (m.inputType === "ApiResourceId") needsApiResourceId = true;
      if (m.inputType === "ApiResourceReference") needsApiResourceRef = true;
      if (m.inputType === "ApiResourceDeleteInput") needsApiResourceDeleteInput = true;
      if (isEmptyType(m.inputFullType)) {
        needsEmptySchema = true;
        needsCreate = true;
      }
      if (m.serverStreaming === true) {
        genInfo.streamTypes.push(cfg.protoResType + m.name + "Stream");
        if (m.clientStreaming === true) {
          imports.addValue("./bidi-stream", "BidiStream");
        }
      }
      if (isIDType(m.inputType)) {
        needsCreate = true;
        if (
          m.inputType !== cfg.idType &&
          m.inputType !== "ApiResourceId" &&
          m.inputFullType.startsWith(schema.package + ".")
        ) {
          imports.addValue(importBase + "/io_pb", m.inputType + "Schema");
        }
      }

      tsImportMethodType(imports, m.inputType, m.inputFullType, schema, cfg, specTypeNames, specTypeFileMap, methodTypeFileMap, importBase);
      tsImportMethodType(imports, m.outputType, m.outputFullType, schema, cfg, specTypeNames, specTypeFileMap, methodTypeFileMap, importBase);
    }
  }

  if (needsApiResourceId) {
    needsCreate = true;
    imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceIdSchema");
  }
  if (needsApiResourceRef) {
    needsCreate = true;
    imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceReferenceSchema");
  }
  if (needsApiResourceDeleteInput) {
    needsCreate = true;
    imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceDeleteInputSchema");
    imports.addType("./types", "DeleteResourceInput");
  }
  if (needsEmptySchema) {
    imports.addValue("@bufbuild/protobuf/wkt", "EmptySchema");
  }

  if (hasInputType) {
    needsCreate = true;
    imports.addValue(importBase + "/spec_pb", specSchema.name + "Schema");
    imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb", "ApiResourceMetadataSchema");
    imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb", "ApiResourceVisibility");
    imports.addValue("./proto-utils", "stripUndefined");
  }

  if (needsCreate) {
    imports.addValue("@bufbuild/protobuf", "create");
  }

  if (needsSearch) {
    imports.addValue("@stigmer/protos/ai/stigmer/search/v1/query_pb", "SearchService");
    imports.addValue("@stigmer/protos/ai/stigmer/search/v1/io_pb", "SearchRequestSchema");
    imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb", "ApiResourceKind");
    imports.addValue("@stigmer/protos/ai/stigmer/commons/rpc/pagination_pb", "PageInfoSchema");
    imports.addType("./types", "ListParams");
    imports.addType("./types", "ListResult");
  }

  const typeMap = new Map<string, TypeSchema>();
  for (const t of specTypes) {
    typeMap.set(t.name, t);
  }

  if (specSchema !== null) {
    const flags = { needsEnvSpec: false, needsResourceRef: false };
    const visited = new Set<string>();
    for (const f of specSchema.fields) {
      scanFieldForSpecialImports(f, typeMap, flags, visited);
    }
    if (flags.needsEnvSpec) {
      imports.addType("./types", "EnvSpecInput");
    }
    if (flags.needsResourceRef) {
      imports.addType("./types", "ResourceRef");
    }
  }

  const body: string[] = [];

  body.push(`/** Provides operations on ${schema.resource} resources. */\n`);
  body.push(`export class ${cfg.clientName} {\n`);
  for (const svc of schema.services) {
    body.push(`  private readonly ${svc.role}: Client<typeof ${svc.name}>;\n`);
  }
  if (needsSearch) {
    body.push("  private readonly search: Client<typeof SearchService>;\n");
  }
  body.push("\n");

  body.push("  constructor(transport: Transport) {\n");
  for (const svc of schema.services) {
    body.push(`    this.${svc.role} = createClient(${svc.name}, transport);\n`);
  }
  if (needsSearch) {
    body.push("    this.search = createClient(SearchService, transport);\n");
  }
  body.push("  }\n");

  for (const svc of schema.services) {
    for (const m of svc.methods) {
      if (searchListSupersedesMethod(schema, m)) continue;
      body.push("\n");
      generateTSMethod(body, m, svc, schema, cfg, hasInputType, imports);
    }
  }

  if (needsSearch) {
    body.push("\n");
    generateTSSearchList(body, cfg);
  }

  body.push("}\n");

  if (specSchema !== null) {
    body.push("\n");
    genInfo.inputTypes = generateTSInputTypes(body, schema, cfg, specSchema, typeMap, imports);

    body.push("\n");
    generateTSBuildProto(body, schema, cfg, specSchema, typeMap, imports);

    if (tsHasUpdateRPC(schema, cfg)) {
      body.push("\n");
      generateTSUpdateInputMapper(body, schema, cfg, specSchema, typeMap, imports);
    }
  }

  const buf: string[] = [];
  buf.push("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n");
  imports.emit(buf);
  buf.push(...body);

  return [buf.join(""), genInfo];
}

// Import a single method input or output type from its correct source
// module based on type origin.
function tsImportMethodType(
  imports: TsImportSet,
  typeName: string,
  fullType: string,
  schema: ServiceSchemaFile,
  cfg: SdkResourceConfig,
  specTypeNames: Set<string>,
  specTypeFileMap: Map<string, string>,
  methodTypeFileMap: Map<string, string>,
  importBase: string,
): void {
  if (
    typeName === "" ||
    typeName === cfg.protoResType ||
    typeName === "ApiResourceId" ||
    typeName === "ApiResourceReference" ||
    typeName === "ApiResourceDeleteInput" ||
    isIDType(typeName) ||
    isEmptyType(fullType)
  ) {
    return;
  }

  let typePkg = "";
  const idx = fullType.lastIndexOf(".");
  if (idx > 0) {
    typePkg = fullType.slice(0, idx);
  }

  // Cross-package type: import from the type's own package.
  if (typePkg !== schema.package) {
    if (isCommonsType(fullType)) {
      imports.addType(tsResolveCommonsImport(typeName, fullType), typeName);
    } else if (typePkg !== "") {
      const crossBase = deriveTSImportBase(typePkg);
      const file = methodTypeFileMap.get(typeName);
      imports.addType(crossBase + "/" + (file ?? "io_pb"), typeName);
    }
    return;
  }

  // Same-package spec-defined type.
  if (specTypeNames.has(typeName)) {
    const file = specTypeFileMap.get(typeName) ?? "spec_pb";
    imports.addValue(importBase + "/" + file, typeName + "Schema");
    imports.addType(importBase + "/" + file, typeName);
    return;
  }

  // The spec type itself — schema already imported, but the TYPE is needed
  // for method signatures.
  if (typeName === cfg.inputPrefix + "Spec") {
    imports.addType(importBase + "/spec_pb", typeName);
    return;
  }

  const file = methodTypeFileMap.get(typeName);
  if (file !== undefined) {
    imports.addValue(importBase + "/" + file, typeName + "Schema");
    imports.addType(importBase + "/" + file, typeName);
    return;
  }

  imports.addValue(importBase + "/io_pb", typeName + "Schema");
  imports.addType(importBase + "/io_pb", typeName);
}

function scanFieldForSpecialImports(
  f: FieldSchema,
  typeMap: Map<string, TypeSchema>,
  flags: { needsEnvSpec: boolean; needsResourceRef: boolean },
  visited: Set<string>,
): void {
  const t = f.type;
  if (t.kind === "message" && t.messageType === "EnvironmentSpec") {
    flags.needsEnvSpec = true;
  } else if (t.kind === "message" && t.messageType === "ApiResourceReference") {
    flags.needsResourceRef = true;
  } else if (t.kind === "array" && t.elementType?.kind === "message" && t.elementType.messageType === "ApiResourceReference") {
    flags.needsResourceRef = true;
  } else if (t.kind === "message") {
    const msg = t.messageType ?? "";
    if (!visited.has(msg)) {
      visited.add(msg);
      const ts = typeMap.get(msg);
      if (ts !== undefined) {
        for (const sf of ts.fields) {
          scanFieldForSpecialImports(sf, typeMap, flags, visited);
        }
      }
    }
  } else if (t.kind === "array" && t.elementType?.kind === "message") {
    const elemMsg = t.elementType.messageType ?? "";
    if (!visited.has(elemMsg)) {
      visited.add(elemMsg);
      const ts = typeMap.get(elemMsg);
      if (ts !== undefined) {
        for (const sf of ts.fields) {
          scanFieldForSpecialImports(sf, typeMap, flags, visited);
        }
      }
    }
  }
}

// =========================================================================
// Method generation
// =========================================================================

function generateTSMethod(
  buf: string[],
  m: MethodSchema,
  svc: ServiceDefinition,
  schema: ServiceSchemaFile,
  cfg: SdkResourceConfig,
  hasInputType: boolean,
  imports: TsImportSet,
): void {
  if (m.serverStreaming === true) {
    generateTSStreamingMethod(buf, m, svc, schema, cfg, imports);
    return;
  }

  const emptyInput = isEmptyType(m.inputFullType);
  const emptyOutput = isEmptyType(m.outputFullType);
  const isIDInput = isIDType(m.inputType);
  const isDeleteInput = m.inputType === "ApiResourceDeleteInput";
  const isResourceInput = m.inputType === cfg.protoResType;
  const isApiResourceIdInput = m.inputType === "ApiResourceId";
  const isApiResourceRefInput = m.inputType === "ApiResourceReference";

  let outputType = cfg.protoResType;
  if (emptyOutput) {
    outputType = "void";
  } else if (m.outputType !== cfg.protoResType) {
    outputType = m.outputType;
  }

  const returnKeyword = emptyOutput ? "" : "return ";

  if (emptyInput) {
    buf.push(`  async ${tsMethodName(m.name)}(): Promise<${outputType}> {\n`);
    buf.push("    try {\n");
    buf.push(`      ${returnKeyword}await this.${svc.role}.${tsMethodName(m.name)}(create(EmptySchema, {}));\n`);
    buf.push("    } catch (e) { throw wrapError(e); }\n");
    buf.push("  }\n");
  } else if (isResourceInput && hasInputType) {
    const inputTypeName = cfg.inputPrefix + "Input";
    buf.push(`  async ${tsMethodName(m.name)}(input: ${inputTypeName}): Promise<${outputType}> {\n`);
    buf.push("    try {\n");
    buf.push(`      ${returnKeyword}await this.${svc.role}.${tsMethodName(m.name)}(build${cfg.protoResType}Proto(input));\n`);
    buf.push("    } catch (e) { throw wrapError(e); }\n");
    buf.push("  }\n");
  } else if (isResourceInput && !hasInputType) {
    buf.push(`  async ${tsMethodName(m.name)}(input: ${cfg.protoResType}): Promise<${outputType}> {\n`);
    buf.push("    try {\n");
    buf.push(`      ${returnKeyword}await this.${svc.role}.${tsMethodName(m.name)}(input);\n`);
    buf.push("    } catch (e) { throw wrapError(e); }\n");
    buf.push("  }\n");
  } else if (isIDInput) {
    buf.push(`  async ${tsMethodName(m.name)}(id: string): Promise<${outputType}> {\n`);
    buf.push("    try {\n");
    buf.push(`      ${returnKeyword}await this.${svc.role}.${tsMethodName(m.name)}(create(${m.inputType}Schema, { value: id }));\n`);
    buf.push("    } catch (e) { throw wrapError(e); }\n");
    buf.push("  }\n");
  } else if (isApiResourceIdInput) {
    buf.push(`  async ${tsMethodName(m.name)}(id: string): Promise<${outputType}> {\n`);
    buf.push("    try {\n");
    buf.push(`      ${returnKeyword}await this.${svc.role}.${tsMethodName(m.name)}(create(ApiResourceIdSchema, { value: id }));\n`);
    buf.push("    } catch (e) { throw wrapError(e); }\n");
    buf.push("  }\n");
  } else if (isApiResourceRefInput) {
    imports.addType("./types", "ResourceRef");
    imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb", "ApiResourceKind");
    buf.push(`  async ${tsMethodName(m.name)}(ref: ResourceRef): Promise<${outputType}> {\n`);
    buf.push("    try {\n");
    buf.push(`      ${returnKeyword}await this.${svc.role}.${tsMethodName(m.name)}(create(ApiResourceReferenceSchema, { ...ref, kind: ApiResourceKind.${cfg.resourceKind} }));\n`);
    buf.push("    } catch (e) { throw wrapError(e); }\n");
    buf.push("  }\n");
  } else if (isDeleteInput) {
    buf.push(`  async ${tsMethodName(m.name)}(input: DeleteResourceInput): Promise<${outputType}> {\n`);
    buf.push("    try {\n");
    buf.push(`      ${returnKeyword}await this.${svc.role}.${tsMethodName(m.name)}(create(ApiResourceDeleteInputSchema, {\n`);
    buf.push("        resourceId: input.resourceId,\n");
    buf.push("        versionMessage: input.versionMessage,\n");
    buf.push("        force: input.force,\n");
    buf.push("      }));\n");
    buf.push("    } catch (e) { throw wrapError(e); }\n");
    buf.push("  }\n");
  } else {
    buf.push(`  async ${tsMethodName(m.name)}(input: ${m.inputType}): Promise<${outputType}> {\n`);
    buf.push("    try {\n");
    buf.push(`      ${returnKeyword}await this.${svc.role}.${tsMethodName(m.name)}(input);\n`);
    buf.push("    } catch (e) { throw wrapError(e); }\n");
    buf.push("  }\n");
  }
}

function generateTSStreamingMethod(
  buf: string[],
  m: MethodSchema,
  svc: ServiceDefinition,
  schema: ServiceSchemaFile,
  cfg: SdkResourceConfig,
  imports: TsImportSet,
): void {
  const isIDInput = isIDType(m.inputType);
  const outputType = m.outputType;
  if (outputType !== cfg.protoResType && m.clientStreaming !== true) {
    const importBase = deriveTSImportBase(schema.package);
    let suffix = "api_pb";
    for (const mt of schema.methodTypes ?? []) {
      if (mt.name === outputType && mt.protoFile !== "") {
        suffix = tsProtoFileToSuffix(mt.protoFile);
        break;
      }
    }
    imports.addType(importBase + "/" + suffix, outputType);
    imports.addValue(importBase + "/" + suffix, outputType + "Schema");
  }

  if (m.clientStreaming === true) {
    const importBase = deriveTSImportBase(schema.package);
    imports.addType(importBase + "/io_pb", m.inputType);
    imports.addType(importBase + "/io_pb", m.outputType);
    buf.push(`  ${tsMethodName(m.name)}(signal?: AbortSignal): BidiStream<${m.inputType}, ${outputType}> {\n`);
    buf.push(`    return new BidiStream((reqs) => this.${svc.role}.${tsMethodName(m.name)}(reqs, { signal }));\n`);
    buf.push("  }\n");
  } else if (isIDInput) {
    buf.push(`  async *${tsMethodName(m.name)}(id: string, signal?: AbortSignal): AsyncGenerator<${outputType}> {\n`);
    buf.push("    try {\n");
    buf.push(`      for await (const msg of this.${svc.role}.${tsMethodName(m.name)}(create(${m.inputType}Schema, { value: id }), { signal })) {\n`);
    buf.push("        yield msg;\n");
    buf.push("      }\n");
    buf.push("    } catch (e) { throw wrapError(e); }\n");
    buf.push("  }\n");
  } else {
    const importBase = deriveTSImportBase(schema.package);
    imports.addType(importBase + "/io_pb", m.inputType);
    buf.push(`  async *${tsMethodName(m.name)}(input: ${m.inputType}, signal?: AbortSignal): AsyncGenerator<${outputType}> {\n`);
    buf.push("    try {\n");
    buf.push(`      for await (const msg of this.${svc.role}.${tsMethodName(m.name)}(input, { signal })) {\n`);
    buf.push("        yield msg;\n");
    buf.push("      }\n");
    buf.push("    } catch (e) { throw wrapError(e); }\n");
    buf.push("  }\n");
  }
}

function generateTSSearchList(buf: string[], cfg: SdkResourceConfig): void {
  buf.push("  async list(params: ListParams): Promise<ListResult> {\n");
  buf.push("    try {\n");
  buf.push("      const resp = await this.search.search(create(SearchRequestSchema, {\n");
  buf.push(`        kinds: [ApiResourceKind.${cfg.resourceKind}],\n`);
  buf.push("        query: params.query,\n");
  buf.push("        org: params.org,\n");
  buf.push("        excludePublic: params.excludePublic ?? false,\n");
  buf.push("        crossOrgPublic: params.crossOrgPublic ?? false,\n");
  buf.push("        page: params.page ? create(PageInfoSchema, params.page) : undefined,\n");
  buf.push("      }));\n");
  buf.push("      return {\n");
  buf.push("        entries: resp.entries,\n");
  buf.push("        totalCount: resp.totalCount,\n");
  buf.push("        totalPages: resp.totalPages,\n");
  buf.push("      };\n");
  buf.push("    } catch (e) { throw wrapError(e); }\n");
  buf.push("  }\n");
}

// =========================================================================
// Input type generation
// =========================================================================

function generateTSInputTypes(
  buf: string[],
  schema: ServiceSchemaFile,
  cfg: SdkResourceConfig,
  spec: TaskConfigSchema,
  typeMap: Map<string, TypeSchema>,
  imports: TsImportSet,
): string[] {
  const inputName = cfg.inputPrefix + "Input";
  const emitted = new Set<string>();
  const allTypes: string[] = [];

  const specFields = spec.fields.filter((f) => !META_FIELD_NAMES.has(f.name));

  buf.push(`/** Input for creating/updating a ${cfg.protoResType}. */\n`);
  buf.push(`export interface ${inputName} {\n`);
  buf.push("  /**\n");
  buf.push("   * The resource's `metadata.id`, for exact update addressing when set\n");
  buf.push("   * from a loaded resource. Required for updates to platform-scoped\n");
  buf.push("   * (org-less) kinds, where the org+slug fallback cannot match. On\n");
  buf.push("   * create, the cloud server stamps its own id regardless; the OSS\n");
  buf.push("   * server honors a caller-supplied id (existing apply semantics).\n");
  buf.push("   */\n");
  buf.push("  id?: string;\n");
  buf.push("  name: string;\n");
  buf.push("  slug?: string;\n");
  buf.push("  org: string;\n");
  buf.push("  labels?: Record<string, string>;\n");
  buf.push("  visibility?: ApiResourceVisibility;\n");
  if (cfg.isVersioned) {
    buf.push("  versionMessage?: string;\n");
  }
  for (const f of specFields) {
    const tsType = tsTypeForTypeSpec(f.type, imports);
    const optional = f.required ? "" : "?";
    buf.push(`  ${tsProtoFieldName(f.protoField)}${optional}: ${tsType};\n`);
  }
  buf.push("}\n");
  allTypes.push(inputName);

  for (const f of specFields) {
    emitTSNestedTypes(buf, f, typeMap, emitted, allTypes, imports);
  }

  return allTypes;
}

function emitTSNestedTypes(
  buf: string[],
  f: FieldSchema,
  typeMap: Map<string, TypeSchema>,
  emitted: Set<string>,
  allTypes: string[],
  imports: TsImportSet,
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

  const inputName = msgName + "Input";
  buf.push(`\n/** SDK input type for ${msgName}. */\n`);
  buf.push(`export interface ${inputName} {\n`);
  for (const field of ts.fields) {
    const tsType = tsTypeForTypeSpec(field.type, imports);
    const optional = field.required ? "" : "?";
    buf.push(`  ${tsProtoFieldName(field.protoField)}${optional}: ${tsType};\n`);
  }
  buf.push("}\n");
  allTypes.push(inputName);

  for (const field of ts.fields) {
    emitTSNestedTypes(buf, field, typeMap, emitted, allTypes, imports);
  }
}

function tsTypeForTypeSpec(ts: TypeSpec, imports: TsImportSet): string {
  switch (ts.kind) {
    case "string":
      if (ts.enumType !== undefined && ts.enumType !== "") {
        const [importFrom, enumName] = tsResolveEnumImport(ts.enumType);
        imports.addValue(importFrom, enumName);
        return enumName;
      }
      return "string";
    case "int32":
    case "uint32":
    case "float":
    case "double":
      return "number";
    case "int64":
      return "bigint";
    case "bool":
      return "boolean";
    case "bytes":
      return "Uint8Array";
    case "timestamp":
      return "Date | string";
    case "struct":
      imports.addType("@bufbuild/protobuf", "JsonObject");
      return "JsonObject";
    case "value":
      imports.addType("@bufbuild/protobuf", "JsonValue");
      return "JsonValue";
    case "array":
      if (ts.elementType !== undefined) {
        return tsTypeForTypeSpec(ts.elementType, imports) + "[]";
      }
      return "string[]";
    case "map": {
      const keyType = ts.keyType !== undefined ? tsTypeForTypeSpec(ts.keyType, imports) : "string";
      const valType = ts.valueType !== undefined ? tsTypeForTypeSpec(ts.valueType, imports) : "string";
      return `Record<${keyType}, ${valType}>`;
    }
    case "message":
      switch (ts.messageType) {
        case "EnvironmentSpec":
          imports.addType("./types", "EnvSpecInput");
          return "EnvSpecInput";
        case "EnvironmentValue":
        case "ExecutionValue":
          imports.addType("./types", "EnvVarInput");
          return "EnvVarInput";
        case "ApiResourceReference":
          imports.addType("./types", "ResourceRef");
          return "ResourceRef";
        default:
          return (ts.messageType ?? "") + "Input";
      }
    default:
      return "string";
  }
}

// =========================================================================
// Proto builder generation
// =========================================================================

export function tsFieldNeedsConversion(f: FieldSchema): boolean {
  const t = f.type;
  if (t.kind === "timestamp") return true;
  if (t.kind === "value") return true;
  if (t.kind === "message") return true;
  if (t.kind === "array" && t.elementType?.kind === "message") return true;
  if (t.kind === "map" && t.valueType?.kind === "message") return true;
  return false;
}

function tsTypeHasOneof(ts: TypeSchema): boolean {
  return ts.fields.some((f) => f.oneofGroup !== undefined && f.oneofGroup !== "" && !isSyntheticOneof(f.oneofGroup));
}

function tsTypeHasNestedMessages(ts: TypeSchema): boolean {
  return ts.fields.some(tsFieldNeedsConversion);
}

// Adds the XxxSchema import for a TypeSchema, deriving the base from the
// type's own package for cross-package references.
export function tsAddSchemaImport(ts: TypeSchema, imports: TsImportSet, importBase: string): void {
  const schemaName = ts.name + "Schema";
  if (ts.protoFile !== "") {
    let effectiveBase = importBase;
    if (ts.protoType !== "") {
      const parts = ts.protoType.split(".");
      if (parts.length > 1) {
        effectiveBase = deriveTSImportBase(parts.slice(0, -1).join("."));
      }
    }
    imports.addValue(effectiveBase + "/" + tsProtoFileToSuffix(ts.protoFile), schemaName);
  } else {
    imports.addValue(importBase + "/spec_pb", schemaName);
  }
}

function generateTSBuildProto(
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

  // Nested builder functions first.
  const emitted = new Set<string>();
  for (const f of specFields) {
    emitTSNestedBuilders(buf, f, typeMap, emitted, imports, importBase);
  }

  // Separate spec fields into regular fields and oneof groups.
  const specOneofGroups = new Map<string, FieldSchema[]>();
  const specOneofOrder: string[] = [];
  const regularSpecFields: FieldSchema[] = [];
  for (const f of specFields) {
    if (f.oneofGroup !== undefined && f.oneofGroup !== "" && !isSyntheticOneof(f.oneofGroup)) {
      if (!specOneofGroups.has(f.oneofGroup)) {
        specOneofOrder.push(f.oneofGroup);
        specOneofGroups.set(f.oneofGroup, []);
      }
      specOneofGroups.get(f.oneofGroup)!.push(f);
    } else {
      regularSpecFields.push(f);
    }
  }

  const hasSpecOneofs = specOneofGroups.size > 0;

  const preComputed = regularSpecFields.filter(tsFieldNeedsConversion);

  // Exported so the package-internal synth layer can construct full protos
  // from the ergonomic *Input without duplicating the field mapping.
  buf.push(`export function build${cfg.protoResType}Proto(input: ${inputName}): ${cfg.protoResType} {\n`);

  for (const f of preComputed) {
    emitTSPreComputeField(buf, f, imports);
  }

  if (hasSpecOneofs) {
    // Build spec separately so oneofs can be assigned imperatively.
    buf.push(`  const spec = Object.assign(create(${spec.name}Schema), stripUndefined({\n`);
    for (const f of regularSpecFields) {
      const fieldName = tsProtoFieldName(f.protoField);
      if (tsFieldNeedsConversion(f)) {
        buf.push(`    ${fieldName},\n`);
      } else {
        buf.push(`    ${fieldName}: input.${fieldName},\n`);
      }
    }
    buf.push("  }));\n");

    for (const oneofName of specOneofOrder) {
      const fields = specOneofGroups.get(oneofName)!;
      const oneofTSName = tsProtoFieldName(oneofName);
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const fieldName = tsProtoFieldName(field.protoField);
        const prefix = i > 0 ? "} else if" : "if";
        buf.push(`  ${prefix} (input.${fieldName}) {\n`);

        const childType = field.type.messageType ?? "";
        if (childType !== "" && !isSpecialType(childType)) {
          if (typeMap.has(childType)) {
            buf.push(`    spec.${oneofTSName} = { case: ${goQuote(fieldName)}, value: build${childType}Proto(input.${fieldName}) };\n`);
          } else {
            buf.push(`    spec.${oneofTSName} = { case: ${goQuote(fieldName)}, value: input.${fieldName} };\n`);
          }
        } else if (childType === "ApiResourceReference") {
          imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceReferenceSchema");
          buf.push(`    spec.${oneofTSName} = { case: ${goQuote(fieldName)}, value: create(ApiResourceReferenceSchema, input.${fieldName}) };\n`);
        } else {
          buf.push(`    spec.${oneofTSName} = { case: ${goQuote(fieldName)}, value: input.${fieldName} };\n`);
        }
      }
      buf.push("  }\n");
    }

    buf.push(`  return Object.assign(create(${cfg.protoResType}Schema), {\n`);
    buf.push(`    apiVersion: ${goQuote(cfg.apiVersion)},\n`);
    buf.push(`    kind: ${goQuote(cfg.protoResType)},\n`);
    buf.push("    metadata: Object.assign(create(ApiResourceMetadataSchema), {\n");
    buf.push("      ...(input.id && { id: input.id }),\n");
    buf.push("      name: input.name,\n");
    buf.push("      org: input.org,\n");
    buf.push("      ...(input.slug && { slug: input.slug }),\n");
    buf.push("      ...(input.labels && { labels: input.labels }),\n");
    buf.push("      ...(input.visibility && { visibility: input.visibility }),\n");
    if (cfg.isVersioned) {
      imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb", "ApiResourceMetadataVersionSchema");
      buf.push("      ...(input.versionMessage && { version: Object.assign(create(ApiResourceMetadataVersionSchema), { message: input.versionMessage }) }),\n");
    }
    buf.push("    }),\n");
    buf.push("    spec,\n");
    buf.push(`  }) as ${cfg.protoResType};\n`);
  } else {
    buf.push(`  return Object.assign(create(${cfg.protoResType}Schema), {\n`);
    buf.push(`    apiVersion: ${goQuote(cfg.apiVersion)},\n`);
    buf.push(`    kind: ${goQuote(cfg.protoResType)},\n`);
    buf.push("    metadata: Object.assign(create(ApiResourceMetadataSchema), {\n");
    buf.push("      ...(input.id && { id: input.id }),\n");
    buf.push("      name: input.name,\n");
    buf.push("      org: input.org,\n");
    buf.push("      ...(input.slug && { slug: input.slug }),\n");
    buf.push("      ...(input.labels && { labels: input.labels }),\n");
    buf.push("      ...(input.visibility && { visibility: input.visibility }),\n");
    if (cfg.isVersioned) {
      imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb", "ApiResourceMetadataVersionSchema");
      buf.push("      ...(input.versionMessage && { version: Object.assign(create(ApiResourceMetadataVersionSchema), { message: input.versionMessage }) }),\n");
    }
    buf.push("    }),\n");
    buf.push(`    spec: Object.assign(create(${spec.name}Schema), stripUndefined({\n`);

    for (const f of regularSpecFields) {
      const fieldName = tsProtoFieldName(f.protoField);
      if (tsFieldNeedsConversion(f)) {
        buf.push(`      ${fieldName},\n`);
      } else {
        buf.push(`      ${fieldName}: input.${fieldName},\n`);
      }
    }

    buf.push("    })),\n");
    buf.push(`  }) as ${cfg.protoResType};\n`);
  }
  buf.push("}\n");
}

// Emits a variable declaration converting an input field to proto message
// instance(s) before the main return statement.
function emitTSPreComputeField(buf: string[], f: FieldSchema, imports: TsImportSet): void {
  const fieldName = tsProtoFieldName(f.protoField);
  const t = f.type;
  const refKind = f.referenceKind ?? 0;

  if (t.kind === "timestamp") {
    imports.addValue("./proto-utils", "toTimestamp");
    buf.push(`  const ${fieldName} = input.${fieldName} !== undefined ? toTimestamp(input.${fieldName}) : undefined;\n`);
  } else if (t.kind === "value") {
    imports.addValue("@bufbuild/protobuf", "fromJson");
    imports.addValue("@bufbuild/protobuf/wkt", "ValueSchema");
    buf.push(`  const ${fieldName} = input.${fieldName} !== undefined ? fromJson(ValueSchema, input.${fieldName}) : undefined;\n`);
  } else if (t.kind === "message" && t.messageType === "EnvironmentSpec") {
    imports.addValue("@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb", "EnvironmentSpecSchema");
    imports.addValue("@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb", "EnvironmentValueSchema");
    buf.push(`  let ${fieldName};\n`);
    buf.push(`  if (input.${fieldName}) {\n`);
    buf.push("    const es = create(EnvironmentSpecSchema);\n");
    buf.push(`    for (const [k, v] of Object.entries(input.${fieldName}.variables)) {\n`);
    buf.push("      es.data[k] = create(EnvironmentValueSchema, { value: v.value, isSecret: v.isSecret, description: v.description });\n");
    buf.push("    }\n");
    buf.push(`    ${fieldName} = es;\n`);
    buf.push("  }\n");
  } else if (t.kind === "message" && t.messageType === "ApiResourceReference") {
    imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceReferenceSchema");
    if (refKind !== 0) {
      buf.push(`  const ${fieldName} = (input.${fieldName}?.slug || input.${fieldName}?.org) ? create(ApiResourceReferenceSchema, { ...input.${fieldName}, kind: ${refKind} }) : undefined;\n`);
    } else {
      buf.push(`  const ${fieldName} = (input.${fieldName}?.slug || input.${fieldName}?.org) ? create(ApiResourceReferenceSchema, input.${fieldName}) : undefined;\n`);
    }
  } else if (t.kind === "message") {
    buf.push(`  const ${fieldName} = input.${fieldName} ? build${t.messageType}Proto(input.${fieldName}) : undefined;\n`);
  } else if (t.kind === "array" && t.elementType?.kind === "message" && t.elementType.messageType === "ApiResourceReference") {
    imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceReferenceSchema");
    if (refKind !== 0) {
      buf.push(`  const ${fieldName} = input.${fieldName}?.map(r => create(ApiResourceReferenceSchema, { ...r, kind: ${refKind} }));\n`);
    } else {
      buf.push(`  const ${fieldName} = input.${fieldName}?.map(r => create(ApiResourceReferenceSchema, r));\n`);
    }
  } else if (t.kind === "array" && t.elementType?.kind === "message") {
    buf.push(`  const ${fieldName} = input.${fieldName}?.map(build${t.elementType.messageType}Proto);\n`);
  } else if (t.kind === "map" && t.valueType?.messageType === "EnvironmentValue") {
    imports.addValue("@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb", "EnvironmentValueSchema");
    buf.push(`  let ${fieldName};\n`);
    buf.push(`  if (input.${fieldName}) {\n`);
    buf.push(`    ${fieldName} = Object.fromEntries(Object.entries(input.${fieldName}).map(([k, v]) =>\n`);
    buf.push("      [k, create(EnvironmentValueSchema, { value: v.value, isSecret: v.isSecret, description: v.description })]));\n");
    buf.push("  }\n");
  } else if (t.kind === "map" && t.valueType?.messageType === "ExecutionValue") {
    imports.addValue("@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb", "ExecutionValueSchema");
    buf.push(`  let ${fieldName};\n`);
    buf.push(`  if (input.${fieldName}) {\n`);
    buf.push(`    ${fieldName} = Object.fromEntries(Object.entries(input.${fieldName}).map(([k, v]) =>\n`);
    buf.push("      [k, create(ExecutionValueSchema, { value: v.value, isSecret: v.isSecret })]));\n");
    buf.push("  }\n");
  } else if (t.kind === "map" && t.valueType?.kind === "message") {
    buf.push(`  let ${fieldName};\n`);
    buf.push(`  if (input.${fieldName}) {\n`);
    buf.push(`    ${fieldName} = Object.fromEntries(Object.entries(input.${fieldName}).map(([k, v]) => [k, build${t.valueType.messageType}Proto(v)]));\n`);
    buf.push("  }\n");
  }
}

// Recursively generates buildXxxProto helpers for each non-special nested
// message type referenced by a field.
function emitTSNestedBuilders(
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

  // Sub-types first so their builders are emitted before this one.
  for (const field of ts.fields) {
    emitTSNestedBuilders(buf, field, typeMap, emitted, imports, importBase);
  }

  tsAddSchemaImport(ts, imports, importBase);

  const hasOneof = tsTypeHasOneof(ts);
  const hasNested = tsTypeHasNestedMessages(ts);
  const inputName = msgName + "Input";
  const builderName = "build" + msgName + "Proto";

  if (!hasOneof && !hasNested) {
    // All-scalar type: Object.assign + stripUndefined pattern.
    buf.push(`function ${builderName}(input: ${inputName}) {\n`);
    buf.push(`  return Object.assign(create(${msgName}Schema), stripUndefined({\n`);
    for (const field of ts.fields) {
      const fn = tsProtoFieldName(field.protoField);
      if (field.type.kind === "value") {
        imports.addValue("@bufbuild/protobuf", "fromJson");
        imports.addValue("@bufbuild/protobuf/wkt", "ValueSchema");
        buf.push(`    ${fn}: input.${fn} !== undefined ? fromJson(ValueSchema, input.${fn}) : undefined,\n`);
      } else {
        buf.push(`    ${fn}: input.${fn},\n`);
      }
    }
    buf.push("  }));\n");
    buf.push("}\n\n");
    return;
  }

  // Complex type: imperative construction.
  buf.push(`function ${builderName}(input: ${inputName}) {\n`);
  buf.push(`  const msg = create(${msgName}Schema);\n`);

  const oneofGroups = new Map<string, FieldSchema[]>();
  const oneofOrder: string[] = [];
  const regularFields: FieldSchema[] = [];
  for (const field of ts.fields) {
    if (field.oneofGroup !== undefined && field.oneofGroup !== "" && !isSyntheticOneof(field.oneofGroup)) {
      if (!oneofGroups.has(field.oneofGroup)) {
        oneofOrder.push(field.oneofGroup);
        oneofGroups.set(field.oneofGroup, []);
      }
      oneofGroups.get(field.oneofGroup)!.push(field);
    } else {
      regularFields.push(field);
    }
  }

  for (const field of regularFields) {
    emitTSNestedFieldAssign(buf, field, typeMap, imports);
  }

  for (const oneofName of oneofOrder) {
    const fields = oneofGroups.get(oneofName)!;
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const fieldName = tsProtoFieldName(field.protoField);
      const prefix = i > 0 ? "} else if" : "if";
      buf.push(`  ${prefix} (input.${fieldName}) {\n`);

      const childType = field.type.messageType ?? "";
      if (typeMap.has(childType) && !isSpecialType(childType)) {
        buf.push(`    msg.${oneofName} = { case: ${goQuote(fieldName)}, value: build${childType}Proto(input.${fieldName}) };\n`);
      } else if (isSpecialType(childType) && childType === "ApiResourceReference") {
        imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceReferenceSchema");
        buf.push(`    msg.${oneofName} = { case: ${goQuote(fieldName)}, value: create(ApiResourceReferenceSchema, input.${fieldName}) };\n`);
      } else {
        buf.push(`    msg.${oneofName} = { case: ${goQuote(fieldName)}, value: input.${fieldName} };\n`);
      }
    }
    buf.push("  }\n");
  }

  buf.push("  return msg;\n");
  buf.push("}\n\n");
}

function emitTSNestedFieldAssign(buf: string[], f: FieldSchema, typeMap: Map<string, TypeSchema>, imports: TsImportSet): void {
  const fieldName = tsProtoFieldName(f.protoField);
  const t = f.type;
  const refKind = f.referenceKind ?? 0;

  if (t.kind === "timestamp") {
    imports.addValue("./proto-utils", "toTimestamp");
    buf.push(`  if (input.${fieldName} !== undefined) msg.${fieldName} = toTimestamp(input.${fieldName});\n`);
  } else if (t.kind === "value") {
    imports.addValue("@bufbuild/protobuf", "fromJson");
    imports.addValue("@bufbuild/protobuf/wkt", "ValueSchema");
    buf.push(`  if (input.${fieldName} !== undefined) msg.${fieldName} = fromJson(ValueSchema, input.${fieldName});\n`);
  } else if (
    t.kind === "string" || t.kind === "bool" || t.kind === "int32" ||
    t.kind === "int64" || t.kind === "uint32" || t.kind === "float" ||
    t.kind === "double" || t.kind === "bytes" || t.kind === "struct"
  ) {
    buf.push(`  if (input.${fieldName} !== undefined) msg.${fieldName} = input.${fieldName};\n`);
  } else if (t.kind === "array" && (t.elementType === undefined || t.elementType.kind !== "message")) {
    buf.push(`  if (input.${fieldName}) msg.${fieldName} = input.${fieldName};\n`);
  } else if (t.kind === "array" && t.elementType?.kind === "message" && t.elementType.messageType === "ApiResourceReference") {
    imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceReferenceSchema");
    if (refKind !== 0) {
      buf.push(`  if (input.${fieldName}) msg.${fieldName} = input.${fieldName}.map(r => create(ApiResourceReferenceSchema, { ...r, kind: ${refKind} }));\n`);
    } else {
      buf.push(`  if (input.${fieldName}) msg.${fieldName} = input.${fieldName}.map(r => create(ApiResourceReferenceSchema, r));\n`);
    }
  } else if (t.kind === "array" && t.elementType?.kind === "message") {
    const elemMsg = t.elementType.messageType ?? "";
    if (!isSpecialType(elemMsg)) {
      buf.push(`  if (input.${fieldName}) msg.${fieldName} = input.${fieldName}.map(build${elemMsg}Proto);\n`);
    }
  } else if (t.kind === "message" && t.messageType === "EnvironmentSpec") {
    imports.addValue("@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb", "EnvironmentSpecSchema");
    imports.addValue("@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb", "EnvironmentValueSchema");
    buf.push(`  if (input.${fieldName}) {\n`);
    buf.push("    const es = create(EnvironmentSpecSchema);\n");
    buf.push(`    for (const [k, v] of Object.entries(input.${fieldName}.variables)) {\n`);
    buf.push("      es.data[k] = create(EnvironmentValueSchema, { value: v.value, isSecret: v.isSecret, description: v.description });\n");
    buf.push("    }\n");
    buf.push(`    msg.${fieldName} = es;\n`);
    buf.push("  }\n");
  } else if (t.kind === "message" && t.messageType === "ApiResourceReference") {
    imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceReferenceSchema");
    if (refKind !== 0) {
      buf.push(`  if (input.${fieldName}?.slug || input.${fieldName}?.org) msg.${fieldName} = create(ApiResourceReferenceSchema, { ...input.${fieldName}, kind: ${refKind} });\n`);
    } else {
      buf.push(`  if (input.${fieldName}?.slug || input.${fieldName}?.org) msg.${fieldName} = create(ApiResourceReferenceSchema, input.${fieldName});\n`);
    }
  } else if (t.kind === "message") {
    const msgType = t.messageType ?? "";
    if (!isSpecialType(msgType)) {
      buf.push(`  if (input.${fieldName}) msg.${fieldName} = build${msgType}Proto(input.${fieldName});\n`);
    }
  } else if (t.kind === "map" && (t.valueType === undefined || t.valueType.kind === "string")) {
    buf.push(`  if (input.${fieldName}) Object.assign(msg.${fieldName}, input.${fieldName});\n`);
  } else if (t.kind === "map" && t.valueType?.messageType === "EnvironmentValue") {
    imports.addValue("@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb", "EnvironmentValueSchema");
    buf.push(`  if (input.${fieldName}) {\n`);
    buf.push(`    for (const [k, v] of Object.entries(input.${fieldName})) {\n`);
    buf.push(`      msg.${fieldName}[k] = create(EnvironmentValueSchema, { value: v.value, isSecret: v.isSecret, description: v.description });\n`);
    buf.push("    }\n");
    buf.push("  }\n");
  } else if (t.kind === "map" && t.valueType?.messageType === "ExecutionValue") {
    imports.addValue("@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb", "ExecutionValueSchema");
    buf.push(`  if (input.${fieldName}) {\n`);
    buf.push(`    for (const [k, v] of Object.entries(input.${fieldName})) {\n`);
    buf.push(`      msg.${fieldName}[k] = create(ExecutionValueSchema, { value: v.value, isSecret: v.isSecret });\n`);
    buf.push("    }\n");
    buf.push("  }\n");
  } else if (t.kind === "map" && t.valueType?.kind === "message") {
    const elemMsg = t.valueType.messageType ?? "";
    if (!isSpecialType(elemMsg)) {
      buf.push(`  if (input.${fieldName}) {\n`);
      buf.push(`    for (const [k, v] of Object.entries(input.${fieldName})) {\n`);
      buf.push(`      msg.${fieldName}[k] = build${elemMsg}Proto(v);\n`);
      buf.push("    }\n");
      buf.push("  }\n");
    }
  }
}

// =========================================================================
// Generated client.ts
// =========================================================================

function generateTSClientFile(outputDir: string, resources: ResourceGenInfo[]): void {
  const buf: string[] = [];
  buf.push("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n");
  buf.push('import type { Transport } from "@connectrpc/connect";\n');

  for (const r of resources) {
    buf.push(`import { ${r.clientName} } from ${goQuote("./" + r.resource + ".js")};\n`);
  }
  buf.push("\n");

  buf.push("/** Aggregate client with all resource-specific sub-clients. */\n");
  buf.push("export class GeneratedClient {\n");
  for (const r of resources) {
    buf.push(`  readonly ${tsClientFieldName(r.resource)}: ${r.clientName};\n`);
  }
  buf.push("\n");

  buf.push("  constructor(transport: Transport) {\n");
  for (const r of resources) {
    buf.push(`    this.${tsClientFieldName(r.resource)} = new ${r.clientName}(transport);\n`);
  }
  buf.push("  }\n");
  buf.push("}\n");

  // Re-export: classes as values, input types as types (deduplicated).
  buf.push("\n// Re-export all resource client types and input types.\n");
  const exportedTypes = new Set<string>();
  for (const r of resources) {
    buf.push(`export { ${r.clientName} } from ${goQuote("./" + r.resource + ".js")};\n`);
    if (r.inputTypes.length > 0) {
      const typeExports: string[] = [];
      for (const t of r.inputTypes) {
        if (exportedTypes.has(t)) continue;
        exportedTypes.add(t);
        typeExports.push("type " + t);
      }
      if (typeExports.length > 0) {
        buf.push(`export { ${typeExports.join(", ")} } from ${goQuote("./" + r.resource + ".js")};\n`);
      }
    }
  }
  buf.push('export { type ListParams, type ListResult, type DeleteResourceInput, type ResourceRef, type EnvSpecInput, type EnvVarInput, type Page } from "./types.js";\n');
  buf.push('export { StigmerError, type ErrorCode, isNotFound, isUnauthenticated, isPermissionDenied, isRetryable, isUnimplemented } from "./errors.js";\n');

  fs.writeFileSync(path.join(outputDir, "client.ts"), buf.join(""));
}
