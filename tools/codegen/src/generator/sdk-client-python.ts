// sdk-client-python target: typed resource clients for the Python SDK
// (sdk/python/src/stigmer/_gen). Byte-parity port of sdk_client_python.go —
// per resource: the client class over the gRPC stubs, the @dataclass input
// types with self-contained _to_proto methods, plus the static modules
// (_errors, _types, _bidi), the aggregate _client.py, and __init__.py.

import * as fs from "node:fs";
import * as path from "node:path";

import type { MethodSchema, ServiceDefinition, ServiceSchemaFile } from "./gen-common.js";
import { goQuote, isEmptyType, isIDType, isSpecialType, searchListSupersedesMethod } from "./gen-common.js";
import { isPythonKeyword, pyClientFieldName, pyFieldName, pyMethodName, pyProtoFileToModule, pyProtoImportLine, pyProtoModuleAlias, pyStubMethodName } from "./lang-names.js";
import type { ResourceGenInfo, SdkResourceConfig } from "./sdk-resource-config.js";
import { deriveResourceConfig, loadSpecSchemaWithTypes, META_FIELD_NAMES } from "./sdk-resource-config.js";
import type { FieldSchema, TaskConfigSchema, TypeSchema, TypeSpec } from "./schema.js";
import { readDirSorted } from "./schema.js";

function pyServiceModule(svc: ServiceDefinition): string {
  if (svc.protoFile !== undefined && svc.protoFile !== "") {
    const base = svc.protoFile.slice(svc.protoFile.lastIndexOf("/") + 1);
    return base.endsWith(".proto") ? base.slice(0, -".proto".length) : base;
  }
  return svc.role;
}

function pyMethodTypePb2Prefix(typeName: string, methodTypePb2Map: Map<string, string>): string {
  return methodTypePb2Map.get(typeName) ?? "io_pb2";
}

function pyTrackMethodTypeImport(
  typeName: string,
  fullType: string,
  cfg: SdkResourceConfig,
  schema: ServiceSchemaFile,
  methodTypePb2Map: Map<string, string>,
  imports: PyImports,
): void {
  if (
    typeName === cfg.protoResType ||
    isEmptyType(fullType) ||
    isIDType(typeName) ||
    typeName === "ApiResourceId" ||
    typeName === "ApiResourceReference" ||
    typeName === "ApiResourceDeleteInput"
  ) {
    return;
  }
  if (!fullType.startsWith(schema.package + ".")) return;
  const mod = pyMethodTypePb2Prefix(typeName, methodTypePb2Map);
  if (mod === "io_pb2") {
    imports.needsIoPb2 = true;
  } else {
    imports.extraPb2Modules.add(mod);
  }
  // Sub-package types: more than just the type name after the package prefix.
  const suffix = fullType.slice(schema.package.length + 1);
  const dotIdx = suffix.lastIndexOf(".");
  if (dotIdx > 0) {
    const subPkg = fullType.slice(0, schema.package.length + 1 + dotIdx);
    imports.subPkgPb2Imports.set(mod, subPkg.replaceAll("/", "."));
  }
}

function pyTypeForTypeSpec(ts: TypeSpec): string {
  switch (ts.kind) {
    case "string":
      if (ts.enumType !== undefined && ts.enumType !== "") return "int";
      return "str";
    case "int32":
    case "uint32":
    case "int64":
      return "int";
    case "bool":
      return "bool";
    case "float":
    case "double":
      return "float";
    case "bytes":
      return "bytes";
    case "timestamp":
      return "str";
    case "struct":
      return "dict[str, Any]";
    case "value":
      return "Any";
    case "array":
      if (ts.elementType !== undefined) {
        return "list[" + pyTypeForTypeSpec(ts.elementType) + "]";
      }
      return "list[str]";
    case "map": {
      const kt = ts.keyType !== undefined ? pyTypeForTypeSpec(ts.keyType) : "str";
      const vt = ts.valueType !== undefined ? pyTypeForTypeSpec(ts.valueType) : "str";
      return "dict[" + kt + ", " + vt + "]";
    }
    case "message":
      switch (ts.messageType) {
        case "EnvironmentSpec":
          return "EnvSpecInput";
        case "EnvironmentValue":
        case "ExecutionValue":
          return "EnvVarInput";
        case "ApiResourceReference":
          return "ResourceRef";
        default:
          return (ts.messageType ?? "") + "Input";
      }
    default:
      return "str";
  }
}

function pyDefaultForField(f: FieldSchema): string {
  if (f.required) return "";
  return pyDefaultForTypeSpec(f.type);
}

function pyDefaultForTypeSpec(ts: TypeSpec): string {
  switch (ts.kind) {
    case "string":
      if (ts.enumType !== undefined && ts.enumType !== "") return "0";
      return '""';
    case "timestamp":
      return '""';
    case "int32":
    case "uint32":
    case "int64":
      return "0";
    case "bool":
      return "False";
    case "float":
    case "double":
      return "0.0";
    case "bytes":
      return 'b""';
    case "struct":
      return "field(default_factory=dict)";
    case "value":
      return "None";
    case "array":
      return "field(default_factory=list)";
    case "map":
      return "field(default_factory=dict)";
    case "message":
      return "None";
    default:
      return '""';
  }
}

function pyIsNullableType(ts: TypeSpec): boolean {
  return ts.kind === "message";
}

function pyNeedsFieldImport(ts: TypeSpec): boolean {
  return ts.kind === "struct" || ts.kind === "array" || ts.kind === "map";
}

function pyIsScalarKind(kind: string): boolean {
  switch (kind) {
    case "string":
    case "int32":
    case "uint32":
    case "int64":
    case "bool":
    case "float":
    case "double":
    case "bytes":
      return true;
    default:
      return false;
  }
}

// =========================================================================
// Import tracking (port of pyImports)
// =========================================================================

class PyImports {
  resourcePkg: string;

  needsDataclass = false;
  needsField = false;
  needsIterator = false;
  needsBidiStream = false;
  needsAny = false;
  needsJsonFormat = false;

  services = new Map<string, string>();
  needsIoPb2 = false;
  needsSpec = false;

  needsApiResIo = false;
  needsMetadata = false;
  needsEmptyPb2 = false;
  needsSearch = false;
  needsApiResKind = false;
  needsEnvV1 = false;
  needsExecCtxV1 = false;

  typesNames = new Set<string>();
  crossResourceTypes = new Map<string, string[]>();
  crossProtoPackages = new Set<string>();
  extraPb2Modules = new Set<string>();
  subPkgPb2Imports = new Map<string, string>();

  constructor(pkg: string) {
    this.resourcePkg = pkg;
  }

