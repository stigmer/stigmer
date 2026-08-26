// sdk-client target: typed resource clients for the Go SDK
// (sdk/go/internal/gen + the sdk-root types.go / from_proto.go). Byte-parity
// port of sdk_client.go, with two Go-specific mechanics reproduced:
//
//   - formatting: Go used go/format.Source in-process; this port pipes each
//     file through the `gofmt` binary (same formatter, same output). The Go
//     toolchain is already a hard dependency of every lane that runs this
//     target (it compiles the SDK next), so shelling out adds no new
//     requirement.
//   - import pruning: Go parsed the rendered body with go/parser and kept
//     only enum/cross-package imports whose alias appears as a selector.
//     This port scans the comment-stripped body for `alias.` selectors —
//     equivalent for generated bodies, which never name an alias inside a
//     string literal.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import type { MethodSchema, ServiceDefinition, ServiceSchemaFile } from "./gen-common.js";
import {
  goProtoFieldName,
  goQuote,
  isEmptyType,
  isIDType,
  isSpecialType,
  protoTypeToGoImportPath,
  protoTypeToPackageAlias,
  searchListSupersedesMethod,
} from "./gen-common.js";
import { apiResourceKindEnumNames } from "./resource-kind.js";
import type { ResourceGenInfo, SdkResourceConfig } from "./sdk-resource-config.js";
import { deriveResourceConfig, loadSpecSchemaWithTypes, META_FIELD_NAMES } from "./sdk-resource-config.js";
import type { FieldSchema, TaskConfigSchema, TypeSchema, TypeSpec } from "./schema.js";
import { readDirSorted } from "./schema.js";

const SDK_PROTO_IMPORT_PREFIX = "github.com/stigmer/stigmer/sdk/go/v3/proto";

interface FromProtoFuncInfo {
  funcName: string;
  protoAlias: string;
  protoPath: string;
  protoType: string;
  inputType: string;
}

interface GoResourceGenInfo extends ResourceGenInfo {
  fromProto: FromProtoFuncInfo | null;
}

/** The go/format.Source equivalent: pipe through gofmt, fail loudly. */
function gofmt(source: string, context: string): string {
  try {
    return execFileSync("gofmt", [], { input: source, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`gofmt failed for ${context}: ${err instanceof Error ? err.message : String(err)}\ngenerated:\n${source}`);
  }
}

// Which package qualifiers the rendered body names — the `pkg` of every
// `pkg.Symbol` selector, scanned over the comment-stripped body (see the
// file comment for the parity argument).
function usedPackageAliases(body: string): Set<string> {
  const stripped = body
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
  const used = new Set<string>();
  const re = /(?<![\w.])([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z_]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    used.add(m[1]);
  }
  return used;
}

/** Port of runSDKClientGeneration. */
export function runSDKClientGeneration(schemaDir: string, outputDir: string): void {
  const servicesDir = path.join(schemaDir, "services");
  const entries = readDirSorted(servicesDir);
  fs.mkdirSync(outputDir, { recursive: true });

  generateGenErrors(outputDir);
  generateGenStructConv(outputDir);
  generateGenTypes(outputDir);

  const allResources: GoResourceGenInfo[] = [];
  const globalEmitted = new Set<string>();

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

    const [code, genInfo] = generateResourceClient(schema, cfg, specSchema, specTypes, globalEmitted);
    fs.writeFileSync(path.join(outputDir, resource + ".go"), code);
    allResources.push(genInfo);
  }

  allResources.sort((a, b) => (a.resource < b.resource ? -1 : a.resource > b.resource ? 1 : 0));

  generateGenClientFile(outputDir, allResources);

  const sdkRootDir = path.dirname(path.dirname(outputDir));
  generateSDKTypesFile(sdkRootDir, allResources);
  generateSDKFromProtoFile(sdkRootDir, allResources);
  process.stderr.write(`sdk-client: generated ${allResources.length} resource clients in ${outputDir}\n`);
}

function deriveGoImportPath(pkg: string): string {
  return SDK_PROTO_IMPORT_PREFIX + "/" + pkg.replaceAll(".", "/");
}

function resolveType(fullType: string, shortType: string, schemaPkg: string, alias: string): [string, string] {
  if (isEmptyType(fullType)) {
    return ["emptypb", "Empty"];
  }
  if (fullType.startsWith(schemaPkg + ".")) {
    const suffix = fullType.slice(schemaPkg.length + 1);
    if (suffix.lastIndexOf(".") > 0) {
      return [protoTypeToPackageAlias(fullType), shortType];
    }
    return [alias, shortType];
  }
  if (fullType.includes("commons.apiresource")) {
    return ["apiresource", shortType];
  }
  return [alias, shortType];
}

function collectSubPackageImports(schema: ServiceSchemaFile): Map<string, string> {
  const imports = new Map<string, string>();
  const pkg = schema.package;
  for (const svc of schema.services) {
    for (const m of svc.methods) {
      for (const ft of [m.inputFullType, m.outputFullType]) {
        if (!ft.startsWith(pkg + ".")) continue;
        const suffix = ft.slice(pkg.length + 1);
        if (suffix.lastIndexOf(".") > 0) {
          const subAlias = protoTypeToPackageAlias(ft);
          const subPath = protoTypeToGoImportPath(ft, SDK_PROTO_IMPORT_PREFIX);
          if (subAlias !== "" && subPath !== "") {
            imports.set(subAlias, subPath);
          }
        }
      }
    }
  }
  return imports;
}

// =========================================================================
// SDK enum imports (cross-package enums)
// =========================================================================

function goSDKEnumGoType(enumProtoType: string): string {
  const parts = enumProtoType.split(".");
  if (parts.length === 0) return "string";
  const enumName = parts[parts.length - 1];
  const pkg = protoTypeToPackageAlias(enumProtoType);
  if (pkg === "") return "string";
  return pkg + "." + enumName;
}

function walkTypeSpecEnumImports(ts: TypeSpec | undefined, out: Map<string, string>): void {
  if (ts === undefined) return;
  if (ts.kind === "string" && ts.enumType !== undefined && ts.enumType !== "") {
    const importPath = protoTypeToGoImportPath(ts.enumType, SDK_PROTO_IMPORT_PREFIX);
    const pkgAlias = protoTypeToPackageAlias(ts.enumType);
    if (importPath !== "" && pkgAlias !== "") {
      out.set(pkgAlias, importPath);
    }
  }
  walkTypeSpecEnumImports(ts.elementType, out);
  walkTypeSpecEnumImports(ts.keyType, out);
  walkTypeSpecEnumImports(ts.valueType, out);
}

function collectSDKEnumImports(specSchema: TaskConfigSchema, specTypes: TypeSchema[]): Map<string, string> {
  const out = new Map<string, string>();
  const walkFields = (fields: FieldSchema[]): void => {
    for (const f of fields) {
      walkTypeSpecEnumImports(f.type, out);
    }
  };
  walkFields(specSchema.fields);
  for (const t of specTypes) {
    if (!isSpecialType(t.name)) {
      walkFields(t.fields);
    }
  }
  return out;
}

// =========================================================================
// Resource client generation
// =========================================================================

