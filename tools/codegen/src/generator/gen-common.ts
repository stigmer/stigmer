// Shared infrastructure for the Stage 2 emitters: service-schema types,
// naming helpers, the TS import tracker, schema-directory discovery, and
// the Go-parity string quoting the emitted code embeds. Ports of the
// corresponding helpers in the Go generator's main.go / sdk_client.go /
// sdk_client_ts.go / mcp_model.go.

import * as fs from "node:fs";
import * as path from "node:path";

import { goTrimSpace } from "../internalcomment/internalcomment.js";
import type { FieldSchema, TaskConfigSchema, TypeSchema } from "./schema.js";
import { readDirSorted } from "./schema.js";

// ---------------------------------------------------------------------
// Service schema JSON shape (services/*.json)
// ---------------------------------------------------------------------

export interface ServiceSchemaFile {
  resource: string;
  package: string;
  goImportPath: string;
  services: ServiceDefinition[];
  listVia?: string;
  methodTypes?: TypeSchema[];
  enumTypes?: EnumSchema[];
  resourceDescription?: string;
  statusType?: TypeSchema;
  statusNestedTypes?: TypeSchema[];
}

export interface ServiceDefinition {
  name: string;
  role: string;
  protoFile?: string;
  methods: MethodSchema[];
}

export interface MethodSchema {
  name: string;
  inputType: string;
  inputFullType: string;
  outputType: string;
  outputFullType: string;
  serverStreaming?: boolean;
  clientStreaming?: boolean;
  description?: string;
}

export interface EnumSchema {
  name: string;
  description: string;
  protoType: string;
  values: EnumValueSchema[] | null;
}

export interface EnumValueSchema {
  name: string;
  number: number;
  description: string;
}

// ---------------------------------------------------------------------
// Go-parity string helpers
// ---------------------------------------------------------------------

/**
 * Go's strconv.Quote (the %q verb): double-quoted string with backslash
 * escapes. Matches Go byte-for-byte for the printable-ASCII + common
 * whitespace content that flows through the generators; control characters
 * use Go's \xNN form (not JSON's \uNNNN).
 */
export function goQuote(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code === 0x07) out += "\\a";
    else if (code === 0x08) out += "\\b";
    else if (code === 0x0b) out += "\\v";
    else if (code === 0x0c) out += "\\f";
    else if (code < 0x20 || code === 0x7f) out += "\\x" + code.toString(16).padStart(2, "0");
    else out += ch;
  }
  return out + '"';
}

/** Port of sanitizeDescription: newlines → spaces, collapse runs, trim. */
export function sanitizeDescription(desc: string): string {
  desc = desc.replaceAll("\n", " ").replaceAll("\r", " ");
  while (desc.includes("  ")) {
    desc = desc.replaceAll("  ", " ");
  }
  return goTrimSpace(desc);
}

export function lowerFirst(s: string): string {
  if (s.length === 0) return s;
  return s.slice(0, 1).toLowerCase() + s.slice(1);
}

/** Port of toPascalCase (snake_case → PascalCase, rest of parts unchanged). */
export function toPascalCase(s: string): string {
  const parts = s.split("_");
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length > 0) {
      parts[i] = parts[i].slice(0, 1).toUpperCase() + parts[i].slice(1);
    }
  }
  return parts.join("");
}

/** Port of singularize (PascalCase plural → singular). */
export function singularize(name: string): string {
  if (name.endsWith("ies")) return name.slice(0, -3) + "y";
  if (name.endsWith("ses")) return name.slice(0, -2);
  if (name.endsWith("s") && !name.endsWith("ss")) return name.slice(0, -1);
  return name;
}

/** Port of pascalToSnake (ASCII uppercase boundaries). */
export function pascalToSnake(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (i > 0 && ch >= "A" && ch <= "Z") out += "_";
    out += ch.toLowerCase();
  }
  return out;
}

export function isSpecialType(name: string): boolean {
  return (
    name === "EnvironmentSpec" ||
    name === "EnvironmentValue" ||
    name === "ExecutionValue" ||
    name === "ApiResourceReference"
  );
}