  addService(role: string, pb2Module: string): void {
    this.services.set(role, pb2Module);
  }

  addTypesImport(name: string): void {
    this.typesNames.add(name);
  }

  addCrossResourceImport(resource: string, typeName: string): void {
    const module = "._" + resource;
    const list = this.crossResourceTypes.get(module);
    if (list === undefined) this.crossResourceTypes.set(module, [typeName]);
    else list.push(typeName);
  }

  addCrossProtoPackage(protoPkg: string): void {
    this.crossProtoPackages.add(protoPkg);
  }

  emit(buf: string[]): void {
    buf.push("from __future__ import annotations\n\n");

    const stdLines: string[] = [];
    if (this.needsDataclass && this.needsField) {
      stdLines.push("from dataclasses import dataclass, field");
    } else if (this.needsDataclass) {
      stdLines.push("from dataclasses import dataclass");
    }
    const typingParts: string[] = [];
    if (this.needsAny) typingParts.push("Any");
    if (this.needsIterator) typingParts.push("Iterator");
    if (typingParts.length > 0) {
      typingParts.sort();
      stdLines.push(`from typing import ${typingParts.join(", ")}`);
    }
    if (stdLines.length > 0) {
      for (const l of stdLines) buf.push(l + "\n");
      buf.push("\n");
    }

    buf.push("import grpc\n\n");

    if (this.needsJsonFormat) {
      buf.push("from google.protobuf import json_format\n\n");
    }

    buf.push(`from ${this.resourcePkg} import api_pb2\n`);
    const emittedModules = new Set<string>();
    const roles = [...this.services.keys()].sort();
    for (const r of roles) {
      const mod = this.services.get(r)!;
      if (!emittedModules.has(mod)) {
        emittedModules.add(mod);
        buf.push(`from ${this.resourcePkg} import ${mod}_pb2_grpc\n`);
      }
    }
    if (this.needsIoPb2) {
      buf.push(`from ${this.resourcePkg} import io_pb2\n`);
    }
    if (this.extraPb2Modules.size > 0) {
      const modules: string[] = [];
      for (const m of this.extraPb2Modules) {
        if (m === "io_pb2" && this.needsIoPb2) continue;
        if (m === "spec_pb2" && this.needsSpec) continue;
        modules.push(m);
      }
      modules.sort();
      for (const m of modules) {
        const subPkg = this.subPkgPb2Imports.get(m);
        if (subPkg !== undefined) {
          buf.push(`from ${subPkg} import ${m}\n`);
        } else {
          buf.push(`from ${this.resourcePkg} import ${m}\n`);
        }
      }
    }
    if (this.needsSpec) {
      buf.push(`from ${this.resourcePkg} import spec_pb2\n`);
    }
    if (this.needsApiResIo) {
      buf.push("from ai.stigmer.commons.apiresource import io_pb2 as apiresource_io_pb2\n");
    }
    if (this.needsMetadata) {
      buf.push("from ai.stigmer.commons.apiresource import metadata_pb2\n");
    }
    if (this.needsEmptyPb2) {
      buf.push("from google.protobuf import empty_pb2\n");
    }
    if (this.needsEnvV1) {
      buf.push("from ai.stigmer.agentic.environment.v1 import spec_pb2 as environment_spec_pb2\n");
    }
    if (this.needsExecCtxV1) {
      buf.push("from ai.stigmer.agentic.executioncontext.v1 import spec_pb2 as executioncontext_spec_pb2\n");
    }
    if (this.needsSearch || this.needsApiResKind) {
      buf.push("from ai.stigmer.commons.apiresource.apiresourcekind import api_resource_kind_pb2\n");
    }
    if (this.needsSearch) {
      buf.push("from ai.stigmer.search.v1 import query_pb2_grpc as search_query_pb2_grpc\n");
      buf.push("from ai.stigmer.search.v1 import io_pb2 as search_io_pb2\n");
      buf.push("from ai.stigmer.commons.rpc import pagination_pb2\n");
    }
    if (this.crossProtoPackages.size > 0) {
      const pkgs = [...this.crossProtoPackages].sort();
      for (const pkg of pkgs) {
        buf.push(pyProtoImportLine(pkg) + "\n");
      }
    }
    buf.push("\n");

    buf.push("from ._errors import wrap_error\n");
    if (this.needsBidiStream) {
      buf.push("from ._bidi import BidiStream\n");
    }
    if (this.typesNames.size > 0) {
      const names = [...this.typesNames].sort();
      buf.push(`from ._types import ${names.join(", ")}\n`);
    }
    if (this.crossResourceTypes.size > 0) {
      const modules = [...this.crossResourceTypes.keys()].sort();
      for (const m of modules) {
        const typeNames = [...this.crossResourceTypes.get(m)!].sort();
        buf.push(`from ${m} import ${typeNames.join(", ")}\n`);
      }
    }
    buf.push("\n\n");
  }
}

// =========================================================================
// Entry point
// =========================================================================

/** Port of runSDKClientPythonGeneration. */
export function runSDKClientPythonGeneration(schemaDir: string, outputDir: string): void {
  const servicesDir = path.join(schemaDir, "services");
  const entries = readDirSorted(servicesDir);
  fs.mkdirSync(outputDir, { recursive: true });

  generatePythonErrors(outputDir);
  generatePythonTypes(outputDir);
  generatePythonBidiStream(outputDir);

  const allResources: ResourceGenInfo[] = [];
  const globalEmitted = new Map<string, string>();

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

    const [code, genInfo] = generatePythonResourceClient(schema, cfg, specSchema, specTypes, globalEmitted);
    fs.writeFileSync(path.join(outputDir, "_" + resource + ".py"), code);
    allResources.push(genInfo);
  }

  allResources.sort((a, b) => (a.resource < b.resource ? -1 : a.resource > b.resource ? 1 : 0));

  generatePythonClientFile(outputDir, allResources);
  generatePythonInit(outputDir, allResources);
  process.stderr.write(`sdk-client-python: generated ${allResources.length} resource clients in ${outputDir}\n`);
}

// =========================================================================
// Per-resource client generation
// =========================================================================