function generateResourceClient(
  schema: ServiceSchemaFile,
  cfg: SdkResourceConfig,
  specSchema: TaskConfigSchema | null,
  specTypes: TypeSchema[],
  globalEmitted: Set<string>,
): [string, GoResourceGenInfo] {
  const importPath = deriveGoImportPath(schema.package);
  const alias = schema.goImportPath ?? "";

  const genInfo: GoResourceGenInfo = {
    resource: schema.resource,
    clientName: cfg.clientName,
    inputTypes: [],
    streamTypes: [],
    fromProto: null,
  };

  const buf: string[] = [];
  buf.push("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n");
  buf.push("package gen\n\n");

  let needsIO = false;
  let needsEmptypb = false;
  let needsApiResource = false;
  let needsApiResourceRef = false;
  const needsSearch = schema.listVia === "SearchService";
  const hasInputType = specSchema !== null;
  for (const svc of schema.services) {
    for (const m of svc.methods) {
      if (searchListSupersedesMethod(schema, m)) continue;
      if (m.serverStreaming === true) needsIO = true;
      if (m.inputFullType.includes("commons.apiresource")) needsApiResource = true;
      if (m.inputType === "ApiResourceReference") needsApiResourceRef = true;
      if (isEmptyType(m.inputFullType)) needsEmptypb = true;
    }
  }

  const typeMap = new Map<string, TypeSchema>();
  for (const t of specTypes) typeMap.set(t.name, t);

  let needsExecutionContext = false;
  let needsEnvironmentV1 = false;
  let needsTimestamppb = false;
  let needsRefKindOverride = false;
  const crossPkgImports = new Map<string, string>();
  if (specSchema !== null) {
    const scanFieldsForImports = (fields: FieldSchema[]): void => {
      for (const f of fields) {
        if (f.type.kind === "map" && f.type.valueType?.messageType === "ExecutionValue") {
          needsExecutionContext = true;
        }
        if (f.type.kind === "map" && f.type.valueType?.kind === "message") {
          const elemMsg = f.type.valueType.messageType ?? "";
          if (elemMsg === "EnvironmentValue") {
            needsEnvironmentV1 = true;
          } else {
            const ts = typeMap.get(elemMsg);
            if (ts !== undefined && ts.protoType !== "" && protoTypeToPackageAlias(ts.protoType) === "environmentv1") {
              needsEnvironmentV1 = true;
            }
          }
        }
        if (f.type.kind === "message" && (f.type.messageType ?? "") !== "" && !isSpecialType(f.type.messageType ?? "")) {
          const ts = typeMap.get(f.type.messageType ?? "");
          if (ts !== undefined && ts.protoType !== "") {
            const a = protoTypeToPackageAlias(ts.protoType);
            if (a !== "" && a !== alias && a !== "environmentv1" && a !== "executioncontextv1") {
              const idx = ts.protoType.lastIndexOf(".");
              if (idx > 0) {
                const protoPkg = ts.protoType.slice(0, idx);
                crossPkgImports.set(a, SDK_PROTO_IMPORT_PREFIX + "/" + protoPkg.replaceAll(".", "/"));
              }
            }
          }
        }
        if (f.type.kind === "timestamp") needsTimestamppb = true;
        if ((f.referenceKind ?? 0) !== 0) needsRefKindOverride = true;
      }
    };
    scanFieldsForImports(specSchema.fields);
    for (const t of specTypes) {
      if (!isSpecialType(t.name)) {
        scanFieldsForImports(t.fields);
      }
    }
  }

  let enumImports = new Map<string, string>();
  if (specSchema !== null) {
    enumImports = collectSDKEnumImports(specSchema, specTypes);
  }

  const subPkgImports = collectSubPackageImports(schema);

  // The body is rendered BEFORE the import block so cross-package imports
  // can be emitted only when the body actually names them (globalEmitted
  // dedup means a second resource embedding a shared helper never names the
  // foreign alias itself).
  const bodyBuf: string[] = [];
  bodyBuf.push(`// ${cfg.clientName} provides operations on ${schema.resource} resources.\n`);
  bodyBuf.push(`type ${cfg.clientName} struct {\n`);
  for (const svc of schema.services) {
    bodyBuf.push(`\t${svc.role} ${alias}.${svc.name}Client\n`);
  }
  if (needsSearch) {
    bodyBuf.push("\tsearch searchv1.SearchServiceClient\n");
  }
  bodyBuf.push("}\n\n");

  bodyBuf.push(`func New${cfg.clientName}(conn grpc.ClientConnInterface) *${cfg.clientName} {\n`);
  bodyBuf.push(`\treturn &${cfg.clientName}{\n`);
  for (const svc of schema.services) {
    bodyBuf.push(`\t\t${svc.role}: ${alias}.New${svc.name}Client(conn),\n`);
  }
  if (needsSearch) {
    bodyBuf.push("\t\tsearch: searchv1.NewSearchServiceClient(conn),\n");
  }
  bodyBuf.push("\t}\n}\n\n");

  for (const svc of schema.services) {
    for (const m of svc.methods) {
      if (searchListSupersedesMethod(schema, m)) continue;
      generateMethod(bodyBuf, m, svc, schema, cfg, alias, hasInputType);
      if (m.serverStreaming === true) {
        genInfo.streamTypes.push(cfg.protoResType + m.name + "Stream");
      }
    }
  }

  if (needsSearch) {
    generateSearchList(bodyBuf, cfg);
  }

  if (specSchema !== null) {
    genInfo.inputTypes = generateInputTypesV2(bodyBuf, cfg, specSchema, typeMap, alias, globalEmitted);

    generateFromProto(bodyBuf, cfg, specSchema, typeMap, alias, globalEmitted);
    genInfo.fromProto = {
      funcName: cfg.inputPrefix + "InputFromProto",
      protoAlias: alias,
      protoPath: importPath,
      protoType: cfg.protoResType,
      inputType: cfg.inputPrefix + "Input",
    };
  }
  const body = bodyBuf.join("");
  const bodyAliases = usedPackageAliases(body);

  buf.push("import (\n");
  buf.push('\t"context"\n');
  if (needsIO) buf.push('\t"io"\n');
  if (needsTimestamppb) buf.push('\t"time"\n');
  buf.push("\n");
  buf.push(`\t${alias} ${goQuote(importPath)}\n`);
  if (subPkgImports.size > 0) {
    const subAliases = [...subPkgImports.keys()].sort();
    for (const a of subAliases) {
      buf.push(`\t${a} ${goQuote(subPkgImports.get(a)!)}\n`);
    }
  }
  if (enumImports.size > 0) {
    const enumAliases: string[] = [];
    for (const a of enumImports.keys()) {
      // Usage-driven: only the resource that won the globalEmitted dedup
      // for a shared nested type names its foreign enum package.
      if (a !== alias && bodyAliases.has(a)) {
        enumAliases.push(a);
      }
    }
    enumAliases.sort();
    for (const a of enumAliases) {
      buf.push(`\t${a} ${goQuote(enumImports.get(a)!)}\n`);
    }
  }
  if (needsApiResource || hasInputType) {
    buf.push('\tapiresource "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/apiresource"\n');
  }
  if (needsSearch || needsApiResourceRef || needsRefKindOverride) {
    buf.push('\tapiresourcekind "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/apiresource/apiresourcekind"\n');
  }
  if (needsSearch) {
    buf.push('\trpc "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/rpc"\n');
    buf.push('\tsearchv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/search/v1"\n');
  }
  if (needsExecutionContext) {
    buf.push('\texecutioncontextv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/executioncontext/v1"\n');
  }
  if (needsEnvironmentV1) {
    buf.push('\tenvironmentv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/environment/v1"\n');
  }
  if (crossPkgImports.size > 0) {
    const aliases: string[] = [];
    for (const a of crossPkgImports.keys()) {
      if (bodyAliases.has(a)) {
        aliases.push(a);
      }
    }
    aliases.sort();
    for (const a of aliases) {
      buf.push(`\t${a} ${goQuote(crossPkgImports.get(a)!)}\n`);
    }
  }
  if (needsEmptypb) {
    buf.push('\t"google.golang.org/protobuf/types/known/emptypb"\n');
  }
  if (needsTimestamppb) {
    buf.push('\t"google.golang.org/protobuf/types/known/timestamppb"\n');
  }
  buf.push('\t"google.golang.org/grpc"\n');
  buf.push(")\n\n");

  buf.push(body);

  const formatted = gofmt(buf.join(""), schema.resource + ".go");
  return [formatted, genInfo];
}

// =========================================================================
// Method generation
// =========================================================================

function generateMethod(
  buf: string[],
  m: MethodSchema,
  svc: ServiceDefinition,
  schema: ServiceSchemaFile,
  cfg: SdkResourceConfig,
  alias: string,
  hasInputType: boolean,
): void {
  const receiver = cfg.clientName.slice(0, 1).toLowerCase();
  const [inputPkg, inputType] = resolveType(m.inputFullType, m.inputType, schema.package, alias);
  const [outputPkg, outputType] = resolveType(m.outputFullType, m.outputType, schema.package, alias);

  if (m.serverStreaming === true) {
    generateStreamingMethod(buf, m, svc, receiver, cfg, inputPkg, inputType, outputPkg, outputType);
    return;
  }

  const emptyInput = isEmptyType(m.inputFullType);
  const emptyOutput = isEmptyType(m.outputFullType);
  const isIDInput = isIDType(m.inputType);
  const isDeleteInput = m.inputType === "ApiResourceDeleteInput";
  const isResourceInput = m.inputType === cfg.protoResType;
  const isApiResRefInput = m.inputType === "ApiResourceReference";

  if (emptyInput && emptyOutput) {
    buf.push(`func (${receiver} *${cfg.clientName}) ${m.name}(ctx context.Context) error {\n`);
    buf.push(`\t_, err := ${receiver}.${svc.role}.${m.name}(ctx, &emptypb.Empty{})\n`);
    buf.push("\treturn wrapErr(err)\n}\n\n");
  } else if (emptyInput) {
    buf.push(`func (${receiver} *${cfg.clientName}) ${m.name}(ctx context.Context) (*${outputPkg}.${outputType}, error) {\n`);
    buf.push(`\tresp, err := ${receiver}.${svc.role}.${m.name}(ctx, &emptypb.Empty{})\n`);
    buf.push("\treturn resp, wrapErr(err)\n}\n\n");
  } else if (emptyOutput && isIDInput) {
    buf.push(`func (${receiver} *${cfg.clientName}) ${m.name}(ctx context.Context, id string) error {\n`);
    buf.push(`\t_, err := ${receiver}.${svc.role}.${m.name}(ctx, &${inputPkg}.${m.inputType}{Value: id})\n`);
    buf.push("\treturn wrapErr(err)\n}\n\n");
  } else if (emptyOutput) {
    buf.push(`func (${receiver} *${cfg.clientName}) ${m.name}(ctx context.Context, input *${inputPkg}.${inputType}) error {\n`);
    buf.push(`\t_, err := ${receiver}.${svc.role}.${m.name}(ctx, input)\n`);
    buf.push("\treturn wrapErr(err)\n}\n\n");
  } else if (isResourceInput && hasInputType) {
    const inputTypeName = cfg.inputPrefix + "Input";
    buf.push(`func (${receiver} *${cfg.clientName}) ${m.name}(ctx context.Context, input *${inputTypeName}) (*${outputPkg}.${outputType}, error) {\n`);
    buf.push("\treq, err := input.toProto()\n");
    buf.push("\tif err != nil {\n\t\treturn nil, invalidInputErr(err)\n\t}\n");
    buf.push(`\tresp, err := ${receiver}.${svc.role}.${m.name}(ctx, req)\n`);
    buf.push("\treturn resp, wrapErr(err)\n}\n\n");
  } else if (isResourceInput && !hasInputType) {
    buf.push(`func (${receiver} *${cfg.clientName}) ${m.name}(ctx context.Context, input *${inputPkg}.${inputType}) (*${outputPkg}.${outputType}, error) {\n`);
    buf.push(`\tresp, err := ${receiver}.${svc.role}.${m.name}(ctx, input)\n`);
    buf.push("\treturn resp, wrapErr(err)\n}\n\n");
  } else if (isIDInput) {
    buf.push(`func (${receiver} *${cfg.clientName}) ${m.name}(ctx context.Context, id string) (*${outputPkg}.${outputType}, error) {\n`);
    buf.push(`\tresp, err := ${receiver}.${svc.role}.${m.name}(ctx, &${inputPkg}.${m.inputType}{Value: id})\n`);
    buf.push("\treturn resp, wrapErr(err)\n}\n\n");
  } else if (isDeleteInput) {
    buf.push(`func (${receiver} *${cfg.clientName}) ${m.name}(ctx context.Context, input *DeleteResourceInput) (*${outputPkg}.${outputType}, error) {\n`);
    buf.push(`\tresp, err := ${receiver}.${svc.role}.${m.name}(ctx, &apiresource.ApiResourceDeleteInput{\n`);
    buf.push("\t\tResourceId:     input.ResourceID,\n");
    buf.push("\t\tVersionMessage: input.VersionMessage,\n");
    buf.push("\t\tForce:          input.Force,\n");
    buf.push("\t})\n\treturn resp, wrapErr(err)\n}\n\n");
  } else if (isApiResRefInput) {
    const kindConst = "apiresourcekind.ApiResourceKind_" + cfg.resourceKind;
    buf.push(`func (${receiver} *${cfg.clientName}) ${m.name}(ctx context.Context, ref ResourceRef) (*${outputPkg}.${outputType}, error) {\n`);
    buf.push(`\tref.Kind = ${kindConst}\n`);
    buf.push(`\tresp, err := ${receiver}.${svc.role}.${m.name}(ctx, ref.toProto())\n`);
    buf.push("\treturn resp, wrapErr(err)\n}\n\n");
  } else {
    buf.push(`func (${receiver} *${cfg.clientName}) ${m.name}(ctx context.Context, input *${inputPkg}.${inputType}) (*${outputPkg}.${outputType}, error) {\n`);
    buf.push(`\tresp, err := ${receiver}.${svc.role}.${m.name}(ctx, input)\n`);
    buf.push("\treturn resp, wrapErr(err)\n}\n\n");
  }
}