export function isEmptyType(fullType: string): boolean {
  return fullType === "google.protobuf.Empty";
}

export function isIDType(typeName: string): boolean {
  return typeName.endsWith("Id") || typeName.endsWith("ID");
}

// Search-list kinds expose a single list(ListParams); a typed List RPC on
// the kind's own query controller would collide on the method name.
export function searchListSupersedesMethod(schema: ServiceSchemaFile, m: MethodSchema): boolean {
  return schema.listVia === "SearchService" && m.name.toLowerCase() === "list";
}

/** Port of protoTypeName: final segment of a fully-qualified proto type. */
export function protoTypeName(protoType: string): string {
  const parts = protoType.split(".");
  return parts[parts.length - 1];
}

/**
 * Go import path for a proto type's package under the given module prefix
 * (port of protoTypeToGoImportPath).
 */
export function protoTypeToGoImportPath(protoType: string, prefix: string): string {
  const parts = protoType.split(".");
  if (parts.length < 4) return "";
  return prefix + "/" + parts.slice(0, -1).join("/");
}

/**
 * Go package alias for a proto type (port of protoTypeToPackageAlias):
 * "ai.stigmer.agentic.agent.v1.X" → "agentv1";
 * "ai.stigmer.commons.apiresource.X" → "apiresource".
 */
export function protoTypeToPackageAlias(protoType: string): string {
  const parts = protoType.split(".");
  if (parts.length < 4) return "";
  if (parts.length >= 5 && parts[parts.length - 2].startsWith("v")) {
    return parts[parts.length - 3] + parts[parts.length - 2];
  }
  return parts[parts.length - 2];
}

/** Go proto struct field name (port of goProtoFieldName, with overrides). */
export function goProtoFieldName(protoField: string): string {
  const parts = protoField.split("_");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length > 0) {
      parts[i] = p.slice(0, 1).toUpperCase() + p.slice(1);
    }
    switch (p.toLowerCase()) {
      case "url":
        parts[i] = "Url";
        break;
      case "id":
        parts[i] = "Id";
        break;
      case "md":
        parts[i] = "Md";
        break;
      case "usd":
        parts[i] = "Usd";
        break;
    }
  }
  return parts.join("");
}

/** Proto package of a fully-qualified type (all but the final segment). */
export function tsProtoPkg(protoType: string): string {
  const parts = protoType.split(".");
  if (parts.length < 2) return protoType;
  return parts.slice(0, -1).join(".");
}

// ---------------------------------------------------------------------
// TS naming helpers
// ---------------------------------------------------------------------

/** "ai.stigmer.agentic.agent.v1" → "@stigmer/protos/ai/stigmer/agentic/agent/v1". */
export function deriveTSImportBase(pkg: string): string {
  return "@stigmer/protos/" + pkg.replaceAll(".", "/");
}

/** snake_case → camelCase (first part unchanged). */
export function tsProtoFieldName(protoField: string): string {
  const parts = protoField.split("_");
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].length > 0) {
      parts[i] = parts[i].slice(0, 1).toUpperCase() + parts[i].slice(1);
    }
  }
  return parts.join("");
}

const TS_CLIENT_FIELD_NAMES = new Map<string, string>([
  ["agentchannel", "agentChannel"],
  ["agentexecution", "agentExecution"],
  ["agentinstance", "agentInstance"],
  ["agentshare", "agentShare"],
  ["executioncontext", "executionContext"],
  ["mcpserver", "mcpServer"],
  ["workflowexecution", "workflowExecution"],
  ["workflowinstance", "workflowInstance"],
  ["identityaccount", "identityAccount"],
  ["identityprovider", "identityProvider"],
  ["iampolicy", "iamPolicy"],
  ["apikey", "apiKey"],
]);

export function tsClientFieldName(resource: string): string {
  return TS_CLIENT_FIELD_NAMES.get(resource) ?? resource;
}

/** "apis/.../spec.proto" → "spec_pb". */
export function tsProtoFileToSuffix(protoFile: string): string {
  const base = path.basename(protoFile);
  const name = base.endsWith(".proto") ? base.slice(0, -".proto".length) : base;
  return name + "_pb";
}