function generatePythonResourceClient(
  schema: ServiceSchemaFile,
  cfg: SdkResourceConfig,
  specSchema: TaskConfigSchema | null,
  specTypes: TypeSchema[],
  globalEmitted: Map<string, string>,
): [string, ResourceGenInfo] {
  const hasInputType = specSchema !== null;
  const needsSearch = schema.listVia === "SearchService";

  const genInfo: ResourceGenInfo = {
    resource: schema.resource,
    clientName: cfg.clientName,
    inputTypes: [],
    streamTypes: [],
  };

  const imports = new PyImports(schema.package);

  const methodTypePb2Map = new Map<string, string>();
  for (const mt of schema.methodTypes ?? []) {
    if (mt.protoFile !== "" && mt.protoType.startsWith(schema.package + ".")) {
      methodTypePb2Map.set(mt.name, pyProtoFileToModule(mt.protoFile));
    }
  }

  for (const svc of schema.services) {
    imports.addService(svc.role, pyServiceModule(svc));
    for (const m of svc.methods) {
      if (searchListSupersedesMethod(schema, m)) continue;
      if (isIDType(m.inputType)) {
        imports.needsIoPb2 = true;
      }
      if (m.inputType === "ApiResourceId" || m.inputType === "ApiResourceReference" || m.inputType === "ApiResourceDeleteInput") {
        imports.needsApiResIo = true;
      }
      if (m.inputType === "ApiResourceReference") {
        imports.addTypesImport("ResourceRef");
        imports.needsApiResKind = true;
      }
      if (m.inputType === "ApiResourceDeleteInput") {
        imports.addTypesImport("DeleteResourceInput");
      }
      if (isEmptyType(m.inputFullType)) {
        imports.needsEmptyPb2 = true;
      }
      if (m.serverStreaming === true) {
        genInfo.streamTypes.push(cfg.protoResType + m.name + "Stream");
        if (m.clientStreaming === true) {
          imports.needsBidiStream = true;
        } else {
          imports.needsIterator = true;
        }
      }
      pyTrackMethodTypeImport(m.outputType, m.outputFullType, cfg, schema, methodTypePb2Map, imports);
      pyTrackMethodTypeImport(m.inputType, m.inputFullType, cfg, schema, methodTypePb2Map, imports);
    }
  }

  if (hasInputType) {
    imports.needsDataclass = true;
    imports.needsSpec = true;
    imports.needsMetadata = true;
  }

  if (needsSearch) {
    imports.needsSearch = true;
    imports.addTypesImport("ListParams");
    imports.addTypesImport("ListResult");
  }

  const typeMap = new Map<string, TypeSchema>();
  for (const t of specTypes) typeMap.set(t.name, t);

  if (specSchema !== null) {
    scanPySpecFields(specSchema.fields, typeMap, imports);
  }

  const body: string[] = [];

  body.push(`class ${cfg.clientName}:\n`);
  body.push(`    """Provides operations on ${schema.resource} resources."""\n\n`);

  body.push("    def __init__(self, channel: grpc.Channel) -> None:\n");
  for (const svc of schema.services) {
    const mod = pyServiceModule(svc);
    body.push(`        self._${svc.role} = ${mod}_pb2_grpc.${svc.name}Stub(channel)\n`);
  }
  if (needsSearch) {
    body.push("        self._search = search_query_pb2_grpc.SearchServiceStub(channel)\n");
  }
  body.push("\n");

  for (const svc of schema.services) {
    for (const m of svc.methods) {
      if (searchListSupersedesMethod(schema, m)) continue;
      generatePythonMethod(body, m, svc, cfg, hasInputType, methodTypePb2Map);
    }
  }
  if (needsSearch) {
    generatePythonSearchList(body, cfg);
  }

  body.push("\n");

  if (specSchema !== null) {
    genInfo.inputTypes = generatePythonInputAndProto(body, schema, cfg, specSchema, typeMap, imports, globalEmitted);
  }

  const buf: string[] = [];
  buf.push("# Code generated by stigmer-codegen. DO NOT EDIT.\n\n");
  imports.emit(buf);
  buf.push(...body);

  return [buf.join(""), genInfo];
}

function scanPySpecFields(fields: FieldSchema[], typeMap: Map<string, TypeSchema>, imports: PyImports): void {
  const visited = new Set<string>();
  for (const f of fields) {
    scanPyFieldImports(f, typeMap, imports, visited);
  }
}

function scanPyFieldImports(f: FieldSchema, typeMap: Map<string, TypeSchema>, imports: PyImports, visited: Set<string>): void {
  const t = f.type;
  if (t.kind === "message" && t.messageType === "EnvironmentSpec") {
    imports.addTypesImport("EnvSpecInput");
  } else if (t.kind === "message" && t.messageType === "ApiResourceReference") {
    imports.addTypesImport("ResourceRef");
  } else if (t.kind === "array" && t.elementType?.kind === "message" && t.elementType.messageType === "ApiResourceReference") {
    imports.addTypesImport("ResourceRef");
  } else if (t.kind === "map" && t.valueType?.messageType === "EnvironmentValue") {
    imports.addTypesImport("EnvVarInput");
    imports.needsEnvV1 = true;
  } else if (t.kind === "map" && t.valueType?.messageType === "ExecutionValue") {
    imports.addTypesImport("EnvVarInput");
    imports.needsExecCtxV1 = true;
  } else if (t.kind === "struct") {
    imports.needsAny = true;
  } else if (t.kind === "value") {
    imports.needsAny = true;
    imports.needsJsonFormat = true;
  } else if (t.kind === "message") {
    const msg = t.messageType ?? "";
    if (!visited.has(msg)) {
      visited.add(msg);
      const ts = typeMap.get(msg);
      if (ts !== undefined) {
        for (const sf of ts.fields) {
          scanPyFieldImports(sf, typeMap, imports, visited);
        }
      }
    }
  } else if (t.kind === "array" && t.elementType?.kind === "message") {
    const elemMsg = t.elementType.messageType ?? "";
    if (!isSpecialType(elemMsg) && !visited.has(elemMsg)) {
      visited.add(elemMsg);
      const ts = typeMap.get(elemMsg);
      if (ts !== undefined) {
        for (const sf of ts.fields) {
          scanPyFieldImports(sf, typeMap, imports, visited);
        }
      }
    }
  }
  if (!f.required && pyNeedsFieldImport(f.type)) {
    imports.needsField = true;
  }
}

// =========================================================================
// Method generation
// =========================================================================