function generateStreamingMethod(
  buf: string[],
  m: MethodSchema,
  svc: ServiceDefinition,
  receiver: string,
  cfg: SdkResourceConfig,
  inputPkg: string,
  inputType: string,
  outputPkg: string,
  outputType: string,
): void {
  const isIDInput = isIDType(m.inputType);
  const streamTypeName = cfg.protoResType + m.name + "Stream";

  if (m.clientStreaming === true) {
    buf.push(`// ${streamTypeName} wraps the bidi stream for ${m.name}, providing\n`);
    buf.push(`// Send, Recv, and CloseSend for the ${cfg.protoResType.toLowerCase()} command channel.\n`);
    buf.push(`type ${streamTypeName} struct {\n`);
    buf.push(`\tstream ${inputPkg}.${svc.name}_${m.name}Client\n`);
    buf.push("}\n\n");

    buf.push(`func (s *${streamTypeName}) Send(msg *${inputPkg}.${inputType}) error {\n`);
    buf.push("\treturn wrapErr(s.stream.Send(msg))\n}\n\n");

    buf.push(`func (s *${streamTypeName}) Recv() (*${outputPkg}.${outputType}, error) {\n`);
    buf.push("\tmsg, err := s.stream.Recv()\n");
    buf.push("\tif err != nil {\n\t\tif err == io.EOF {\n\t\t\treturn nil, io.EOF\n\t\t}\n\t\treturn nil, wrapErr(err)\n\t}\n\treturn msg, nil\n}\n\n");

    buf.push(`func (s *${streamTypeName}) CloseSend() error {\n`);
    buf.push("\treturn wrapErr(s.stream.CloseSend())\n}\n\n");

    buf.push(`func (${receiver} *${cfg.clientName}) ${m.name}(ctx context.Context, opts ...grpc.CallOption) (*${streamTypeName}, error) {\n`);
    buf.push(`\tstream, err := ${receiver}.${svc.role}.${m.name}(ctx, opts...)\n`);
  } else {
    buf.push(`// ${streamTypeName} wraps the server stream for ${m.name}.\n`);
    buf.push(`type ${streamTypeName} struct {\n`);
    buf.push(`\tstream ${inputPkg}.${svc.name}_${m.name}Client\n`);
    buf.push("}\n\n");

    buf.push(`func (s *${streamTypeName}) Recv() (*${outputPkg}.${outputType}, error) {\n`);
    buf.push("\tmsg, err := s.stream.Recv()\n");
    buf.push("\tif err != nil {\n\t\tif err == io.EOF {\n\t\t\treturn nil, io.EOF\n\t\t}\n\t\treturn nil, wrapErr(err)\n\t}\n\treturn msg, nil\n}\n\n");

    if (isIDInput) {
      buf.push(`func (${receiver} *${cfg.clientName}) ${m.name}(ctx context.Context, id string) (*${streamTypeName}, error) {\n`);
      buf.push(`\tstream, err := ${receiver}.${svc.role}.${m.name}(ctx, &${inputPkg}.${m.inputType}{Value: id})\n`);
    } else {
      buf.push(`func (${receiver} *${cfg.clientName}) ${m.name}(ctx context.Context, input *${inputPkg}.${inputType}) (*${streamTypeName}, error) {\n`);
      buf.push(`\tstream, err := ${receiver}.${svc.role}.${m.name}(ctx, input)\n`);
    }
  }
  buf.push("\tif err != nil {\n\t\treturn nil, wrapErr(err)\n\t}\n");
  buf.push(`\treturn &${streamTypeName}{stream: stream}, nil\n}\n\n`);
}

function generateSearchList(buf: string[], cfg: SdkResourceConfig): void {
  const receiver = cfg.clientName.slice(0, 1).toLowerCase();
  const kindConst = "apiresourcekind.ApiResourceKind_" + cfg.resourceKind;

  buf.push(`func (${receiver} *${cfg.clientName}) List(ctx context.Context, params *ListParams) (*ListResult, error) {\n`);
  buf.push("\treq := &searchv1.SearchRequest{\n");
  buf.push(`\t\tKinds: []apiresourcekind.ApiResourceKind{${kindConst}},\n`);
  buf.push("\t\tQuery: params.Query,\n");
  buf.push("\t\tOrg:            params.Org,\n");
  buf.push("\t\tExcludePublic:  params.ExcludePublic,\n");
  buf.push("\t\tCrossOrgPublic: params.CrossOrgPublic,\n");
  buf.push("\t}\n");
  buf.push("\tif params.Page != nil {\n");
  buf.push("\t\treq.Page = &rpc.PageInfo{Num: params.Page.Num, Size: params.Page.Size}\n");
  buf.push("\t}\n");
  buf.push(`\tresp, err := ${receiver}.search.Search(ctx, req)\n`);
  buf.push("\tif err != nil {\n\t\treturn nil, wrapErr(err)\n\t}\n");
  buf.push("\treturn &ListResult{\n");
  buf.push("\t\tEntries:    resp.GetEntries(),\n");
  buf.push("\t\tTotalCount: resp.GetTotalCount(),\n");
  buf.push("\t\tTotalPages: resp.GetTotalPages(),\n");
  buf.push("\t}, nil\n}\n\n");
}

// =========================================================================
// Input type generation from spec schemas
// =========================================================================

function generateInputTypesV2(
  buf: string[],
  cfg: SdkResourceConfig,
  spec: TaskConfigSchema,
  typeMap: Map<string, TypeSchema>,
  alias: string,
  globalEmitted: Set<string>,
): string[] {
  const inputName = cfg.inputPrefix + "Input";
  const emitted = new Set<string>();
  const allTypes: string[] = [];

  const specFields = spec.fields.filter((f) => !META_FIELD_NAMES.has(f.name));

  buf.push(`// ${inputName} holds the fields for creating/updating a ${cfg.protoResType}.\n`);
  buf.push(`type ${inputName} struct {\n`);
  buf.push("\t// Id is the resource's metadata.id, for exact update addressing when\n");
  buf.push("\t// set from a loaded resource. Required for updates to platform-scoped\n");
  buf.push("\t// (org-less) kinds, where the org+slug fallback cannot match. On\n");
  buf.push("\t// create, the cloud server stamps its own id regardless; the OSS\n");
  buf.push("\t// server honors a caller-supplied id (existing apply semantics).\n");
  buf.push("\tId         string\n");
  buf.push("\tName       string\n");
  buf.push("\tSlug       string\n");
  buf.push("\tOrg        string\n");
  buf.push("\tLabels     map[string]string\n");
  buf.push("\tVisibility apiresource.ApiResourceVisibility\n");
  if (cfg.isVersioned) {
    buf.push("\tVersionMessage string\n");
  }
  for (const f of specFields) {
    buf.push(`\t${f.name} ${goTypeForField(f)}\n`);
  }
  buf.push("}\n\n");
  allTypes.push(inputName);

  for (const f of specFields) {
    emitNestedTypes(buf, f, typeMap, emitted, allTypes, globalEmitted);
  }

  // toProto returns (proto, error): all schema-derived Input types are
  // uniformly fallible (stigmer/stigmer#342) so a schema change can never
  // flip a signature.
  buf.push(`func (i *${inputName}) toProto() (*${alias}.${cfg.protoResType}, error) {\n`);
  buf.push(`\tresource := &${alias}.${cfg.protoResType}{\n`);
  buf.push(`\t\tApiVersion: ${goQuote(cfg.apiVersion)},\n`);
  buf.push(`\t\tKind:       ${goQuote(cfg.protoResType)},\n`);
  buf.push("\t\tMetadata: &apiresource.ApiResourceMetadata{\n");
  buf.push("\t\t\tId:         i.Id,\n");
  buf.push("\t\t\tName:       i.Name,\n");
  buf.push("\t\t\tSlug:       i.Slug,\n");
  buf.push("\t\t\tOrg:        i.Org,\n");
  buf.push("\t\t\tLabels:     i.Labels,\n");
  buf.push("\t\t\tVisibility: i.Visibility,\n");
  buf.push("\t\t},\n");
  buf.push(`\t\tSpec: &${alias}.${spec.name}{},\n`);
  buf.push("\t}\n");
  if (cfg.isVersioned) {
    buf.push('\tif i.VersionMessage != "" {\n');
    buf.push("\t\tresource.Metadata.Version = &apiresource.ApiResourceMetadataVersion{\n");
    buf.push("\t\t\tMessage: i.VersionMessage,\n");
    buf.push("\t\t}\n");
    buf.push("\t}\n");
  }

  for (const f of specFields) {
    emitToProtoField(buf, f, alias, typeMap, spec.name);
  }

  buf.push("\treturn resource, nil\n}\n\n");

  for (const f of specFields) {
    emitNestedToProto(buf, f, alias, typeMap, emitted, globalEmitted);
  }

  return allTypes;
}