export function tsServiceImportSuffix(svc: ServiceDefinition): string {
  if (svc.protoFile !== undefined && svc.protoFile !== "") {
    return tsProtoFileToSuffix(svc.protoFile);
  }
  return svc.role + "_pb";
}

// Root of the proto API definitions; the enum.proto existence probe below
// is CWD-relative, so the generator must run from the repo root (as the Go
// generator did).
export const tsApisDir = "apis";

/**
 * Resolve the import for an enum type: enum_pb when the package has a
 * dedicated enum.proto on disk, spec_pb otherwise.
 */
export function tsResolveEnumImport(enumFullType: string): [importFrom: string, enumName: string] {
  const parts = enumFullType.split(".");
  const enumName = parts[parts.length - 1];
  const enumPkg = parts.slice(0, -1).join(".");
  const importBase = deriveTSImportBase(enumPkg);

  let suffix = "spec_pb";
  const pkgPath = enumPkg.replaceAll(".", "/");
  if (fs.existsSync(path.join(tsApisDir, pkgPath, "enum.proto"))) {
    suffix = "enum_pb";
  }
  return [importBase + "/" + suffix, enumName];
}

// Root of the generated protobuf-es TypeScript stubs, scanned to find an
// enum's actual _pb file (e.g. the workflow task enums live in common_pb,
// which the package heuristic cannot infer).
export const tsStubsDir = "apis/stubs/ts";

/**
 * Resolve an enum import by scanning the generated stubs for the
 * `export enum <Name>` declaration; falls back to the package heuristic.
 */
export function tsResolveEnumImportSmart(enumFullType: string): [importFrom: string, enumName: string] {
  const parts = enumFullType.split(".");
  const enumName = parts[parts.length - 1];
  const pkg = parts.slice(0, -1).join(".");
  const pkgPath = pkg.replaceAll(".", "/");
  const dir = path.join(tsStubsDir, pkgPath);

  let entries: fs.Dirent[];
  try {
    entries = readDirSorted(dir);
  } catch {
    return tsResolveEnumImport(enumFullType);
  }
  const needle = "export enum " + enumName;
  for (const e of entries) {
    if (e.isDirectory() || !e.name.endsWith("_pb.ts")) continue;
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, e.name), "utf8");
    } catch {
      continue;
    }
    const idx = text.indexOf(needle);
    if (idx < 0) continue;
    // Confirm a real declaration boundary, not a longer shared prefix.
    const next = idx + needle.length;
    if (next < text.length && (text[next] === " " || text[next] === "{" || text[next] === "\n")) {
      const suffix = e.name.slice(0, -".ts".length);
      return [deriveTSImportBase(pkg) + "/" + suffix, enumName];
    }
  }
  return tsResolveEnumImport(enumFullType);
}

export function isCommonsType(fullType: string): boolean {
  return fullType.startsWith("ai.stigmer.commons.");
}

const COMMONS_TYPE_FILES = new Map<string, string>([
  ["ApiResourceAuditActor", "status_pb"],
  ["ApiResourceAudit", "status_pb"],
  ["ApiResourceMetadata", "metadata_pb"],
]);

export function tsResolveCommonsImport(typeName: string, fullType: string): string {
  const parts = fullType.split(".");
  const typePkg = parts.slice(0, -1).join(".");
  const importBase = deriveTSImportBase(typePkg);
  const file = COMMONS_TYPE_FILES.get(typeName);
  return file !== undefined ? importBase + "/" + file : importBase + "/io_pb";
}

export function tsMethodName(name: string): string {
  if (name.length === 0) return name;
  return name.slice(0, 1).toLowerCase() + name.slice(1);
}

/** Quote an object key only when it is not a valid bare identifier. */
export function tsObjectKey(k: string): string {
  for (let i = 0; i < k.length; i++) {
    const r = k[i];
    const ok =
      r === "_" ||
      (r >= "a" && r <= "z") ||
      (r >= "A" && r <= "Z") ||
      (i > 0 && r >= "0" && r <= "9");
    if (!ok) return goQuote(k);
  }
  return k;
}