function generatePythonMethod(
  buf: string[],
  m: MethodSchema,
  svc: ServiceDefinition,
  cfg: SdkResourceConfig,
  hasInputType: boolean,
  methodTypePb2Map: Map<string, string>,
): void {
  if (m.serverStreaming === true) {
    generatePythonStreamingMethod(buf, m, svc, cfg, methodTypePb2Map);
    return;
  }

  const emptyInput = isEmptyType(m.inputFullType);
  const emptyOutput = isEmptyType(m.outputFullType);
  const isIDInput = isIDType(m.inputType);
  const isDeleteInput = m.inputType === "ApiResourceDeleteInput";
  const isResourceInput = m.inputType === cfg.protoResType;
  const isApiResourceIdInput = m.inputType === "ApiResourceId";
  const isApiResourceRefInput = m.inputType === "ApiResourceReference";

  const methodName = pyMethodName(m.name);
  const stubMethod = pyStubMethodName(m.name);

  let outputAnnotation = "api_pb2." + cfg.protoResType;
  if (emptyOutput) {
    outputAnnotation = "None";
  } else if (m.outputType !== cfg.protoResType) {
    outputAnnotation = pyMethodTypePb2Prefix(m.outputType, methodTypePb2Map) + "." + m.outputType;
  }

  const returnKw = emptyOutput ? "" : "return ";

  if (emptyInput) {
    buf.push(`    def ${methodName}(self) -> ${outputAnnotation}:\n`);
    buf.push("        try:\n");
    buf.push(`            ${returnKw}self._${svc.role}.${stubMethod}(empty_pb2.Empty())\n`);
    buf.push("        except grpc.RpcError as e:\n");
    buf.push("            raise wrap_error(e) from e\n\n");
  } else if (isResourceInput && hasInputType) {
    const inputTypeName = cfg.inputPrefix + "Input";
    buf.push(`    def ${methodName}(self, input: ${inputTypeName}) -> ${outputAnnotation}:\n`);
    buf.push("        try:\n");
    buf.push(`            ${returnKw}self._${svc.role}.${stubMethod}(input._to_proto())\n`);
    buf.push("        except grpc.RpcError as e:\n");
    buf.push("            raise wrap_error(e) from e\n\n");
  } else if (isResourceInput && !hasInputType) {
    buf.push(`    def ${methodName}(self, input: api_pb2.${cfg.protoResType}) -> ${outputAnnotation}:\n`);
    buf.push("        try:\n");
    buf.push(`            ${returnKw}self._${svc.role}.${stubMethod}(input)\n`);
    buf.push("        except grpc.RpcError as e:\n");
    buf.push("            raise wrap_error(e) from e\n\n");
  } else if (isApiResourceIdInput) {
    buf.push(`    def ${methodName}(self, id: str) -> ${outputAnnotation}:\n`);
    buf.push("        try:\n");
    buf.push(`            ${returnKw}self._${svc.role}.${stubMethod}(apiresource_io_pb2.ApiResourceId(value=id))\n`);
    buf.push("        except grpc.RpcError as e:\n");
    buf.push("            raise wrap_error(e) from e\n\n");
  } else if (isApiResourceRefInput) {
    buf.push(`    def ${methodName}(self, ref: ResourceRef) -> ${outputAnnotation}:\n`);
    buf.push("        try:\n");
    buf.push("            proto = ref._to_proto()\n");
    buf.push(`            proto.kind = api_resource_kind_pb2.${cfg.resourceKind}\n`);
    buf.push(`            ${returnKw}self._${svc.role}.${stubMethod}(proto)\n`);
    buf.push("        except grpc.RpcError as e:\n");
    buf.push("            raise wrap_error(e) from e\n\n");
  } else if (isDeleteInput) {
    buf.push(`    def ${methodName}(self, input: DeleteResourceInput) -> ${outputAnnotation}:\n`);
    buf.push("        try:\n");
    buf.push(`            ${returnKw}self._${svc.role}.${stubMethod}(input._to_proto())\n`);
    buf.push("        except grpc.RpcError as e:\n");
    buf.push("            raise wrap_error(e) from e\n\n");
  } else if (isIDInput) {
    const idMod = pyMethodTypePb2Prefix(m.inputType, methodTypePb2Map);
    buf.push(`    def ${methodName}(self, id: str) -> ${outputAnnotation}:\n`);
    buf.push("        try:\n");
    buf.push(`            ${returnKw}self._${svc.role}.${stubMethod}(${idMod}.${m.inputType}(value=id))\n`);
    buf.push("        except grpc.RpcError as e:\n");
    buf.push("            raise wrap_error(e) from e\n\n");
  } else {
    const inputMod = pyMethodTypePb2Prefix(m.inputType, methodTypePb2Map);
    buf.push(`    def ${methodName}(self, input: ${inputMod}.${m.inputType}) -> ${outputAnnotation}:\n`);
    buf.push("        try:\n");
    buf.push(`            ${returnKw}self._${svc.role}.${stubMethod}(input)\n`);
    buf.push("        except grpc.RpcError as e:\n");
    buf.push("            raise wrap_error(e) from e\n\n");
  }
}

function generatePythonStreamingMethod(
  buf: string[],
  m: MethodSchema,
  svc: ServiceDefinition,
  cfg: SdkResourceConfig,
  methodTypePb2Map: Map<string, string>,
): void {
  const isIDInput = isIDType(m.inputType);
  const methodName = pyMethodName(m.name);
  const stubMethod = pyStubMethodName(m.name);

  let outputAnnotation = "api_pb2." + cfg.protoResType;
  if (m.outputType !== cfg.protoResType) {
    outputAnnotation = pyMethodTypePb2Prefix(m.outputType, methodTypePb2Map) + "." + m.outputType;
  }

  if (m.clientStreaming === true) {
    const inputMod = pyMethodTypePb2Prefix(m.inputType, methodTypePb2Map);
    buf.push(`    def ${methodName}(self) -> BidiStream[${inputMod}.${m.inputType}, ${outputAnnotation}]:\n`);
    buf.push("        try:\n");
    buf.push(`            return BidiStream(lambda reqs: self._${svc.role}.${stubMethod}(reqs))\n`);
    buf.push("        except grpc.RpcError as e:\n");
    buf.push("            raise wrap_error(e) from e\n\n");
  } else if (isIDInput) {
    const idMod = pyMethodTypePb2Prefix(m.inputType, methodTypePb2Map);
    buf.push(`    def ${methodName}(self, id: str) -> Iterator[${outputAnnotation}]:\n`);
    buf.push("        try:\n");
    buf.push(`            for msg in self._${svc.role}.${stubMethod}(${idMod}.${m.inputType}(value=id)):\n`);
    buf.push("                yield msg\n");
    buf.push("        except grpc.RpcError as e:\n");
    buf.push("            raise wrap_error(e) from e\n\n");
  } else {
    const inputMod = pyMethodTypePb2Prefix(m.inputType, methodTypePb2Map);
    buf.push(`    def ${methodName}(self, input: ${inputMod}.${m.inputType}) -> Iterator[${outputAnnotation}]:\n`);
    buf.push("        try:\n");
    buf.push(`            for msg in self._${svc.role}.${stubMethod}(input):\n`);
    buf.push("                yield msg\n");
    buf.push("        except grpc.RpcError as e:\n");
    buf.push("            raise wrap_error(e) from e\n\n");
  }
}