function goTypeForField(f: FieldSchema): string {
  return goTypeForTypeSpec(f.type);
}

function goTypeForTypeSpec(ts: TypeSpec): string {
  switch (ts.kind) {
    case "string":
      if (ts.enumType !== undefined && ts.enumType !== "") {
        return goSDKEnumGoType(ts.enumType);
      }
      return "string";
    case "int32":
      return "int32";
    case "uint32":
      return "uint32";
    case "int64":
      return "int64";
    case "bool":
      return "bool";
    case "float":
      return "float32";
    case "double":
      return "float64";
    case "bytes":
      return "[]byte";
    case "timestamp":
      return "string";
    case "struct":
      return "map[string]any";
    case "value":
      return "any";
    case "array":
      if (ts.elementType !== undefined) {
        return "[]" + goTypeForTypeSpec(ts.elementType);
      }
      return "[]string";
    case "map": {
      const keyType = ts.keyType !== undefined ? goTypeForTypeSpec(ts.keyType) : "string";
      const valType = ts.valueType !== undefined ? goTypeForTypeSpec(ts.valueType) : "string";
      return `map[${keyType}]${valType}`;
    }
    case "message":
      switch (ts.messageType) {
        case "EnvironmentSpec":
          return "*EnvSpecInput";
        case "EnvironmentValue":
        case "ExecutionValue":
          return "EnvVarInput";
        case "ApiResourceReference":
          return "ResourceRef";
        default:
          return "*" + (ts.messageType ?? "") + "Input";
      }
    default:
      return "string";
  }
}

function emitNestedTypes(
  buf: string[],
  f: FieldSchema,
  typeMap: Map<string, TypeSchema>,
  emitted: Set<string>,
  allTypes: string[],
  globalEmitted: Set<string>,
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

  if (isSpecialType(msgName)) return;
  if (emitted.has(msgName)) return;
  const ts = typeMap.get(msgName);
  if (ts === undefined) return;
  emitted.add(msgName);

  if (!globalEmitted.has(msgName)) {
    globalEmitted.add(msgName);

    const inputName = msgName + "Input";
    buf.push(`// ${inputName} is the SDK input type for ${msgName}.\n`);
    buf.push(`type ${inputName} struct {\n`);
    for (const field of ts.fields) {
      buf.push(`\t${field.name} ${goTypeForField(field)}\n`);
    }
    buf.push("}\n\n");
    allTypes.push(inputName);
  }

  for (const field of ts.fields) {
    emitNestedTypes(buf, field, typeMap, emitted, allTypes, globalEmitted);
  }
}

// Conversion of one spec-level input field onto resource.Spec.
function emitToProtoField(buf: string[], f: FieldSchema, alias: string, typeMap: Map<string, TypeSchema>, specName: string): void {
  const protoField = goProtoFieldName(f.protoField);
  const t = f.type;
  const refKind = f.referenceKind ?? 0;

  if (t.kind === "timestamp") {
    buf.push(`\tif i.${f.name} != "" {\n`);
    buf.push(`\t\tt, err := time.Parse(time.RFC3339, i.${f.name})\n`);
    buf.push(`\t\tif err != nil {\n\t\t\treturn nil, fieldErr(${goQuote(f.name)}, err)\n\t\t}\n`);
    buf.push(`\t\tresource.Spec.${protoField} = timestamppb.New(t)\n`);
    buf.push("\t}\n");
  } else if (t.kind === "struct") {
    buf.push(`\tif i.${f.name} != nil {\n`);
    buf.push(`\t\tv, err := structFromMap(i.${f.name})\n`);
    buf.push(`\t\tif err != nil {\n\t\t\treturn nil, fieldErr(${goQuote(f.name)}, err)\n\t\t}\n`);
    buf.push(`\t\tresource.Spec.${protoField} = v\n`);
    buf.push("\t}\n");
  } else if (t.kind === "value") {
    buf.push(`\tif i.${f.name} != nil {\n`);
    buf.push(`\t\tv, err := valueFromAny(i.${f.name})\n`);
    buf.push(`\t\tif err != nil {\n\t\t\treturn nil, fieldErr(${goQuote(f.name)}, err)\n\t\t}\n`);
    buf.push(`\t\tresource.Spec.${protoField} = v\n`);
    buf.push("\t}\n");
  } else if (
    t.kind === "string" || t.kind === "bool" || t.kind === "int32" || t.kind === "int64" ||
    t.kind === "uint32" || t.kind === "float" || t.kind === "double" || t.kind === "bytes"
  ) {
    buf.push(`\tresource.Spec.${protoField} = i.${f.name}\n`);
  } else if (t.kind === "message" && t.messageType === "EnvironmentSpec") {
    buf.push(`\tif i.${f.name} != nil {\n`);
    buf.push(`\t\tresource.Spec.${protoField} = i.${f.name}.toProto()\n`);
    buf.push("\t}\n");
  } else if (t.kind === "message" && t.messageType === "ApiResourceReference") {
    buf.push(`\tif i.${f.name}.Org != "" || i.${f.name}.Slug != "" {\n`);
    if (refKind !== 0) {
      const enumName = apiResourceKindEnumNames.get(refKind) ?? "";
      buf.push(`\t\tref := i.${f.name}.toProto()\n`);
      buf.push(`\t\tref.Kind = apiresourcekind.ApiResourceKind_${enumName}\n`);
      buf.push(`\t\tresource.Spec.${protoField} = ref\n`);
    } else {
      buf.push(`\t\tresource.Spec.${protoField} = i.${f.name}.toProto()\n`);
    }
    buf.push("\t}\n");
  } else if (t.kind === "message" && (f.oneofGroup ?? "") !== "") {
    emitOneofMemberToProto(buf, f, alias, specName, "resource.Spec", typeMap);
  } else if (t.kind === "message") {
    buf.push(`\tif i.${f.name} != nil {\n`);
    buf.push(`\t\tv, err := i.${f.name}.toProto()\n`);
    buf.push(`\t\tif err != nil {\n\t\t\treturn nil, fieldErr(${goQuote(f.name)}, err)\n\t\t}\n`);
    buf.push(`\t\tresource.Spec.${protoField} = v\n`);
    buf.push("\t}\n");
  } else if (t.kind === "array" && t.elementType?.kind === "string") {
    buf.push(`\tresource.Spec.${protoField} = i.${f.name}\n`);
  } else if (t.kind === "array" && t.elementType?.kind === "struct") {
    buf.push(`\tfor idx, item := range i.${f.name} {\n`);
    buf.push("\t\tv, err := structFromMap(item)\n");
    buf.push(`\t\tif err != nil {\n\t\t\treturn nil, indexErr(${goQuote(f.name)}, idx, err)\n\t\t}\n`);
    buf.push(`\t\tresource.Spec.${protoField} = append(resource.Spec.${protoField}, v)\n`);
    buf.push("\t}\n");
  } else if (t.kind === "array" && t.elementType?.kind === "message") {
    const elemMsg = t.elementType.messageType ?? "";
    if (elemMsg === "ApiResourceReference") {
      buf.push(`\tfor _, r := range i.${f.name} {\n`);
      if (refKind !== 0) {
        const enumName = apiResourceKindEnumNames.get(refKind) ?? "";
        buf.push("\t\tref := r.toProto()\n");
        buf.push(`\t\tref.Kind = apiresourcekind.ApiResourceKind_${enumName}\n`);
        buf.push(`\t\tresource.Spec.${protoField} = append(resource.Spec.${protoField}, ref)\n`);
      } else {
        buf.push(`\t\tresource.Spec.${protoField} = append(resource.Spec.${protoField}, r.toProto())\n`);
      }
      buf.push("\t}\n");
    } else {
      buf.push(`\tfor idx, item := range i.${f.name} {\n`);
      buf.push("\t\tv, err := item.toProto()\n");
      buf.push(`\t\tif err != nil {\n\t\t\treturn nil, indexErr(${goQuote(f.name)}, idx, err)\n\t\t}\n`);
      buf.push(`\t\tresource.Spec.${protoField} = append(resource.Spec.${protoField}, v)\n`);
      buf.push("\t}\n");
    }
  } else if (t.kind === "map") {
    if (t.valueType?.kind === "message") {
      const elemMsg = t.valueType.messageType ?? "";
      if (elemMsg === "ExecutionValue") {
        buf.push(`\tif len(i.${f.name}) > 0 {\n`);
        buf.push(`\t\tresource.Spec.${protoField} = make(map[string]*executioncontextv1.ExecutionValue, len(i.${f.name}))\n`);
        buf.push(`\t\tfor k, v := range i.${f.name} {\n`);
        buf.push(`\t\t\tresource.Spec.${protoField}[k] = &executioncontextv1.ExecutionValue{Value: v.Value, IsSecret: v.IsSecret}\n`);
        buf.push("\t\t}\n\t}\n");
      } else if (elemMsg === "EnvironmentValue") {
        buf.push(`\tif len(i.${f.name}) > 0 {\n`);
        buf.push(`\t\tresource.Spec.${protoField} = make(map[string]*environmentv1.EnvironmentValue, len(i.${f.name}))\n`);
        buf.push(`\t\tfor k, v := range i.${f.name} {\n`);
        buf.push(`\t\t\tresource.Spec.${protoField}[k] = &environmentv1.EnvironmentValue{Value: v.Value, IsSecret: v.IsSecret, Description: v.Description}\n`);
        buf.push("\t\t}\n\t}\n");
      } else {
        let elemAlias = alias;
        const ts = typeMap.get(elemMsg);
        if (ts !== undefined && ts.protoType !== "") {
          const derivedAlias = protoTypeToPackageAlias(ts.protoType);
          if (derivedAlias !== "") elemAlias = derivedAlias;
        }
        buf.push(`\tif len(i.${f.name}) > 0 {\n`);
        buf.push(`\t\tresource.Spec.${protoField} = make(map[string]*${elemAlias}.${elemMsg}, len(i.${f.name}))\n`);
        buf.push(`\t\tfor k, val := range i.${f.name} {\n`);
        buf.push("\t\t\tpv, err := val.toProto()\n");
        buf.push(`\t\t\tif err != nil {\n\t\t\t\treturn nil, keyErr(${goQuote(f.name)}, k, err)\n\t\t\t}\n`);
        buf.push(`\t\t\tresource.Spec.${protoField}[k] = pv\n`);
        buf.push("\t\t}\n\t}\n");
      }
    } else {
      buf.push(`\tresource.Spec.${protoField} = i.${f.name}\n`);
    }
  } else {
    buf.push(`\tresource.Spec.${protoField} = i.${f.name}\n`);
  }
}