export function tsMemberAccess(k: string): string {
  return tsObjectKey(k) === k ? k : "[" + goQuote(k) + "]";
}

/** proto3 optional synthetic oneofs are prefixed with "_". */
export function isSyntheticOneof(group: string): boolean {
  return group.startsWith("_");
}

// ---------------------------------------------------------------------
// TS import tracking (port of tsImportSet)
// ---------------------------------------------------------------------

interface TsImport {
  values: string[];
  typeValues: string[];
}

export class TsImportSet {
  private readonly imports = new Map<string, TsImport>();

  addValue(from: string, name: string): void {
    let imp = this.imports.get(from);
    if (imp === undefined) {
      imp = { values: [], typeValues: [] };
      this.imports.set(from, imp);
    }
    if (imp.values.includes(name)) return;
    imp.values.push(name);
  }

  addType(from: string, name: string): void {
    let imp = this.imports.get(from);
    if (imp === undefined) {
      imp = { values: [], typeValues: [] };
      this.imports.set(from, imp);
    }
    if (imp.values.includes(name) || imp.typeValues.includes(name)) return;
    imp.typeValues.push(name);
  }

  /**
   * Emit import lines: module specifiers sorted lexically, names within a
   * module in insertion order (values first, then type imports) — the exact
   * ordering baked into the committed files.
   */
  emit(buf: string[]): void {
    const sources = [...this.imports.keys()].sort();
    for (const from of sources) {
      const imp = this.imports.get(from)!;
      const parts = [...imp.values, ...imp.typeValues.map((v) => "type " + v)];
      if (parts.length === 0) continue;
      buf.push(`import { ${parts.join(", ")} } from ${goQuote(tsModuleSpecifier(from))};\n`);
    }
    buf.push("\n");
  }
}

// Relative specifiers get an explicit ".js" extension so the generated ESM
// resolves under plain Node (DD-018); package specifiers pass through.
export function tsModuleSpecifier(from: string): string {
  if (from.startsWith("./") || from.startsWith("../")) {
    if (!from.endsWith(".js")) return from + ".js";
  }
  return from;
}

// ---------------------------------------------------------------------
// Schema-directory discovery (ports of discoverDomains / indexSatellites /
// Generator.loadSchemas / detectExpandStructFromSchema)
// ---------------------------------------------------------------------

export interface SatelliteDir {
  path: string;
  schemas: TaskConfigSchema[];
  types: TypeSchema[];
}

export interface DomainInfo {
  name: string;
  resources: string[];
}

export function discoverDomains(schemaDir: string): [DomainInfo[], string[]] {
  const domains: DomainInfo[] = [];
  const satellites: string[] = [];
  for (const entry of readDirSorted(schemaDir)) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(schemaDir, entry.name);
    let subs: fs.Dirent[];
    try {
      subs = readDirSorted(dirPath);
    } catch {
      continue;
    }
    const resources: string[] = [];
    for (const sub of subs) {
      if (!sub.isDirectory()) continue;
      if (fs.existsSync(path.join(dirPath, sub.name, sub.name + ".json"))) {
        resources.push(sub.name);
      }
    }
    if (resources.length > 0) {
      resources.sort();
      domains.push({ name: entry.name, resources });
    } else {
      satellites.push(dirPath);
    }
  }
  domains.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return [domains, satellites];
}

export function indexSatellites(dirs: string[]): SatelliteDir[] {
  const result: SatelliteDir[] = [];
  for (const dir of dirs) {
    const sat: SatelliteDir = { path: dir, schemas: [], types: [] };
    for (const entry of readDirSorted(dir)) {
      if (entry.isDirectory() || !entry.name.endsWith(".json")) continue;
      try {
        sat.schemas.push(JSON.parse(fs.readFileSync(path.join(dir, entry.name), "utf8")) as TaskConfigSchema);
      } catch {
        continue;
      }
    }
    const typesDir = path.join(dir, "types");
    try {
      for (const entry of readDirSorted(typesDir)) {
        if (entry.isDirectory() || !entry.name.endsWith(".json")) continue;
        try {
          sat.types.push(JSON.parse(fs.readFileSync(path.join(typesDir, entry.name), "utf8")) as TypeSchema);
        } catch {
          continue;
        }
      }
    } catch {
      // types dir is optional
    }
    result.push(sat);
  }
  return result;
}