function generatePythonSearchList(buf: string[], cfg: SdkResourceConfig): void {
  buf.push("    def list(self, params: ListParams) -> ListResult:\n");
  buf.push("        try:\n");
  buf.push("            req = search_io_pb2.SearchRequest(\n");
  buf.push(`                kinds=[api_resource_kind_pb2.ApiResourceKind.${cfg.resourceKind}],\n`);
  buf.push("                query=params.query,\n");
  buf.push("                org=params.org,\n");
  buf.push("                exclude_public=params.exclude_public,\n");
  buf.push("                cross_org_public=params.cross_org_public,\n");
  buf.push("            )\n");
  buf.push("            if params.page is not None:\n");
  buf.push("                req.page.CopyFrom(pagination_pb2.PageInfo(\n");
  buf.push("                    num=params.page.num,\n");
  buf.push("                    size=params.page.size,\n");
  buf.push("                ))\n");
  buf.push("            resp = self._search.search(req)\n");
  buf.push("            return ListResult(\n");
  buf.push("                entries=list(resp.entries),\n");
  buf.push("                total_count=resp.total_count,\n");
  buf.push("                total_pages=resp.total_pages,\n");
  buf.push("            )\n");
  buf.push("        except grpc.RpcError as e:\n");
  buf.push("            raise wrap_error(e) from e\n\n");
}

// =========================================================================
// Input types + _to_proto
// =========================================================================

function generatePythonInputAndProto(
  buf: string[],
  schema: ServiceSchemaFile,
  cfg: SdkResourceConfig,
  spec: TaskConfigSchema,
  typeMap: Map<string, TypeSchema>,
  imports: PyImports,
  globalEmitted: Map<string, string>,
): string[] {
  const inputName = cfg.inputPrefix + "Input";
  const emitted = new Set<string>();
  const allTypes: string[] = [];

  const specFields = spec.fields.filter((f) => !META_FIELD_NAMES.has(f.name));

  const requiredFields = specFields.filter((f) => f.required);
  const optionalFields = specFields.filter((f) => !f.required);

  buf.push("@dataclass\n");
  buf.push(`class ${inputName}:\n`);
  buf.push(`    """Input for creating or updating a ${cfg.protoResType}."""\n\n`);
  buf.push("    name: str\n");
  buf.push("    org: str\n");
  emitPyFields(buf, requiredFields, imports);
  // id: exact update addressing for platform-scoped (org-less) kinds.
  buf.push("    id: str | None = None\n");
  buf.push("    slug: str | None = None\n");
  buf.push("    labels: dict[str, str] | None = None\n");
  buf.push("    visibility: int = 0\n");
  if (cfg.isVersioned) {
    buf.push('    version_message: str = ""\n');
  }
  emitPyFields(buf, optionalFields, imports);

  emitPyMainToProto(buf, cfg, spec, specFields, imports);

  allTypes.push(inputName);

  for (const f of specFields) {
    emitPyNestedClassWithProto(buf, f, typeMap, emitted, allTypes, imports, globalEmitted, schema.resource);
  }

  return allTypes;
}

function emitPyFields(buf: string[], fields: FieldSchema[], imports: PyImports): void {
  for (const f of fields) {
    let pyType = pyTypeForTypeSpec(f.type);
    if (pyIsNullableType(f.type)) {
      pyType += " | None";
    }
    const name = pyFieldName(f.protoField);
    const dflt = pyDefaultForField(f);
    if (dflt !== "") {
      buf.push(`    ${name}: ${pyType} = ${dflt}\n`);
      if (pyNeedsFieldImport(f.type)) {
        imports.needsField = true;
      }
    } else {
      buf.push(`    ${name}: ${pyType}\n`);
    }
  }
}

function emitPyMainToProto(buf: string[], cfg: SdkResourceConfig, spec: TaskConfigSchema, specFields: FieldSchema[], imports: PyImports): void {
  const safeScalars: FieldSchema[] = [];
  const kwScalars: FieldSchema[] = [];
  const complexFields: FieldSchema[] = [];
  for (const f of specFields) {
    if (pyIsScalarKind(f.type.kind)) {
      if (isPythonKeyword(f.protoField)) kwScalars.push(f);
      else safeScalars.push(f);
    } else {
      complexFields.push(f);
    }
  }

  buf.push(`\n    def _to_proto(self) -> api_pb2.${cfg.protoResType}:\n`);

  if (safeScalars.length > 0) {
    buf.push(`        spec = spec_pb2.${spec.name}(\n`);
    for (const f of safeScalars) {
      buf.push(`            ${f.protoField}=self.${pyFieldName(f.protoField)},\n`);
    }
    buf.push("        )\n");
  } else {
    buf.push(`        spec = spec_pb2.${spec.name}()\n`);
  }

  for (const f of kwScalars) {
    buf.push(`        setattr(spec, ${goQuote(f.protoField)}, self.${pyFieldName(f.protoField)})\n`);
  }

  for (const f of complexFields) {
    emitPyToProtoFieldAssign(buf, f, "spec", "self", "        ", imports);
  }

  buf.push("        metadata = metadata_pb2.ApiResourceMetadata(\n");
  buf.push("            name=self.name,\n");
  buf.push("            org=self.org,\n");
  buf.push("        )\n");
  buf.push("        if self.id:\n");
  buf.push("            metadata.id = self.id\n");
  buf.push("        if self.slug:\n");
  buf.push("            metadata.slug = self.slug\n");
  buf.push("        if self.labels:\n");
  buf.push("            metadata.labels.update(self.labels)\n");
  buf.push("        if self.visibility:\n");
  buf.push("            metadata.visibility = self.visibility\n");
  if (cfg.isVersioned) {
    buf.push("        if self.version_message:\n");
    buf.push("            metadata.version.CopyFrom(metadata_pb2.ApiResourceMetadataVersion(\n");
    buf.push("                message=self.version_message,\n");
    buf.push("            ))\n");
  }
  buf.push(`        return api_pb2.${cfg.protoResType}(\n`);
  buf.push(`            api_version=${goQuote(cfg.apiVersion)},\n`);
  buf.push(`            kind=${goQuote(cfg.protoResType)},\n`);
  buf.push("            metadata=metadata,\n");
  buf.push("            spec=spec,\n");
  buf.push("        )\n\n");
}