// Guarded assignment of one message-typed oneof member onto its container's
// oneof field (see sdk_client.go's emitOneofMemberToProto for the full
// member-field conversion contract).
function emitOneofMemberToProto(
  buf: string[],
  f: FieldSchema,
  alias: string,
  containerMsg: string,
  dst: string,
  typeMap: Map<string, TypeSchema>,
): void {
  const protoField = goProtoFieldName(f.protoField);
  const oneofWrapper = containerMsg + "_" + protoField;
  const msgType = f.type.messageType ?? "";

  const ts = typeMap.get(msgType);
  if (ts === undefined) return;

  let memberAlias = alias;
  if (ts.protoType !== "") {
    const derived = protoTypeToPackageAlias(ts.protoType);
    if (derived !== "") memberAlias = derived;
  }

  const oneofContainer = goProtoFieldName(f.oneofGroup ?? "");
  buf.push(`\tif i.${f.name} != nil {\n`);
  buf.push(`\t\tm := &${memberAlias}.${msgType}{}\n`);
  for (const field of ts.fields) {
    const pf = goProtoFieldName(field.protoField);
    if ((field.oneofGroup ?? "").startsWith("_")) {
      const zero = goZeroValueForTypeSpec(field.type);
      buf.push(`\t\tif i.${f.name}.${field.name} != ${zero} {\n`);
      buf.push(`\t\t\tv := i.${f.name}.${field.name}\n`);
      buf.push(`\t\t\tm.${pf} = &v\n`);
      buf.push("\t\t}\n");
      continue;
    }
    if (field.type.kind === "message" && field.type.messageType === "ApiResourceReference") {
      buf.push(`\t\tif i.${f.name}.${field.name}.Org != "" || i.${f.name}.${field.name}.Slug != "" {\n`);
      if ((field.referenceKind ?? 0) !== 0) {
        const enumName = apiResourceKindEnumNames.get(field.referenceKind ?? 0) ?? "";
        buf.push(`\t\t\tref := i.${f.name}.${field.name}.toProto()\n`);
        buf.push(`\t\t\tref.Kind = apiresourcekind.ApiResourceKind_${enumName}\n`);
        buf.push(`\t\t\tm.${pf} = ref\n`);
      } else {
        buf.push(`\t\t\tm.${pf} = i.${f.name}.${field.name}.toProto()\n`);
      }
      buf.push("\t\t}\n");
      continue;
    }
    if (field.type.kind === "message") {
      buf.push(`\t\tif i.${f.name}.${field.name} != nil {\n`);
      buf.push(`\t\t\tv, err := i.${f.name}.${field.name}.toProto()\n`);
      buf.push(`\t\t\tif err != nil {\n\t\t\t\treturn nil, fieldErr(${goQuote(f.name + "." + field.name)}, err)\n\t\t\t}\n`);
      buf.push(`\t\t\tm.${pf} = v\n`);
      buf.push("\t\t}\n");
      continue;
    }
    if (field.type.kind === "array" && field.type.elementType?.kind === "message") {
      if (field.type.elementType.messageType === "ApiResourceReference") {
        buf.push(`\t\tfor _, r := range i.${f.name}.${field.name} {\n`);
        if ((field.referenceKind ?? 0) !== 0) {
          const enumName = apiResourceKindEnumNames.get(field.referenceKind ?? 0) ?? "";
          buf.push("\t\t\tref := r.toProto()\n");
          buf.push(`\t\t\tref.Kind = apiresourcekind.ApiResourceKind_${enumName}\n`);
          buf.push(`\t\t\tm.${pf} = append(m.${pf}, ref)\n`);
        } else {
          buf.push(`\t\t\tm.${pf} = append(m.${pf}, r.toProto())\n`);
        }
        buf.push("\t\t}\n");
      } else {
        buf.push(`\t\tfor idx, item := range i.${f.name}.${field.name} {\n`);
        buf.push("\t\t\tv, err := item.toProto()\n");
        buf.push(`\t\t\tif err != nil {\n\t\t\t\treturn nil, indexErr(${goQuote(f.name + "." + field.name)}, idx, err)\n\t\t\t}\n`);
        buf.push(`\t\t\tm.${pf} = append(m.${pf}, v)\n`);
        buf.push("\t\t}\n");
      }
      continue;
    }
    buf.push(`\t\tm.${pf} = i.${f.name}.${field.name}\n`);
  }
  buf.push(`\t\t${dst}.${oneofContainer} = &${alias}.${oneofWrapper}{${protoField}: m}\n`);
  buf.push("\t}\n");
}

// Go zero-value literal for a synthetic-oneof (proto3 optional) member.
function goZeroValueForTypeSpec(ts: TypeSpec): string {
  switch (ts.kind) {
    case "string":
      if (ts.enumType !== undefined && ts.enumType !== "") return "0";
      return '""';
    case "bool":
      return "false";
    default:
      return "0";
  }
}

function emitNestedToProto(
  buf: string[],
  f: FieldSchema,
  alias: string,
  typeMap: Map<string, TypeSchema>,
  emitted: Set<string>,
  globalEmitted: Set<string>,
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

  if (isSpecialType(msgName)) return;
  if ((f.oneofGroup ?? "") !== "") {
    // A oneof member's own conversion is inlined by emitOneofMemberToProto;
    // its message-typed FIELDS still need their converters — descend without
    // emitting.
    const descendKey = msgName + "_oneofDescend";
    if (emitted.has(descendKey)) return;
    emitted.add(descendKey);
    const ts = typeMap.get(msgName);
    if (ts !== undefined) {
      for (const field of ts.fields) {
        emitNestedToProto(buf, field, alias, typeMap, emitted, globalEmitted);
      }
    }
    return;
  }

  const toProtoKey = msgName + "_toProto";
  if (emitted.has(toProtoKey)) return;

  const ts = typeMap.get(msgName);
  if (ts === undefined) return;
  emitted.add(toProtoKey);

  if (globalEmitted.has(toProtoKey)) {
    for (const field of ts.fields) {
      emitNestedToProto(buf, field, alias, typeMap, emitted, globalEmitted);
    }
    return;
  }
  globalEmitted.add(toProtoKey);

  const inputName = msgName + "Input";

  let protoAlias = alias;
  if (ts.protoType !== "") {
    const derivedAlias = protoTypeToPackageAlias(ts.protoType);
    if (derivedAlias !== "") protoAlias = derivedAlias;
  }

  let needsImperative = false;
  for (const field of ts.fields) {
    if (field.type.kind === "struct" || field.type.kind === "value" || field.type.kind === "timestamp") {
      needsImperative = true;
      break;
    }
    if (field.type.kind === "message") {
      needsImperative = true;
      break;
    }
    if (field.type.kind === "array" && (field.type.elementType?.kind === "message" || field.type.elementType?.kind === "struct")) {
      needsImperative = true;
      break;
    }
  }

  if (needsImperative) {
    buf.push(`func (i *${inputName}) toProto() (*${protoAlias}.${msgName}, error) {\n`);
    buf.push(`\tp := &${protoAlias}.${msgName}{}\n`);
    for (const field of ts.fields) {
      const pf = goProtoFieldName(field.protoField);
      if (field.type.kind === "struct") {
        buf.push(`\tif i.${field.name} != nil {\n`);
        buf.push(`\t\tv, err := structFromMap(i.${field.name})\n`);
        buf.push(`\t\tif err != nil {\n\t\t\treturn nil, fieldErr(${goQuote(field.name)}, err)\n\t\t}\n`);
        buf.push(`\t\tp.${pf} = v\n`);
        buf.push("\t}\n");
      } else if (field.type.kind === "value") {
        buf.push(`\tif i.${field.name} != nil {\n`);
        buf.push(`\t\tv, err := valueFromAny(i.${field.name})\n`);
        buf.push(`\t\tif err != nil {\n\t\t\treturn nil, fieldErr(${goQuote(field.name)}, err)\n\t\t}\n`);
        buf.push(`\t\tp.${pf} = v\n`);
        buf.push("\t}\n");
      } else if (field.type.kind === "timestamp") {
        buf.push(`\tif i.${field.name} != "" {\n`);
        buf.push(`\t\tt, err := time.Parse(time.RFC3339, i.${field.name})\n`);
        buf.push(`\t\tif err != nil {\n\t\t\treturn nil, fieldErr(${goQuote(field.name)}, err)\n\t\t}\n`);
        buf.push(`\t\tp.${pf} = timestamppb.New(t)\n`);
        buf.push("\t}\n");
      } else if (field.type.kind === "message") {
        if ((field.oneofGroup ?? "") !== "") {
          emitOneofMemberToProto(buf, field, protoAlias, msgName, "p", typeMap);
          continue;
        }
        if (field.type.messageType === "ApiResourceReference") {
          buf.push(`\tif i.${field.name}.Org != "" || i.${field.name}.Slug != "" {\n`);
          if ((field.referenceKind ?? 0) !== 0) {
            const enumName = apiResourceKindEnumNames.get(field.referenceKind ?? 0) ?? "";
            buf.push(`\t\tref := i.${field.name}.toProto()\n`);
            buf.push(`\t\tref.Kind = apiresourcekind.ApiResourceKind_${enumName}\n`);
            buf.push(`\t\tp.${pf} = ref\n`);
          } else {
            buf.push(`\t\tp.${pf} = i.${field.name}.toProto()\n`);
          }
          buf.push("\t}\n");
        } else {
          buf.push(`\tif i.${field.name} != nil {\n`);
          buf.push(`\t\tv, err := i.${field.name}.toProto()\n`);
          buf.push(`\t\tif err != nil {\n\t\t\treturn nil, fieldErr(${goQuote(field.name)}, err)\n\t\t}\n`);
          buf.push(`\t\tp.${pf} = v\n`);
          buf.push("\t}\n");
        }
      } else if (field.type.kind === "array" && field.type.elementType?.kind === "message") {
        if (field.type.elementType.messageType === "ApiResourceReference" && (field.referenceKind ?? 0) !== 0) {
          const enumName = apiResourceKindEnumNames.get(field.referenceKind ?? 0) ?? "";
          buf.push(`\tfor _, r := range i.${field.name} {\n`);
          buf.push("\t\tref := r.toProto()\n");
          buf.push(`\t\tref.Kind = apiresourcekind.ApiResourceKind_${enumName}\n`);
          buf.push(`\t\tp.${pf} = append(p.${pf}, ref)\n`);
          buf.push("\t}\n");
        } else {
          buf.push(`\tfor idx, item := range i.${field.name} {\n`);
          buf.push("\t\tv, err := item.toProto()\n");
          buf.push(`\t\tif err != nil {\n\t\t\treturn nil, indexErr(${goQuote(field.name)}, idx, err)\n\t\t}\n`);
          buf.push(`\t\tp.${pf} = append(p.${pf}, v)\n`);
          buf.push("\t}\n");
        }
      } else if (field.type.kind === "array" && field.type.elementType?.kind === "struct") {
        buf.push(`\tfor idx, item := range i.${field.name} {\n`);
        buf.push("\t\tv, err := structFromMap(item)\n");
        buf.push(`\t\tif err != nil {\n\t\t\treturn nil, indexErr(${goQuote(field.name)}, idx, err)\n\t\t}\n`);
        buf.push(`\t\tp.${pf} = append(p.${pf}, v)\n`);
        buf.push("\t}\n");
      } else {
        buf.push(`\tp.${pf} = i.${field.name}\n`);
      }
    }
    buf.push("\treturn p, nil\n}\n\n");
  } else {
    // Literal form: nothing here can fail — the error return keeps every
    // schema-derived Input's toProto signature uniform.
    buf.push(`func (i *${inputName}) toProto() (*${protoAlias}.${msgName}, error) {\n`);
    buf.push(`\treturn &${protoAlias}.${msgName}{\n`);
    for (const field of ts.fields) {
      if ((field.oneofGroup ?? "") !== "") continue;
      buf.push(`\t\t${goProtoFieldName(field.protoField)}: i.${field.name},\n`);
    }
    buf.push("\t}, nil\n}\n\n");
  }

  for (const field of ts.fields) {
    emitNestedToProto(buf, field, alias, typeMap, emitted, globalEmitted);
  }
}