/** Port of expandStructConfig. */
export interface ExpandStructConfig {
  structField: string;
  discriminatorField: string;
  configSchemaDir: string;
  configs: TaskConfigSchema[];
  configTypes: TypeSchema[];
  kindToEnum: Map<string, string>;
}

/** Port of the Generator schema loader for one resource directory. */
export interface LoadedSchemas {
  schemaDir: string;
  taskConfigs: TaskConfigSchema[];
  sharedTypes: TypeSchema[];
  expandStruct: ExpandStructConfig | null;
}

function extractDomainFromProtoType(protoType: string): string {
  const parts = protoType.split(".");
  if (parts.length >= 3 && parts[0] === "ai" && parts[1] === "stigmer") {
    return parts[2];
  }
  return "unknown";
}

export function loadResourceSchemas(schemaDir: string): LoadedSchemas {
  const loaded: LoadedSchemas = { schemaDir, taskConfigs: [], sharedTypes: [], expandStruct: null };

  const tasksDir = path.join(schemaDir, "tasks");
  const configDir = fs.existsSync(tasksDir) ? tasksDir : schemaDir;
  for (const entry of readDirSorted(configDir)) {
    if (entry.isDirectory() || !entry.name.endsWith(".json")) continue;
    loaded.taskConfigs.push(
      JSON.parse(fs.readFileSync(path.join(configDir, entry.name), "utf8")) as TaskConfigSchema,
    );
  }

  const loadedTypes = new Set<string>();
  for (const typesDir of [path.join(schemaDir, "types"), path.join(schemaDir, "tasks", "types")]) {
    if (!fs.existsSync(typesDir)) continue;
    for (const entry of readDirSorted(typesDir)) {
      if (entry.isDirectory() || !entry.name.endsWith(".json")) continue;
      const schema = JSON.parse(fs.readFileSync(path.join(typesDir, entry.name), "utf8")) as TypeSchema;
      if (loadedTypes.has(schema.name)) continue;
      loadedTypes.add(schema.name);
      schema.domain = extractDomainFromProtoType(schema.protoType);
      loaded.sharedTypes.push(schema);
    }
  }

  if (loaded.taskConfigs.length === 0 && loaded.sharedTypes.length === 0) {
    throw new Error(`no schemas found in ${schemaDir}`);
  }
  return loaded;
}

/** Port of detectExpandStructFromSchema. */
export function detectExpandStructFromSchema(gen: LoadedSchemas, satellites: SatelliteDir[]): void {
  for (const typ of gen.sharedTypes) {
    let structField: FieldSchema | undefined;
    let discriminatorField: FieldSchema | undefined;
    for (const f of typ.fields) {
      if (f.discriminatedBy !== undefined && f.discriminatedBy !== "") {
        structField = f;
      }
      if (f.type.kind === "string" && (f.type.enumValues?.length ?? 0) > 0) {
        discriminatorField = f;
      }
    }
    if (structField === undefined || discriminatorField === undefined) continue;
    if (structField.discriminatedBy !== discriminatorField.protoField) continue;

    const enumSet = new Set(discriminatorField.type.enumValues ?? []);

    for (const sat of satellites) {
      let matchCount = 0;
      for (const s of sat.schemas) {
        if (s.discriminatorValue !== undefined && s.discriminatorValue !== "" && enumSet.has(s.discriminatorValue)) {
          matchCount++;
        }
      }
      if (matchCount === 0) continue;

      const kindToEnum = new Map<string, string>();
      for (const s of sat.schemas) {
        if (s.discriminatorValue !== undefined && s.discriminatorValue !== "") {
          kindToEnum.set(s.kind ?? "", s.discriminatorValue);
        }
      }
      gen.expandStruct = {
        structField: structField.protoField,
        discriminatorField: discriminatorField.protoField,
        configSchemaDir: sat.path,
        configs: sat.schemas,
        configTypes: sat.types,
        kindToEnum,
      };
      return;
    }
  }
}