function emitPyNestedClassWithProto(
  buf: string[],
  f: FieldSchema,
  typeMap: Map<string, TypeSchema>,
  emitted: Set<string>,
  allTypes: string[],
  imports: PyImports,
  globalEmitted: Map<string, string>,
  resource: string,
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

  const sourceResource = globalEmitted.get(msgName);
  if (sourceResource !== undefined) {
    imports.addCrossResourceImport(sourceResource, inputName);
    for (const field of ts.fields) {
      emitPyNestedClassWithProto(buf, field, typeMap, emitted, allTypes, imports, globalEmitted, resource);
    }
    return;
  }
  globalEmitted.set(msgName, resource);

  const requiredFields = ts.fields.filter((field) => field.required);
  const optionalFields = ts.fields.filter((field) => !field.required);

  buf.push(`\n@dataclass\nclass ${inputName}:\n`);
  buf.push(`    """SDK input type for ${msgName}."""\n\n`);
  emitPyFields(buf, requiredFields, imports);
  emitPyFields(buf, optionalFields, imports);

  const safeScalars: FieldSchema[] = [];
  const kwScalars: FieldSchema[] = [];
  const complexFields: FieldSchema[] = [];
  for (const field of ts.fields) {
    if (pyIsScalarKind(field.type.kind)) {
      if (isPythonKeyword(field.protoField)) kwScalars.push(field);
      else safeScalars.push(field);
    } else {
      complexFields.push(field);
    }
  }

  let protoModule = "spec_pb2";
  if (ts.protoType !== "") {
    const parts = ts.protoType.split(".");
    if (parts.length > 1) {
      const typePkg = parts.slice(0, -1).join(".");
      if (typePkg !== imports.resourcePkg) {
        protoModule = pyProtoModuleAlias(typePkg);
        imports.addCrossProtoPackage(typePkg);
      }
    }
  }

  buf.push(`\n    def _to_proto(self) -> ${protoModule}.${msgName}:\n`);
  if (safeScalars.length > 0) {
    buf.push(`        msg = ${protoModule}.${msgName}(\n`);
    for (const field of safeScalars) {
      buf.push(`            ${field.protoField}=self.${pyFieldName(field.protoField)},\n`);
    }
    buf.push("        )\n");
  } else {
    buf.push(`        msg = ${protoModule}.${msgName}()\n`);
  }
  for (const field of kwScalars) {
    buf.push(`        setattr(msg, ${goQuote(field.protoField)}, self.${pyFieldName(field.protoField)})\n`);
  }
  for (const field of complexFields) {
    emitPyToProtoFieldAssign(buf, field, "msg", "self", "        ", imports);
  }
  buf.push("        return msg\n\n");

  allTypes.push(inputName);

  for (const field of ts.fields) {
    emitPyNestedClassWithProto(buf, field, typeMap, emitted, allTypes, imports, globalEmitted, resource);
  }
}

// =========================================================================
// _to_proto field assignment helpers
// =========================================================================

function emitPyToProtoFieldAssign(buf: string[], f: FieldSchema, msgVar: string, selfVar: string, indent: string, imports: PyImports): void {
  const protoField = f.protoField;
  const selfField = pyFieldName(f.protoField);
  const isKw = isPythonKeyword(protoField);

  const protoAccess = (v: string, field: string): string => {
    if (isKw) return `getattr(${v}, ${goQuote(field)})`;
    return v + "." + field;
  };

  const t = f.type;
  const refKind = f.referenceKind ?? 0;

  if (t.kind === "timestamp") {
    buf.push(`${indent}if ${selfVar}.${selfField}:\n`);
    buf.push(`${indent}    ${protoAccess(msgVar, protoField)}.FromJsonString(${selfVar}.${selfField})\n`);
  } else if (t.kind === "struct") {
    buf.push(`${indent}if ${selfVar}.${selfField}:\n`);
    buf.push(`${indent}    ${protoAccess(msgVar, protoField)}.update(${selfVar}.${selfField})\n`);
  } else if (t.kind === "value") {
    buf.push(`${indent}if ${selfVar}.${selfField} is not None:\n`);
    buf.push(`${indent}    json_format.ParseDict(${selfVar}.${selfField}, ${protoAccess(msgVar, protoField)})\n`);
  } else if (t.kind === "message" && t.messageType === "ApiResourceReference" && refKind !== 0) {
    buf.push(`${indent}if ${selfVar}.${selfField} is not None and (${selfVar}.${selfField}.org or ${selfVar}.${selfField}.slug):\n`);
    buf.push(`${indent}    _ref = ${selfVar}.${selfField}._to_proto()\n`);
    buf.push(`${indent}    _ref.kind = ${refKind}\n`);
    buf.push(`${indent}    ${protoAccess(msgVar, protoField)}.CopyFrom(_ref)\n`);
  } else if (t.kind === "message" && t.messageType === "ApiResourceReference") {
    buf.push(`${indent}if ${selfVar}.${selfField} is not None and (${selfVar}.${selfField}.org or ${selfVar}.${selfField}.slug):\n`);
    buf.push(`${indent}    ${protoAccess(msgVar, protoField)}.CopyFrom(${selfVar}.${selfField}._to_proto())\n`);
  } else if (t.kind === "message") {
    buf.push(`${indent}if ${selfVar}.${selfField} is not None:\n`);
    buf.push(`${indent}    ${protoAccess(msgVar, protoField)}.CopyFrom(${selfVar}.${selfField}._to_proto())\n`);
  } else if (t.kind === "array" && t.elementType?.kind === "string") {
    buf.push(`${indent}if ${selfVar}.${selfField}:\n`);
    buf.push(`${indent}    ${protoAccess(msgVar, protoField)}.extend(${selfVar}.${selfField})\n`);
  } else if (t.kind === "array" && t.elementType?.kind === "message" && t.elementType.messageType === "ApiResourceReference") {
    if (refKind !== 0) {
      buf.push(`${indent}for ref in ${selfVar}.${selfField}:\n`);
      buf.push(`${indent}    _ref = ref._to_proto()\n`);
      buf.push(`${indent}    _ref.kind = ${refKind}\n`);
      buf.push(`${indent}    ${protoAccess(msgVar, protoField)}.append(_ref)\n`);
    } else {
      buf.push(`${indent}for ref in ${selfVar}.${selfField}:\n`);
      buf.push(`${indent}    ${protoAccess(msgVar, protoField)}.append(ref._to_proto())\n`);
    }
  } else if (t.kind === "array" && t.elementType?.kind === "message") {
    buf.push(`${indent}for item in ${selfVar}.${selfField}:\n`);
    buf.push(`${indent}    ${protoAccess(msgVar, protoField)}.append(item._to_proto())\n`);
  } else if (t.kind === "array") {
    buf.push(`${indent}if ${selfVar}.${selfField}:\n`);
    buf.push(`${indent}    ${protoAccess(msgVar, protoField)}.extend(${selfVar}.${selfField})\n`);
  } else if (t.kind === "map" && t.valueType?.kind === "string") {
    buf.push(`${indent}if ${selfVar}.${selfField}:\n`);
    buf.push(`${indent}    ${protoAccess(msgVar, protoField)}.update(${selfVar}.${selfField})\n`);
  } else if (t.kind === "map" && t.valueType?.messageType === "EnvironmentValue") {
    imports.needsEnvV1 = true;
    buf.push(`${indent}for k, v in ${selfVar}.${selfField}.items():\n`);
    buf.push(`${indent}    ${protoAccess(msgVar, protoField)}[k].CopyFrom(environment_spec_pb2.EnvironmentValue(\n`);
    buf.push(`${indent}        value=v.value, is_secret=v.is_secret, description=v.description,\n`);
    buf.push(`${indent}    ))\n`);
  } else if (t.kind === "map" && t.valueType?.messageType === "ExecutionValue") {
    imports.needsExecCtxV1 = true;
    buf.push(`${indent}for k, v in ${selfVar}.${selfField}.items():\n`);
    buf.push(`${indent}    ${protoAccess(msgVar, protoField)}[k].CopyFrom(executioncontext_spec_pb2.ExecutionValue(\n`);
    buf.push(`${indent}        value=v.value, is_secret=v.is_secret,\n`);
    buf.push(`${indent}    ))\n`);
  } else if (t.kind === "map" && t.valueType?.kind === "message") {
    buf.push(`${indent}for k, v in ${selfVar}.${selfField}.items():\n`);
    buf.push(`${indent}    ${protoAccess(msgVar, protoField)}[k].CopyFrom(v._to_proto())\n`);
  } else if (t.kind === "map") {
    buf.push(`${indent}if ${selfVar}.${selfField}:\n`);
    buf.push(`${indent}    ${protoAccess(msgVar, protoField)}.update(${selfVar}.${selfField})\n`);
  }
}