// =========================================================================
// FromProto generation — reverse of toProto for CLI/infrastructure use
// =========================================================================

function generateFromProto(
  buf: string[],
  cfg: SdkResourceConfig,
  specSchema: TaskConfigSchema,
  typeMap: Map<string, TypeSchema>,
  alias: string,
  globalEmitted: Set<string>,
): void {
  const inputName = cfg.inputPrefix + "Input";
  const funcName = inputName + "FromProto";

  const specFields = specSchema.fields.filter((f) => !META_FIELD_NAMES.has(f.name));

  const oneofGroups = new Map<string, FieldSchema[]>();
  const regularFields: FieldSchema[] = [];
  for (const f of specFields) {
    const group = f.oneofGroup ?? "";
    if (group !== "") {
      const list = oneofGroups.get(group);
      if (list === undefined) oneofGroups.set(group, [f]);
      else list.push(f);
    } else {
      regularFields.push(f);
    }
  }

  buf.push(`// ${funcName} creates a ${inputName} from a proto ${cfg.protoResType} resource.\n`);
  buf.push(`func ${funcName}(p *${alias}.${cfg.protoResType}) *${inputName} {\n`);
  buf.push(`\tif p == nil {\n\t\treturn &${inputName}{}\n\t}\n`);
  buf.push(`\tinput := &${inputName}{}\n`);

  buf.push("\tif m := p.GetMetadata(); m != nil {\n");
  buf.push("\t\tinput.Id = m.GetId()\n");
  buf.push("\t\tinput.Name = m.GetName()\n");
  buf.push("\t\tinput.Slug = m.GetSlug()\n");
  buf.push("\t\tinput.Org = m.GetOrg()\n");
  buf.push("\t\tinput.Labels = m.GetLabels()\n");
  buf.push("\t\tinput.Visibility = m.GetVisibility()\n");
  buf.push("\t}\n");

  buf.push("\tif s := p.GetSpec(); s != nil {\n");
  for (const f of regularFields) {
    emitFromProtoField(buf, f);
  }
  for (const fields of oneofGroups.values()) {
    emitFromProtoOneof(buf, fields, typeMap);
  }
  buf.push("\t}\n");

  buf.push("\treturn input\n}\n\n");

  const emitted = new Set<string>();
  for (const f of specFields) {
    emitNestedFromProtoFunc(buf, f, alias, typeMap, emitted, globalEmitted);
  }
}

function emitFromProtoField(buf: string[], f: FieldSchema): void {
  const getter = "Get" + goProtoFieldName(f.protoField) + "()";
  const t = f.type;

  if (t.kind === "timestamp") {
    buf.push(`\t\tif ts := s.${getter}; ts != nil {\n`);
    buf.push(`\t\t\tinput.${f.name} = ts.AsTime().Format(time.RFC3339)\n`);
    buf.push("\t\t}\n");
  } else if (t.kind === "struct") {
    buf.push(`\t\tif sv := s.${getter}; sv != nil {\n`);
    buf.push(`\t\t\tinput.${f.name} = sv.AsMap()\n`);
    buf.push("\t\t}\n");
  } else if (t.kind === "value") {
    buf.push(`\t\tif sv := s.${getter}; sv != nil {\n`);
    buf.push(`\t\t\tinput.${f.name} = sv.AsInterface()\n`);
    buf.push("\t\t}\n");
  } else if (
    t.kind === "string" || t.kind === "bool" || t.kind === "int32" ||
    t.kind === "int64" || t.kind === "uint32" || t.kind === "float" ||
    t.kind === "double" || t.kind === "bytes"
  ) {
    buf.push(`\t\tinput.${f.name} = s.${getter}\n`);
  } else if (t.kind === "message" && t.messageType === "EnvironmentSpec") {
    buf.push(`\t\tinput.${f.name} = envSpecInputFromProto(s.${getter})\n`);
  } else if (t.kind === "message" && t.messageType === "ApiResourceReference") {
    buf.push(`\t\tinput.${f.name} = resourceRefFromProto(s.${getter})\n`);
  } else if (t.kind === "message") {
    const converterName = lowerFirst(t.messageType ?? "") + "InputFromProto";
    buf.push(`\t\tinput.${f.name} = ${converterName}(s.${getter})\n`);
  } else if (t.kind === "array" && t.elementType?.kind === "string") {
    buf.push(`\t\tinput.${f.name} = s.${getter}\n`);
  } else if (t.kind === "array" && t.elementType?.kind === "struct") {
    buf.push(`\t\tfor _, item := range s.${getter} {\n`);
    buf.push(`\t\t\tinput.${f.name} = append(input.${f.name}, item.AsMap())\n`);
    buf.push("\t\t}\n");
  } else if (t.kind === "array" && t.elementType?.kind === "message") {
    const elemMsg = t.elementType.messageType ?? "";
    if (elemMsg === "ApiResourceReference") {
      buf.push(`\t\tfor _, r := range s.${getter} {\n`);
      buf.push(`\t\t\tinput.${f.name} = append(input.${f.name}, resourceRefFromProto(r))\n`);
      buf.push("\t\t}\n");
    } else {
      const converterName = lowerFirst(elemMsg) + "InputFromProto";
      buf.push(`\t\tfor _, item := range s.${getter} {\n`);
      buf.push(`\t\t\tinput.${f.name} = append(input.${f.name}, ${converterName}(item))\n`);
      buf.push("\t\t}\n");
    }
  } else if (t.kind === "map") {
    if (t.valueType?.kind === "message") {
      const elemMsg = t.valueType.messageType ?? "";
      if (elemMsg === "ExecutionValue") {
        buf.push(`\t\tif len(s.${getter}) > 0 {\n`);
        buf.push(`\t\t\tinput.${f.name} = make(map[string]EnvVarInput, len(s.${getter}))\n`);
        buf.push(`\t\t\tfor k, v := range s.${getter} {\n`);
        buf.push(`\t\t\t\tinput.${f.name}[k] = EnvVarInput{Value: v.GetValue(), IsSecret: v.GetIsSecret()}\n`);
        buf.push("\t\t\t}\n\t\t}\n");
      } else if (elemMsg === "EnvironmentValue") {
        buf.push(`\t\tif len(s.${getter}) > 0 {\n`);
        buf.push(`\t\t\tinput.${f.name} = make(map[string]EnvVarInput, len(s.${getter}))\n`);
        buf.push(`\t\t\tfor k, v := range s.${getter} {\n`);
        buf.push(`\t\t\t\tinput.${f.name}[k] = EnvVarInput{Value: v.GetValue(), IsSecret: v.GetIsSecret(), Description: v.GetDescription()}\n`);
        buf.push("\t\t\t}\n\t\t}\n");
      } else {
        const converterName = lowerFirst(elemMsg) + "InputFromProto";
        const goType = elemMsg + "Input";
        buf.push(`\t\tif len(s.${getter}) > 0 {\n`);
        buf.push(`\t\t\tinput.${f.name} = make(map[string]*${goType}, len(s.${getter}))\n`);
        buf.push(`\t\t\tfor k, v := range s.${getter} {\n`);
        buf.push(`\t\t\t\tinput.${f.name}[k] = ${converterName}(v)\n`);
        buf.push("\t\t\t}\n\t\t}\n");
      }
    } else {
      buf.push(`\t\tinput.${f.name} = s.${getter}\n`);
    }
  } else {
    buf.push(`\t\tinput.${f.name} = s.${getter}\n`);
  }
}