// =========================================================================
// Static files
// =========================================================================

function generatePythonClientFile(outputDir: string, resources: ResourceGenInfo[]): void {
  const buf: string[] = [];
  buf.push("# Code generated by stigmer-codegen. DO NOT EDIT.\n\n");
  buf.push("from __future__ import annotations\n\n");
  buf.push("import grpc\n\n");

  for (const r of resources) {
    buf.push(`from ._${r.resource} import ${r.clientName}\n`);
  }
  buf.push("\n\n");

  buf.push("class GeneratedClient:\n");
  buf.push('    """Aggregate client composing all resource-specific sub-clients."""\n\n');

  buf.push("    def __init__(self, channel: grpc.Channel) -> None:\n");
  for (const r of resources) {
    buf.push(`        self.${pyClientFieldName(r.resource)} = ${r.clientName}(channel)\n`);
  }
  buf.push("\n");

  fs.writeFileSync(path.join(outputDir, "_client.py"), buf.join(""));
}

function generatePythonErrors(outputDir: string): void {
  const content = `# Code generated by stigmer-codegen. DO NOT EDIT.

from __future__ import annotations

import enum

import grpc


class ErrorCode(enum.Enum):
    """Error codes mapped from gRPC status codes."""

    UNKNOWN = "unknown"
    NOT_FOUND = "not-found"
    PERMISSION_DENIED = "permission-denied"
    UNAUTHENTICATED = "unauthenticated"
    INVALID_ARGUMENT = "invalid-argument"
    ALREADY_EXISTS = "already-exists"
    RESOURCE_EXHAUSTED = "resource-exhausted"
    FAILED_PRECONDITION = "failed-precondition"
    INTERNAL = "internal"
    UNAVAILABLE = "unavailable"
    CANCELLED = "cancelled"


_GRPC_CODE_MAP: dict[grpc.StatusCode, ErrorCode] = {
    grpc.StatusCode.NOT_FOUND: ErrorCode.NOT_FOUND,
    grpc.StatusCode.PERMISSION_DENIED: ErrorCode.PERMISSION_DENIED,
    grpc.StatusCode.UNAUTHENTICATED: ErrorCode.UNAUTHENTICATED,
    grpc.StatusCode.INVALID_ARGUMENT: ErrorCode.INVALID_ARGUMENT,
    grpc.StatusCode.ALREADY_EXISTS: ErrorCode.ALREADY_EXISTS,
    grpc.StatusCode.RESOURCE_EXHAUSTED: ErrorCode.RESOURCE_EXHAUSTED,
    grpc.StatusCode.FAILED_PRECONDITION: ErrorCode.FAILED_PRECONDITION,
    grpc.StatusCode.INTERNAL: ErrorCode.INTERNAL,
    grpc.StatusCode.UNAVAILABLE: ErrorCode.UNAVAILABLE,
    grpc.StatusCode.CANCELLED: ErrorCode.CANCELLED,
}


class StigmerError(Exception):
    """Structured error type returned by all SDK operations."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        grpc_code: grpc.StatusCode,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.grpc_code = grpc_code

    def __repr__(self) -> str:
        return f"StigmerError(code={self.code.value!r}, message={str(self)!r})"


def wrap_error(err: grpc.RpcError) -> StigmerError:
    """Convert a gRPC RpcError into a StigmerError."""
    grpc_code = err.code()
    code = _GRPC_CODE_MAP.get(grpc_code, ErrorCode.UNKNOWN)
    message = err.details() or str(err)
    return StigmerError(code, message, grpc_code)


def is_not_found(err: BaseException) -> bool:
    """Check whether an error represents a NOT_FOUND status."""
    return isinstance(err, StigmerError) and err.code == ErrorCode.NOT_FOUND


def is_unauthenticated(err: BaseException) -> bool:
    """Check whether an error represents an UNAUTHENTICATED status."""
    return isinstance(err, StigmerError) and err.code == ErrorCode.UNAUTHENTICATED


def is_permission_denied(err: BaseException) -> bool:
    """Check whether an error represents a PERMISSION_DENIED status."""
    return isinstance(err, StigmerError) and err.code == ErrorCode.PERMISSION_DENIED


def is_retryable(err: BaseException) -> bool:
    """Check whether the error is transient and the operation can be retried."""
    return isinstance(err, StigmerError) and err.code in (
        ErrorCode.INTERNAL,
        ErrorCode.UNAVAILABLE,
    )


def is_unimplemented(err: BaseException) -> bool:
    """The server does not implement the called RPC.

    The code clients key capability fallbacks on (e.g. the skill artifact
    transfer lane's unary fallback, stigmer#675/#701). Checks the raw gRPC
    code: UNIMPLEMENTED deliberately has no ErrorCode mapping, so it
    surfaces as UNKNOWN.
    """
    return isinstance(err, StigmerError) and err.grpc_code == grpc.StatusCode.UNIMPLEMENTED
`;
  fs.writeFileSync(path.join(outputDir, "_errors.py"), content);
}