// Each set oneof member converts through the member type's own generated
// converter — one converter, two callers (project DD-017).
function emitFromProtoOneof(buf: string[], fields: FieldSchema[], typeMap: Map<string, TypeSchema>): void {
  for (const f of fields) {
    const protoField = goProtoFieldName(f.protoField);
    const msgType = f.type.messageType ?? "";

    if (!typeMap.has(msgType)) continue;

    buf.push(`\t\tif ov := s.Get${protoField}(); ov != nil {\n`);
    buf.push(`\t\t\tinput.${f.name} = ${lowerFirst(msgType)}InputFromProto(ov)\n`);
    buf.push("\t\t}\n");
  }
}

function emitNestedFromProtoFunc(
  buf: string[],
  f: FieldSchema,
  alias: string,
  typeMap: Map<string, TypeSchema>,
  emitted: Set<string>,
  globalEmitted: Set<string>,
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

  if (isSpecialType(msgName)) return;

  const fromProtoKey = msgName + "_fromProto";
  if (emitted.has(fromProtoKey) || globalEmitted.has(fromProtoKey)) return;
  emitted.add(fromProtoKey);
  globalEmitted.add(fromProtoKey);

  const ts = typeMap.get(msgName);
  if (ts === undefined) return;

  const inputName = msgName + "Input";
  const funcName = lowerFirst(msgName) + "InputFromProto";

  let protoAlias = alias;
  if (ts.protoType !== "") {
    const derivedAlias = protoTypeToPackageAlias(ts.protoType);
    if (derivedAlias !== "") protoAlias = derivedAlias;
  }

  buf.push(`func ${funcName}(p *${protoAlias}.${msgName}) *${inputName} {\n`);
  buf.push("\tif p == nil {\n\t\treturn nil\n\t}\n");
  buf.push(`\tinput := &${inputName}{}\n`);

  for (const field of ts.fields) {
    const pf = goProtoFieldName(field.protoField);
    const getter = "Get" + pf + "()";
    const ft = field.type;

    if (ft.kind === "timestamp") {
      buf.push(`\tif ts := p.${getter}; ts != nil {\n`);
      buf.push(`\t\tinput.${field.name} = ts.AsTime().Format(time.RFC3339)\n`);
      buf.push("\t}\n");
    } else if (ft.kind === "struct") {
      buf.push(`\tif sv := p.${getter}; sv != nil {\n`);
      buf.push(`\t\tinput.${field.name} = sv.AsMap()\n`);
      buf.push("\t}\n");
    } else if (ft.kind === "value") {
      buf.push(`\tif sv := p.${getter}; sv != nil {\n`);
      buf.push(`\t\tinput.${field.name} = sv.AsInterface()\n`);
      buf.push("\t}\n");
    } else if (ft.kind === "message" && ft.messageType === "ApiResourceReference") {
      buf.push(`\tinput.${field.name} = resourceRefFromProto(p.${getter})\n`);
    } else if (ft.kind === "message") {
      const converter = lowerFirst(ft.messageType ?? "") + "InputFromProto";
      buf.push(`\tinput.${field.name} = ${converter}(p.${getter})\n`);
    } else if (ft.kind === "array" && ft.elementType?.kind === "message") {
      const elemMsg = ft.elementType.messageType ?? "";
      if (elemMsg === "ApiResourceReference") {
        buf.push(`\tfor _, r := range p.${getter} {\n`);
        buf.push(`\t\tinput.${field.name} = append(input.${field.name}, resourceRefFromProto(r))\n`);
        buf.push("\t}\n");
      } else {
        const converter = lowerFirst(elemMsg) + "InputFromProto";
        buf.push(`\tfor _, item := range p.${getter} {\n`);
        buf.push(`\t\tinput.${field.name} = append(input.${field.name}, ${converter}(item))\n`);
        buf.push("\t}\n");
      }
    } else if (ft.kind === "array" && ft.elementType?.kind === "struct") {
      buf.push(`\tfor _, item := range p.${getter} {\n`);
      buf.push(`\t\tinput.${field.name} = append(input.${field.name}, item.AsMap())\n`);
      buf.push("\t}\n");
    } else if (ft.kind === "array" && ft.elementType?.kind === "string") {
      buf.push(`\tinput.${field.name} = p.${getter}\n`);
    } else if (ft.kind === "map") {
      buf.push(`\tinput.${field.name} = p.${getter}\n`);
    } else {
      buf.push(`\tinput.${field.name} = p.${getter}\n`);
    }
  }

  buf.push("\treturn input\n}\n\n");

  for (const field of ts.fields) {
    emitNestedFromProtoFunc(buf, field, alias, typeMap, emitted, globalEmitted);
  }
}

function lowerFirst(s: string): string {
  if (s === "") return s;
  return s.slice(0, 1).toLowerCase() + s.slice(1);
}

// =========================================================================
// Generated client.go (internal/gen/client.go)
// =========================================================================

function generateGenClientFile(outputDir: string, resources: GoResourceGenInfo[]): void {
  const buf: string[] = [];
  buf.push("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n");
  buf.push("package gen\n\n");
  buf.push('import "google.golang.org/grpc"\n\n');

  buf.push("// Client aggregates all resource-specific sub-clients.\n");
  buf.push("type Client struct {\n");
  for (const r of resources) {
    const fieldName = r.clientName.endsWith("Client") ? r.clientName.slice(0, -"Client".length) : r.clientName;
    buf.push(`\t${fieldName} *${r.clientName}\n`);
  }
  buf.push("}\n\n");

  buf.push("// NewClient creates a Client with all resource sub-clients wired to the given connection.\n");
  buf.push("func NewClient(conn grpc.ClientConnInterface) *Client {\n");
  buf.push("\treturn &Client{\n");
  for (const r of resources) {
    const fieldName = r.clientName.endsWith("Client") ? r.clientName.slice(0, -"Client".length) : r.clientName;
    buf.push(`\t\t${fieldName}: New${r.clientName}(conn),\n`);
  }
  buf.push("\t}\n}\n");

  fs.writeFileSync(path.join(outputDir, "client.go"), gofmt(buf.join(""), "client.go"));
}

// =========================================================================
// Generated types.go (sdk root package)
// =========================================================================

// Resource clients whose exported alias is deliberately NOT emitted into
// the sdk-root types.go — a hand-written wrapper at the sdk root takes the
// exported name (stigmer/stigmer#716). The value is the comment block
// emitted in the alias's place.
const HAND_WRITTEN_CLIENT_WRAPPERS = new Map<string, string>([
  [
    "SkillClient",
    "// SkillClient is NOT aliased here: the handwritten wrapper in skill.go\n" +
      "// (push routing over the artifact transfer lane, #675) takes the name so\n" +
      "// client.Skill and the exported type agree.\n",
  ],
]);

function generateSDKTypesFile(sdkRootDir: string, resources: GoResourceGenInfo[]): void {
  const buf: string[] = [];
  buf.push("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n");
  buf.push("package stigmer\n\n");
  buf.push('import "github.com/stigmer/stigmer/sdk/go/v3/internal/gen"\n\n');

  buf.push("// Resource clients -- one per API resource.\n");
  for (const r of resources) {
    const comment = HAND_WRITTEN_CLIENT_WRAPPERS.get(r.clientName);
    if (comment !== undefined) {
      buf.push("\n" + comment);
      continue;
    }
    buf.push(`type ${r.clientName} = gen.${r.clientName}\n`);
  }
  buf.push("\n");

  const hasInputTypes = resources.some((r) => r.inputTypes.length > 0);
  if (hasInputTypes) {
    buf.push("// Input types for resource mutation (Create, Update, Apply).\n");
    for (const r of resources) {
      for (const t of r.inputTypes) {
        buf.push(`type ${t} = gen.${t}\n`);
      }
    }
    buf.push("\n");
  }

  const hasStreamTypes = resources.some((r) => r.streamTypes.length > 0);
  if (hasStreamTypes) {
    buf.push("// Streaming types.\n");
    for (const r of resources) {
      for (const t of r.streamTypes) {
        buf.push(`type ${t} = gen.${t}\n`);
      }
    }
    buf.push("\n");
  }

  buf.push("// Shared SDK types.\n");
  buf.push("type DeleteResourceInput = gen.DeleteResourceInput\n");
  buf.push("type ResourceRef = gen.ResourceRef\n");
  buf.push("type Page = gen.Page\n");
  buf.push("type ListParams = gen.ListParams\n");
  buf.push("type ListResult = gen.ListResult\n");
  buf.push("type EnvSpecInput = gen.EnvSpecInput\n");
  buf.push("type EnvVarInput = gen.EnvVarInput\n");

  fs.writeFileSync(path.join(sdkRootDir, "types.go"), gofmt(buf.join(""), "types.go"));
}

// =========================================================================
// Generated from_proto.go (sdk root package)
// =========================================================================