function generatePythonTypes(outputDir: string): void {
  const content = `# Code generated by stigmer-codegen. DO NOT EDIT.

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ai.stigmer.agentic.environment.v1 import spec_pb2 as environment_spec_pb2
from ai.stigmer.commons.apiresource import io_pb2 as apiresource_io_pb2
from ai.stigmer.search.v1 import io_pb2 as search_io_pb2


@dataclass
class DeleteResourceInput:
    """Arguments for deleting a resource."""

    resource_id: str = ""
    version_message: str = ""
    force: bool = False

    def _to_proto(self) -> apiresource_io_pb2.ApiResourceDeleteInput:
        return apiresource_io_pb2.ApiResourceDeleteInput(
            resource_id=self.resource_id,
            version_message=self.version_message,
            force=self.force,
        )


@dataclass
class ResourceRef:
    """Identifies an API resource by org, slug, and optional version."""

    org: str = ""
    slug: str = ""
    version: str = ""
    kind: int = 0

    def _to_proto(self) -> apiresource_io_pb2.ApiResourceReference:
        return apiresource_io_pb2.ApiResourceReference(
            org=self.org,
            slug=self.slug,
            version=self.version,
            kind=self.kind,
        )


@dataclass
class Page:
    """Offset-based pagination parameters."""

    num: int = 1
    size: int = 20


@dataclass
class ListParams:
    """Parameters for SearchService-backed list queries."""

    org: str = ""
    query: str = ""
    exclude_public: bool = False
    cross_org_public: bool = False
    page: Page | None = None


@dataclass
class ListResult:
    """Response from a SearchService-backed list query."""

    entries: list[search_io_pb2.SearchResult] = field(default_factory=list)
    total_count: int = 0
    total_pages: int = 0


@dataclass
class EnvVarInput:
    """A single environment variable."""

    value: str = ""
    is_secret: bool = False
    description: str = ""


@dataclass
class EnvSpecInput:
    """Environment variable configuration."""

    variables: dict[str, EnvVarInput] = field(default_factory=dict)

    def _to_proto(self) -> environment_spec_pb2.EnvironmentSpec:
        spec = environment_spec_pb2.EnvironmentSpec()
        for name, var in self.variables.items():
            spec.data[name].CopyFrom(
                environment_spec_pb2.EnvironmentValue(
                    value=var.value,
                    is_secret=var.is_secret,
                    description=var.description,
                )
            )
        return spec
`;
  fs.writeFileSync(path.join(outputDir, "_types.py"), content);
}

function generatePythonBidiStream(outputDir: string): void {
  const buf: string[] = [];
  buf.push("# Code generated by stigmer-codegen. DO NOT EDIT.\n\n");
  buf.push("from __future__ import annotations\n\n");
  buf.push("import queue\n");
  buf.push("from typing import Generic, Iterator, TypeVar\n\n");
  buf.push('Send = TypeVar("Send")\n');
  buf.push('Receive = TypeVar("Receive")\n\n');
  buf.push("_SENTINEL = object()\n\n\n");
  buf.push("class BidiStream(Generic[Send, Receive]):\n");
  buf.push('    """Wraps a bidirectional streaming RPC with send/receive/close."""\n\n');
  buf.push("    def __init__(self, open_fn):\n");
  buf.push("        self._queue: queue.SimpleQueue = queue.SimpleQueue()\n");
  buf.push("        self._responses = open_fn(self._iter_requests())\n\n");
  buf.push("    def _iter_requests(self):\n");
  buf.push("        while True:\n");
  buf.push("            msg = self._queue.get()\n");
  buf.push("            if msg is _SENTINEL:\n");
  buf.push("                return\n");
  buf.push("            yield msg\n\n");
  buf.push("    def send(self, msg: Send) -> None:\n");
  buf.push('        """Send a message to the server."""\n');
  buf.push("        self._queue.put(msg)\n\n");
  buf.push("    def close(self) -> None:\n");
  buf.push('        """Signal that no more messages will be sent."""\n');
  buf.push("        self._queue.put(_SENTINEL)\n\n");
  buf.push("    def __iter__(self) -> Iterator[Receive]:\n");
  buf.push("        return iter(self._responses)\n\n");
  buf.push("    def __next__(self) -> Receive:\n");
  buf.push("        return next(self._responses)\n");
  fs.writeFileSync(path.join(outputDir, "_bidi.py"), buf.join(""));
}

function generatePythonInit(outputDir: string, resources: ResourceGenInfo[]): void {
  const buf: string[] = [];
  buf.push("# Code generated by stigmer-codegen. DO NOT EDIT.\n\n");

  buf.push("from ._bidi import BidiStream\n");
  buf.push("from ._client import GeneratedClient\n");

  for (const r of resources) {
    const exports = [r.clientName, ...r.inputTypes];
    buf.push(`from ._${r.resource} import ${exports.join(", ")}\n`);
  }

  buf.push("from ._types import (\n");
  buf.push("    DeleteResourceInput,\n");
  buf.push("    EnvSpecInput,\n");
  buf.push("    EnvVarInput,\n");
  buf.push("    ListParams,\n");
  buf.push("    ListResult,\n");
  buf.push("    Page,\n");
  buf.push("    ResourceRef,\n");
  buf.push(")\n");

  buf.push("from ._errors import (\n");
  buf.push("    ErrorCode,\n");
  buf.push("    StigmerError,\n");
  buf.push("    is_not_found,\n");
  buf.push("    is_permission_denied,\n");
  buf.push("    is_retryable,\n");
  buf.push("    is_unauthenticated,\n");
  buf.push("    is_unimplemented,\n");
  buf.push("    wrap_error,\n");
  buf.push(")\n");

  buf.push("\n__all__ = [\n");
  buf.push('    "GeneratedClient",\n');
  for (const r of resources) {
    buf.push(`    ${goQuote(r.clientName)},\n`);
    for (const t of r.inputTypes) {
      buf.push(`    ${goQuote(t)},\n`);
    }
  }
  buf.push('    "DeleteResourceInput",\n');
  buf.push('    "EnvSpecInput",\n');
  buf.push('    "EnvVarInput",\n');
  buf.push('    "ListParams",\n');
  buf.push('    "ListResult",\n');
  buf.push('    "Page",\n');
  buf.push('    "ResourceRef",\n');
  buf.push('    "ErrorCode",\n');
  buf.push('    "StigmerError",\n');
  buf.push('    "is_not_found",\n');
  buf.push('    "is_permission_denied",\n');
  buf.push('    "is_retryable",\n');
  buf.push('    "is_unauthenticated",\n');
  buf.push('    "is_unimplemented",\n');
  buf.push('    "wrap_error",\n');
  buf.push("]\n");

  fs.writeFileSync(path.join(outputDir, "__init__.py"), buf.join(""));
}