function generateSDKFromProtoFile(sdkRootDir: string, resources: GoResourceGenInfo[]): void {
  const hasFromProto = resources.some((r) => r.fromProto !== null);
  if (!hasFromProto) return;

  const buf: string[] = [];
  buf.push("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n");
  buf.push("package stigmer\n\n");

  buf.push("import (\n");
  buf.push('\t"github.com/stigmer/stigmer/sdk/go/v3/internal/gen"\n');
  for (const r of resources) {
    if (r.fromProto !== null) {
      buf.push(`\t${r.fromProto.protoAlias} ${goQuote(r.fromProto.protoPath)}\n`);
    }
  }
  buf.push(")\n\n");

  for (const r of resources) {
    if (r.fromProto === null) continue;
    const fp = r.fromProto;
    buf.push(`// ${fp.funcName} creates a ${fp.inputType} from a proto ${fp.protoType} resource.\n`);
    buf.push(`func ${fp.funcName}(p *${fp.protoAlias}.${fp.protoType}) *${fp.inputType} {\n`);
    buf.push(`\treturn gen.${fp.funcName}(p)\n`);
    buf.push("}\n\n");
  }

  fs.writeFileSync(path.join(sdkRootDir, "from_proto.go"), gofmt(buf.join(""), "from_proto.go"));
}

// =========================================================================
// Static shared files (errors.go, structconv.go, types.go)
// =========================================================================

function generateGenErrors(outputDir: string): void {
  const content =
    "// Code generated by stigmer-codegen. DO NOT EDIT.\n\n" +
    "package gen\n\n" +
    `import (
	"errors"
	"fmt"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// ErrorCode represents a category of SDK error.
type ErrorCode int

const (
	CodeUnknown           ErrorCode = iota
	CodeNotFound
	CodePermissionDenied
	CodeUnauthenticated
	CodeInvalidArgument
	CodeAlreadyExists
	CodeResourceExhausted
	CodeFailedPrecondition
	CodeInternal
	CodeUnavailable
)

// Error is the structured error type returned by all SDK operations.
type Error struct {
	Code     ErrorCode
	Message  string
	GRPCCode codes.Code
}

func (e *Error) Error() string {
	return fmt.Sprintf("stigmer: %s (code=%d)", e.Message, e.GRPCCode)
}

func IsNotFound(err error) bool {
	var sErr *Error
	return errors.As(err, &sErr) && sErr.Code == CodeNotFound
}

func IsUnauthenticated(err error) bool {
	var sErr *Error
	return errors.As(err, &sErr) && sErr.Code == CodeUnauthenticated
}

func IsPermissionDenied(err error) bool {
	var sErr *Error
	return errors.As(err, &sErr) && sErr.Code == CodePermissionDenied
}

// WrapErr is the exported version of wrapErr for use by the parent package.
func WrapErr(err error) error { return wrapErr(err) }

func wrapErr(err error) error {
	if err == nil {
		return nil
	}
	st, ok := status.FromError(err)
	if !ok {
		return err
	}
	return &Error{
		Code:     grpcCodeToSDK(st.Code()),
		Message:  st.Message(),
		GRPCCode: st.Code(),
	}
}

func grpcCodeToSDK(c codes.Code) ErrorCode {
	switch c {
	case codes.NotFound:
		return CodeNotFound
	case codes.PermissionDenied:
		return CodePermissionDenied
	case codes.Unauthenticated:
		return CodeUnauthenticated
	case codes.InvalidArgument:
		return CodeInvalidArgument
	case codes.AlreadyExists:
		return CodeAlreadyExists
	case codes.ResourceExhausted:
		return CodeResourceExhausted
	case codes.FailedPrecondition:
		return CodeFailedPrecondition
	case codes.Internal:
		return CodeInternal
	case codes.Unavailable:
		return CodeUnavailable
	default:
		return CodeUnknown
	}
}
`;
  fs.writeFileSync(path.join(outputDir, "errors.go"), gofmt(content, "errors.go"));
}

function generateGenStructConv(outputDir: string): void {
  const content =
    "// Code generated by stigmer-codegen. DO NOT EDIT.\n\n" +
    "package gen\n\n" +
    `import (
	"encoding/json"
	"fmt"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

// Conversion support for the generated toProto methods.
//
// structpb.NewStruct and structpb.NewValue accept only JSON-native Go
// shapes (map[string]any, []any, scalars). Natural typed values — a
// []map[string]any of outcome objects, a []string of tags — fail the
// direct conversion. The generated toProto methods used to discard that
// error, silently applying an EMPTY field (stigmer/stigmer#342). They now
// normalize-then-error through these helpers: the fast path converts
// directly (byte-identical behavior for every value that already worked),
// the fallback normalizes through a JSON round-trip (encoding/json
// semantics, which Go callers already know), and only values JSON cannot
// represent (channels, funcs, cycles) surface an error.
//
// tools/codegen/generator/main.go emits this same JSON normalization for
// the task-config builder DSL — keep the two conversion behaviors
// converged.

// structFromMap converts a struct-kind input field to structpb.Struct,
// normalizing structpb-unsupported (but JSON-representable) values.
func structFromMap(m map[string]any) (*structpb.Struct, error) {
	if s, err := structpb.NewStruct(m); err == nil {
		return s, nil
	}
	data, err := json.Marshal(m)
	if err != nil {
		return nil, err
	}
	var normalized map[string]any
	if err := json.Unmarshal(data, &normalized); err != nil {
		return nil, err
	}
	return structpb.NewStruct(normalized)
}

// valueFromAny converts a value-kind input field to structpb.Value,
// normalizing structpb-unsupported (but JSON-representable) values.
func valueFromAny(v any) (*structpb.Value, error) {
	if val, err := structpb.NewValue(v); err == nil {
		return val, nil
	}
	data, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var normalized any
	if err := json.Unmarshal(data, &normalized); err != nil {
		return nil, err
	}
	return structpb.NewValue(normalized)
}

// fieldErr, indexErr, and keyErr compose the input-field path onto a
// conversion failure as it propagates up the nested toProto chain, so the
// final message locates the offending value exactly:
//
//	Tasks[2]: TaskConfig: json: unsupported type: chan int
func fieldErr(field string, err error) error {
	return fmt.Errorf("%s: %w", field, err)
}

func indexErr(field string, idx int, err error) error {
	return fmt.Errorf("%s[%d]: %w", field, idx, err)
}

func keyErr(field, key string, err error) error {
	return fmt.Errorf("%s[%q]: %w", field, key, err)
}

// invalidInputErr wraps a toProto conversion failure as the SDK's
// structured *Error with CodeInvalidArgument: a value the SDK refuses
// client-side surfaces exactly like a value the server would have refused,
// so callers handle both through one errors.As path.
func invalidInputErr(err error) error {
	return &Error{
		Code:     CodeInvalidArgument,
		Message:  err.Error(),
		GRPCCode: codes.InvalidArgument,
	}
}
`;
  fs.writeFileSync(path.join(outputDir, "structconv.go"), gofmt(content, "structconv.go"));
}

function generateGenTypes(outputDir: string): void {
  const content =
    "// Code generated by stigmer-codegen. DO NOT EDIT.\n\n" +
    "package gen\n\n" +
    `import (
	environmentv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/environment/v1"
	searchv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/search/v1"
	apiresource "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/apiresource/apiresourcekind"
)

// DeleteResourceInput provides arguments for deleting a resource.
type DeleteResourceInput struct {
	ResourceID     string
	VersionMessage string
	Force          bool
}

// ResourceRef identifies an API resource by org, slug, and optional version.
type ResourceRef struct {
	Org     string
	Slug    string
	Version string
	Kind    apiresourcekind.ApiResourceKind
}

func (r ResourceRef) toProto() *apiresource.ApiResourceReference {
	return &apiresource.ApiResourceReference{
		Org:     r.Org,
		Slug:    r.Slug,
		Version: r.Version,
		Kind:    r.Kind,
	}
}

// Page specifies offset-based pagination.
type Page struct {
	Num  int32
	Size int32
}

// ListParams configures a SearchService-backed list query.
type ListParams struct {
	Org            string
	Query          string
	ExcludePublic  bool
	CrossOrgPublic bool
	Page           *Page
}

// ListResult holds the response from a SearchService-backed list.
type ListResult struct {
	Entries    []*searchv1.SearchResult
	TotalCount int32
	TotalPages int32
}

// EnvSpecInput describes environment variables and secrets for a resource.
type EnvSpecInput struct {
	Variables map[string]EnvVarInput
}

// EnvVarInput describes a single environment variable.
type EnvVarInput struct {
	Value       string
	IsSecret    bool
	Description string
}

func (e *EnvSpecInput) toProto() *environmentv1.EnvironmentSpec {
	spec := &environmentv1.EnvironmentSpec{
		Data: make(map[string]*environmentv1.EnvironmentValue, len(e.Variables)),
	}
	for name, v := range e.Variables {
		spec.Data[name] = &environmentv1.EnvironmentValue{
			Value:       v.Value,
			IsSecret:    v.IsSecret,
			Description: v.Description,
		}
	}
	return spec
}

// ResourceRefFromProto creates a ResourceRef from a proto ApiResourceReference.
func ResourceRefFromProto(r *apiresource.ApiResourceReference) ResourceRef {
	if r == nil {
		return ResourceRef{}
	}
	return ResourceRef{
		Org:     r.GetOrg(),
		Slug:    r.GetSlug(),
		Version: r.GetVersion(),
		Kind:    r.GetKind(),
	}
}

func resourceRefFromProto(r *apiresource.ApiResourceReference) ResourceRef {
	return ResourceRefFromProto(r)
}

// EnvSpecInputFromProto creates an EnvSpecInput from a proto EnvironmentSpec.
func EnvSpecInputFromProto(s *environmentv1.EnvironmentSpec) *EnvSpecInput {
	if s == nil {
		return nil
	}
	input := &EnvSpecInput{
		Variables: make(map[string]EnvVarInput, len(s.GetData())),
	}
	for k, v := range s.GetData() {
		input.Variables[k] = EnvVarInput{
			Value:       v.GetValue(),
			IsSecret:    v.GetIsSecret(),
			Description: v.GetDescription(),
		}
	}
	return input
}

func envSpecInputFromProto(s *environmentv1.EnvironmentSpec) *EnvSpecInput {
	return EnvSpecInputFromProto(s)
}
`;
  fs.writeFileSync(path.join(outputDir, "types.go"), gofmt(content, "types.go"));
}
