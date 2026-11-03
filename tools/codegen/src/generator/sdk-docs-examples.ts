// The code examples on the SDK resource reference pages, written as each
// SDK takes them. A method's input is one of three things: an id, an
// input type the SDK declares (AgentInput, ResourceRef,
// DeleteResourceInput), or a protobuf message the SDK passes through
// (agentv1.GetAgentVersionInput). The SDK types are named as each SDK
// exports them; a protobuf message is named through the client
// generators' own resolvers (Go `resolveType`, Python
// `pyMethodTypePb2Prefix`, Java `resolveJavaFQCN`), so an example cannot
// name a type the SDK lacks or a module it does not import from.
//
// Every value an example passes is a literal of its field's type: an
// enum's first named value, `0n` for a 64-bit integer in TypeScript, empty
// bytes, an empty list or map of the element type. An example names no
// value the page does not show: ids are literal, and the only names it
// takes as given are the client every page uses (`stigmer` in
// TypeScript, `client` and Go's `ctx` elsewhere).
//
// While the examples are written, `DocImports` gathers what they import,
// per language; the page shows it once, in its "Client Access" section,
// as each language's imports block.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { ServiceSchemaFile } from "./gen-common.js";
import {
  hasExplicitPresence,
  isRealOneofMember,
  isValuedOneofScalar,
  isSpecialType,
  protoFileOfMessage,
  protoTypeToGoImportPath,
  protoTypeToPackageAlias,
  tsProtoFieldName,
  tsResolveEnumImportSmart,
} from "./gen-common.js";
import { javaCamel, pyFieldName, pyProtoFileToModule, pyProtoModuleAlias } from "./lang-names.js";
import { goSDKEnumGoType, goTypeForTypeSpec, resolveType, SDK_PROTO_IMPORT_PREFIX } from "./sdk-client-go.js";
import { resolveJavaFQCN } from "./sdk-client-java.js";
import { pyMethodTypePb2Prefix } from "./sdk-client-python.js";
import type { SdkResourceConfig } from "./sdk-resource-config.js";
import type { FieldSchema, TypeSchema, TypeSpec } from "./schema.js";
import { readDirSorted } from "./schema.js";

/** The four languages a resource page shows. */
export type DocLang = "typescript" | "go" | "python" | "java";

export const DOC_LANGS: readonly DocLang[] = ["typescript", "go", "python", "java"];

/** The Go SDK's module, imported as `stigmer`. */
export const GO_SDK_IMPORT = "go.stigmer.ai/sdk";

/** The Java package of the SDK's own types (AgentInput, ResourceRef). */
export const JAVA_SDK_PACKAGE = "ai.stigmer.sdk.gen";

/** The organization every example's input belongs to. */
export const DOC_EXAMPLE_ORG = "acme";

/** The placeholder every free-text string field shows. */
const PLACEHOLDER = '"..."';

const repoApisDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../apis");

// =========================================================================
// Imports
// =========================================================================

/**
 * What one page's examples import, per language, gathered as they are
 * written. Each method returns the name an example writes, which is the
 * plain name unless it would clash with a name already imported (Java,
 * where two packages can declare one class name); then the example writes
 * the qualified name and nothing is imported for it.
 */
export class DocImports {
  private readonly ts = new Map<string, Set<string>>();
  private readonly go = new Map<string, string>();
  private readonly py = new Map<string, Set<string>>();
  private readonly java = new Map<string, string>();

  /** `name`, imported from TypeScript module `module`. */
  tsName(module: string, name: string): string {
    const names = this.ts.get(module) ?? new Set<string>();
    names.add(name);
    this.ts.set(module, names);
    return name;
  }

  /** The Go package at `importPath`, imported as `alias`. */
  goPackage(alias: string, importPath: string): string {
    const bound = this.go.get(alias);
    if (bound !== undefined && bound !== importPath) {
      throw new Error(`sdk-docs: Go alias ${alias} names both ${bound} and ${importPath}`);
    }
    this.go.set(alias, importPath);
    return alias;
  }

  /** `name` (a module, a class, or `module as alias`), imported from Python package `from`; returns the name bound. */
  pyName(from: string, name: string): string {
    const names = this.py.get(from) ?? new Set<string>();
    names.add(name);
    this.py.set(from, names);
    const as = name.indexOf(" as ");
    return as < 0 ? name : name.slice(as + " as ".length);
  }

  /** The Java class `fqcn`: its simple name, imported, or `fqcn` itself when another class already holds that name. */
  javaType(fqcn: string): string {
    const simple = fqcn.slice(fqcn.lastIndexOf(".") + 1);
    const bound = this.java.get(simple);
    if (bound !== undefined && bound !== fqcn) return fqcn;
    this.java.set(simple, fqcn);
    return simple;
  }

  /** The imports block for `lang`, or null when its examples import nothing. */
  render(lang: DocLang): string | null {
    switch (lang) {
      case "typescript": {
        if (this.ts.size === 0) return null;
        return [...this.ts.keys()]
          .sort(compareStrings)
          .map((module) => `import { ${[...this.ts.get(module)!].sort(compareStrings).join(", ")} } from "${module}";`)
          .join("\n");
      }
      case "go": {
        if (this.go.size === 0) return null;
        const lines = [...this.go.entries()]
          .sort(([, a], [, b]) => compareStrings(a, b))
          .map(([alias, importPath]) => `\t${alias} "${importPath}"`);
        return `import (\n${lines.join("\n")}\n)`;
      }
      case "python": {
        if (this.py.size === 0) return null;
        // The SDK first, then the protobuf modules, each sorted.
        const sdkFirst = (a: string, b: string): number => {
          const rank = (s: string) => (s === "stigmer" ? 0 : s.startsWith("stigmer.") ? 1 : 2);
          return rank(a) - rank(b) || compareStrings(a, b);
        };
        return [...this.py.keys()]
          .sort(sdkFirst)
          .map((from) => `from ${from} import ${[...this.py.get(from)!].sort(compareStrings).join(", ")}`)
          .join("\n");
      }
      case "java": {
        if (this.java.size === 0) return null;
        return [...this.java.values()]
          .sort(compareStrings)
          .map((fqcn) => `import ${fqcn};`)
          .join("\n");
      }
    }
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// =========================================================================
// What an example is written against
// =========================================================================

/** One resource page's example context: its schema, the types its inputs nest, and the page's imports. */
export interface DocExampleEnv {
  readonly schema: ServiceSchemaFile;
  readonly cfg: SdkResourceConfig;
  /** The nested types of the resource's SDK input, by message name. */
  readonly specTypes: ReadonlyMap<string, TypeSchema>;
  /** The schema's method types, by message name. */
  readonly methodTypes: ReadonlyMap<string, TypeSchema>;
  /** Every method type's Python module (pyMethodTypePb2Map). */
  readonly pyModules: ReadonlyMap<string, string>;
  /** The names the `stigmer` Python package exports; null when every SDK name is taken as exported. */
  readonly pyPublic: ReadonlySet<string> | null;
  readonly imports: DocImports;
}

/** A field an example sets, as the language writes its name, and the value it passes. */
interface Entry {
  readonly name: string;
  readonly value: string;
  /** A trailing comment on the field's line. */
  readonly note?: string;
}

/**
 * The note on a Go example's field with explicit presence (a proto3
 * `optional` scalar) in an SDK input: Go's input holds a plain value, so the
 * example's zero is not sent and reads as unset, unlike the zero the other
 * languages send.
 */
export const GO_PRESENCE_NOTE = "zero is unset: not sent, so the server's default applies";

// =========================================================================
// Names each SDK exports
// =========================================================================

/** The Go SDK package, imported. */
function goSdk(env: DocExampleEnv): string {
  return env.imports.goPackage("stigmer", GO_SDK_IMPORT);
}

/** An SDK type the Python package declares: from `stigmer` when it exports it, else from the generated module. */
function pySdk(env: DocExampleEnv, name: string): string {
  const from = env.pyPublic === null || env.pyPublic.has(name) ? "stigmer" : "stigmer._gen";
  return env.imports.pyName(from, name);
}

/** An SDK type the Java SDK declares. */
function javaSdk(env: DocExampleEnv, name: string): string {
  return env.imports.javaType(`${JAVA_SDK_PACKAGE}.${name}`);
}

/**
 * The names `sdk/python/src/stigmer/__init__.py` exports, read beside the
 * API tree, or null when the file is not there (the generator run outside
 * the repository): then every SDK name is taken as exported.
 */
export function readPythonPublicNames(apisDir: string): ReadonlySet<string> | null {
  if (apisDir === "") return null;
  const init = path.join(path.dirname(path.resolve(apisDir)), "sdk", "python", "src", "stigmer", "__init__.py");
  let text: string;
  try {
    text = fs.readFileSync(init, "utf8");
  } catch {
    return null;
  }
  const names = new Set<string>();
  for (const match of text.matchAll(/^from\s+\S+\s+import\s+(\([^)]*\)|[^\n]*)/gm)) {
    for (const part of match[1].split(/[,\s]+/)) {
      const name = part.replace(/[()]/g, "").trim();
      if (/^[A-Za-z_]\w*$/.test(name) && name !== "as") names.add(name);
    }
  }
  return names;
}

// =========================================================================
// Protobuf names
// =========================================================================

/**
 * protoc's CamelCase of a field name, as Go's struct fields and Java's
 * accessors spell it: each underscore dropped and the next letter raised,
 * and a letter after a digit raised too (`ipv4_address` → `Ipv4Address`).
 */
export function protoCapCamel(protoField: string): string {
  let out = "";
  let raise = true;
  for (const c of protoField) {
    if (c === "_") {
      raise = true;
      continue;
    }
    if (c >= "0" && c <= "9") {
      out += c;
      raise = true;
      continue;
    }
    out += raise ? c.toUpperCase() : c;
    raise = false;
  }
  return out;
}

/** The `.proto` file under `apis/` that declares top-level enum `fullType`, or null when none does. */
function protoFileOfEnum(fullType: string): string | null {
  const idx = fullType.lastIndexOf(".");
  const pkgPath = fullType.slice(0, idx).replaceAll(".", "/");
  const needle = new RegExp("^enum " + fullType.slice(idx + 1) + " \\{", "m");
  let entries: fs.Dirent[];
  try {
    entries = readDirSorted(path.join(repoApisDir, pkgPath));
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isDirectory() || !e.name.endsWith(".proto")) continue;
    if (needle.test(fs.readFileSync(path.join(repoApisDir, pkgPath, e.name), "utf8"))) {
      return path.posix.join("apis", pkgPath, e.name);
    }
  }
  return null;
}

/** The package of a fully-qualified proto name. */
function protoPackage(fullType: string): string {
  return fullType.slice(0, fullType.lastIndexOf("."));
}

/** The short name of a fully-qualified proto name. */
function protoShortName(fullType: string): string {
  return fullType.slice(fullType.lastIndexOf(".") + 1);
}

/**
 * The fully-qualified name of message `name`, nested in a message of
 * package `containerPkg`: the schema's method types name it, or it is
 * declared in the container's package or among the API resource commons.
 * Null when none of those declares it; the example then leaves the field
 * out.
 */
function resolveMessage(env: DocExampleEnv, name: string, containerPkg: string): string | null {
  const known = env.methodTypes.get(name);
  if (known !== undefined && known.protoType !== "") return known.protoType;
  for (const pkg of [containerPkg, "ai.stigmer.commons.apiresource"]) {
    try {
      protoFileOfMessage(`${pkg}.${name}`);
      return `${pkg}.${name}`;
    } catch {
      // Not declared in this package; try the next.
    }
  }
  return null;
}

/** The Python module that declares proto type `fullType`, from file `protoFile`, imported; returns the name it is bound to. */
function pyProtoModule(env: DocExampleEnv, fullType: string, protoFile: string): string {
  const pkg = protoPackage(fullType);
  const module = pyProtoFileToModule(protoFile);
  if (pkg === env.schema.package) return env.imports.pyName(pkg, module);
  return env.imports.pyName(pkg, `${module} as ${pyProtoModuleAlias(pkg, module)}`);
}

/** Enum `enumType`'s first named value, as `lang` writes it, its type imported. */
function enumValue(env: DocExampleEnv, ts: TypeSpec, lang: DocLang): string {
  const enumType = ts.enumType ?? "";
  const value = (ts.enumValues ?? [])[0];
  if (value === undefined) throw new Error(`sdk-docs: enum ${enumType} lists no named value`);
  const name = protoShortName(enumType);
  switch (lang) {
    case "typescript": {
      const module = tsEnumModule(enumType);
      return `${env.imports.tsName(module, name)}.${tsEnumMember(module, value)}`;
    }
    case "go": {
      const goType = goSDKEnumGoType(enumType);
      const alias = goType.slice(0, goType.indexOf("."));
      env.imports.goPackage(alias, protoTypeToGoImportPath(enumType, SDK_PROTO_IMPORT_PREFIX));
      return `${goType}_${value}`;
    }
    case "python": {
      const file = protoFileOfEnum(enumType);
      if (file === null) throw new Error(`sdk-docs: no .proto declares enum ${enumType}`);
      return `${pyProtoModule(env, enumType, file)}.${value}`;
    }
    case "java":
      return `${env.imports.javaType(resolveJavaFQCN(enumType))}.${value}`;
  }
}

/**
 * The TypeScript stub module that declares enum `enumType`, found by
 * scanning its package's stubs (an enum may live in a topic file such as
 * platform/v1's entitlement.proto). Read from the repository's stubs
 * whatever directory the generator runs in, so a page is the same from
 * every caller.
 */
function tsEnumModule(enumType: string): string {
  const pkg = protoPackage(enumType);
  const dir = path.join(repoApisDir, "stubs", "ts", ...pkg.split("."));
  const needle = new RegExp(`^export enum ${protoShortName(enumType)} \\{`, "m");
  let entries: fs.Dirent[] = [];
  try {
    entries = readDirSorted(dir);
  } catch {
    entries = [];
  }
  for (const e of entries) {
    if (e.isDirectory() || !e.name.endsWith("_pb.ts")) continue;
    if (needle.test(fs.readFileSync(path.join(dir, e.name), "utf8"))) {
      return `@stigmer/apis/${pkg.replaceAll(".", "/")}/${e.name.slice(0, -".ts".length)}`;
    }
  }
  return tsResolveEnumImportSmart(enumType)[0];
}

/**
 * The TypeScript member protobuf-es declares for proto enum value `value`
 * in stub module `module`: it drops the prefix the values share
 * (`HARNESS_STIGMER` is `Harness.STIGMER`), so the member is read from the
 * stub, by the value it says it was generated from.
 */
function tsEnumMember(module: string, value: string): string {
  const file = path.join(repoApisDir, "stubs", "ts", module.slice("@stigmer/apis/".length) + ".ts");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return value;
  }
  const at = text.indexOf(`@generated from enum value: ${value} = `);
  if (at < 0) return value;
  const member = /^\s*(\w+) = -?\d+,?$/m.exec(text.slice(at));
  return member === null ? value : member[1];
}

function isEnum(ts: TypeSpec): boolean {
  return ts.kind === "string" && (ts.enumType ?? "") !== "";
}

// =========================================================================
// Protobuf messages a method takes as they are
// =========================================================================

/**
 * A protobuf message a method takes, built with a value for each field it
 * declares (`fields`): `typeName` in package `fullType`'s, named as the
 * SDK's own client names it. Returns null when the message cannot be
 * named in `lang` (a Python module no schema records).
 */
export function docProtoInput(
  env: DocExampleEnv,
  lang: DocLang,
  typeName: string,
  fullType: string,
  fields: readonly FieldSchema[],
  messageParam = false,
): string | null {
  const entries = protoEntries(env, lang, fullType, fields);
  switch (lang) {
    case "typescript": {
      const init = formatObject(entries, "");
      if (!messageParam) return init;
      const module = tsMessageModule(env, typeName, fullType);
      if (module === null) return null;
      const create = env.imports.tsName("@bufbuild/protobuf", "create");
      return `${create}(${env.imports.tsName(module, typeName + "Schema")}, ${init})`;
    }
    case "go": {
      const [pkg, type] = resolveType(fullType, typeName, env.schema.package, env.schema.goImportPath);
      const importPath = pkg === env.schema.goImportPath ? goPackagePath(env.schema.package) : protoTypeToGoImportPath(fullType, SDK_PROTO_IMPORT_PREFIX);
      env.imports.goPackage(pkg, importPath);
      return `&${pkg}.${type}${formatGoFields(entries)}`;
    }
    case "python": {
      let module: string;
      try {
        module = pyMethodTypePb2Prefix(typeName, fullType, env.schema, new Map(env.pyModules));
      } catch {
        return null;
      }
      const pkg = protoPackage(fullType);
      if (pkg === env.schema.package) {
        env.imports.pyName(pkg, module);
      } else {
        const mt = env.methodTypes.get(typeName);
        const real = pyProtoFileToModule(mt?.protoFile ?? "io.proto");
        env.imports.pyName(pkg, real === module ? real : `${real} as ${module}`);
      }
      return `${module}.${typeName}${formatPythonArgs(entries)}`;
    }
    case "java": {
      const name = env.imports.javaType(resolveJavaFQCN(fullType));
      if (entries.length === 0) return `${name}.getDefaultInstance()`;
      return `${name}.newBuilder()\n${entries.map((e) => `    .${e.name}(${e.value})`).join("\n")}\n    .build()`;
    }
  }
  return null;
}

/** The TypeScript stub module that declares message `typeName` (`@stigmer/apis/…/io_pb`), or null when no file declares it. */
function tsMessageModule(env: DocExampleEnv, typeName: string, fullType: string): string | null {
  let file = env.methodTypes.get(typeName)?.protoFile ?? "";
  if (file === "") {
    try {
      file = protoFileOfMessage(fullType);
    } catch {
      return null;
    }
  }
  return "@stigmer/apis/" + file.replace(/^apis\//, "").replace(/\.proto$/, "_pb");
}

/**
 * The methods the TypeScript client takes the message itself for, not its
 * init shape: the `Stigmer` client routes an artifact's push and a File's
 * upload (sdk/typescript/src/{skill,plugin,eval,file}.ts), and those
 * overrides name the message type.
 */
export const TS_MESSAGE_PARAMS: ReadonlySet<string> = new Set(["skill.push", "plugin.push", "eval.push", "file.upload"]);

/** The Go import path of proto package `pkg`. */
function goPackagePath(pkg: string): string {
  return SDK_PROTO_IMPORT_PREFIX + "/" + pkg.replaceAll(".", "/");
}

/** The fields a protobuf message example sets: each real oneof's first member only, and no field whose message cannot be named. */
function protoEntries(env: DocExampleEnv, lang: DocLang, containerFull: string, fields: readonly FieldSchema[]): Entry[] {
  const entries: Entry[] = [];
  const oneofsSeen = new Set<string>();
  for (const f of fields) {
    if (isRealOneofMember(f)) {
      const group = f.oneofGroup ?? "";
      if (oneofsSeen.has(group)) continue;
      oneofsSeen.add(group);
    }
    const value = protoValue(env, lang, f.type, containerFull);
    if (value === null) continue;
    entries.push(protoEntry(env, lang, f, value, containerFull));
  }
  return entries;
}

/** One field of a protobuf message example, as `lang` sets it. */
function protoEntry(env: DocExampleEnv, lang: DocLang, f: FieldSchema, value: string, containerFull: string): Entry {
  const presence = hasExplicitPresence(f);
  switch (lang) {
    case "typescript":
      if (isRealOneofMember(f)) {
        return { name: tsProtoFieldName(f.oneofGroup ?? ""), value: `{ case: "${tsProtoFieldName(f.protoField)}", value: ${value} }` };
      }
      return { name: tsProtoFieldName(f.protoField), value };
    case "go": {
      if (isRealOneofMember(f)) {
        const [pkg] = resolveType(containerFull, protoShortName(containerFull), env.schema.package, env.schema.goImportPath);
        const member = protoCapCamel(f.protoField);
        return {
          name: protoCapCamel(f.oneofGroup ?? ""),
          value: `&${pkg}.${protoShortName(containerFull)}_${member}{${member}: ${value}}`,
        };
      }
      if (presence) {
        const proto = env.imports.goPackage("proto", "google.golang.org/protobuf/proto");
        return { name: protoCapCamel(f.protoField), value: `${proto}.${goPresenceHelper(f.type)}(${value})` };
      }
      return { name: protoCapCamel(f.protoField), value };
    }
    case "python":
      return { name: f.protoField, value };
    case "java": {
      const cap = protoCapCamel(f.protoField);
      if (f.type.kind === "array") return { name: `addAll${cap}`, value };
      if (f.type.kind === "map") return { name: `putAll${cap}`, value };
      return { name: `set${cap}`, value };
    }
  }
  return { name: f.protoField, value };
}

/** The `proto` package's helper that boxes a Go scalar for a presence field. */
function goPresenceHelper(ts: TypeSpec): string {
  switch (ts.kind) {
    case "int32":
      return "Int32";
    case "uint32":
      return "Uint32";
    case "int64":
      return "Int64";
    case "bool":
      return "Bool";
    case "float":
      return "Float32";
    case "double":
      return "Float64";
    default:
      return "String";
  }
}

/** A placeholder of protobuf type `ts`, or null when its message cannot be named. */
function protoValue(env: DocExampleEnv, lang: DocLang, ts: TypeSpec, containerFull: string): string | null {
  if (isEnum(ts)) return enumValue(env, ts, lang);
  switch (ts.kind) {
    case "string":
      return PLACEHOLDER;
    case "int32":
    case "uint32":
      return "0";
    case "int64":
      return lang === "typescript" ? "0n" : lang === "java" ? "0L" : "0";
    case "float":
      return lang === "java" ? "0f" : lang === "python" ? "0.0" : "0";
    case "double":
      return lang === "python" ? "0.0" : "0";
    case "bool":
      return lang === "python" ? "False" : "false";
    case "bytes":
      switch (lang) {
        case "typescript":
          return "new Uint8Array()";
        case "go":
          return "[]byte{}";
        case "python":
          return 'b""';
        case "java":
          return `${env.imports.javaType("com.google.protobuf.ByteString")}.EMPTY`;
      }
      return null;
    case "timestamp":
      return wellKnown(env, lang, "Timestamp", "timestamppb", "google.golang.org/protobuf/types/known/timestamppb", "timestamp_pb2");
    case "struct":
      return wellKnown(env, lang, "Struct", "structpb", "google.golang.org/protobuf/types/known/structpb", "struct_pb2");
    case "array": {
      if (ts.elementType === undefined) return lang === "go" ? "[]string{}" : emptyList(env, lang);
      if (lang !== "go") {
        if (ts.elementType.kind === "message" && resolveMessage(env, ts.elementType.messageType ?? "", protoPackage(containerFull)) === null) return null;
        return emptyList(env, lang);
      }
      const elem = protoGoType(env, ts.elementType, containerFull);
      return elem === null ? null : `[]${elem}{}`;
    }
    case "map": {
      if (lang !== "go") {
        if (ts.valueType?.kind === "message" && resolveMessage(env, ts.valueType.messageType ?? "", protoPackage(containerFull)) === null) return null;
        return emptyMap(env, lang);
      }
      const key = ts.keyType === undefined ? "string" : protoGoType(env, ts.keyType, containerFull);
      const val = ts.valueType === undefined ? "string" : protoGoType(env, ts.valueType, containerFull);
      return key === null || val === null ? null : `map[${key}]${val}{}`;
    }
    case "message":
      return protoMessageRef(env, lang, ts, containerFull);
    default:
      return null;
  }
}

/** An empty message of nested type `ts`, or null when it cannot be named. */
function protoMessageRef(env: DocExampleEnv, lang: DocLang, ts: TypeSpec, containerFull: string): string | null {
  const full = resolveMessage(env, ts.messageType ?? "", protoPackage(containerFull));
  if (full === null) return null;
  const name = protoShortName(full);
  switch (lang) {
    case "typescript":
      return "{}";
    case "go": {
      const alias = protoTypeToPackageAlias(full);
      env.imports.goPackage(alias, protoTypeToGoImportPath(full, SDK_PROTO_IMPORT_PREFIX));
      return `&${alias}.${name}{}`;
    }
    case "python": {
      let file: string;
      try {
        file = env.methodTypes.get(name)?.protoFile || protoFileOfMessage(full);
      } catch {
        return null;
      }
      return `${pyProtoModule(env, full, file)}.${name}()`;
    }
    case "java":
      return `${env.imports.javaType(resolveJavaFQCN(full))}.getDefaultInstance()`;
  }
  return null;
}

/** The Go type of a protobuf list element or map value, or null when its message cannot be named. */
function protoGoType(env: DocExampleEnv, ts: TypeSpec, containerFull: string): string | null {
  if (isEnum(ts)) {
    const goType = goSDKEnumGoType(ts.enumType ?? "");
    env.imports.goPackage(goType.slice(0, goType.indexOf(".")), protoTypeToGoImportPath(ts.enumType ?? "", SDK_PROTO_IMPORT_PREFIX));
    return goType;
  }
  switch (ts.kind) {
    case "message": {
      const ref = protoMessageRef(env, "go", ts, containerFull);
      return ref === null ? null : "*" + ref.slice(1, -2);
    }
    case "bytes":
      return "[]byte";
    case "float":
      return "float32";
    case "double":
      return "float64";
    case "string":
    case "int32":
    case "uint32":
    case "int64":
    case "bool":
      return ts.kind;
    default:
      return null;
  }
}

/** An empty well-known protobuf message (Timestamp, Struct). */
function wellKnown(env: DocExampleEnv, lang: DocLang, name: string, goAlias: string, goPath: string, pyModule: string): string {
  switch (lang) {
    case "typescript":
      return "{}";
    case "go":
      return `&${env.imports.goPackage(goAlias, goPath)}.${name}{}`;
    case "python":
      return `${env.imports.pyName("google.protobuf", pyModule)}.${name}()`;
    case "java":
      return `${env.imports.javaType(`com.google.protobuf.${name}`)}.getDefaultInstance()`;
  }
  return "{}";
}

function emptyList(env: DocExampleEnv, lang: DocLang): string {
  return lang === "java" ? `${env.imports.javaType("java.util.List")}.of()` : "[]";
}

function emptyMap(env: DocExampleEnv, lang: DocLang): string {
  switch (lang) {
    case "java":
      return `${env.imports.javaType("java.util.Map")}.of()`;
    case "go":
      return "map[string]string{}";
    default:
      return "{}";
  }
}

// =========================================================================
// The SDK's own inputs
// =========================================================================

/** A field of the resource's SDK input: `name`, `org`, `slug` and `labels`, then the spec's fields. */
export interface DocInputField {
  readonly field: FieldSchema;
  /** The value instead of the type's placeholder (the example's name and organization). */
  readonly value?: string;
}

/**
 * The resource's SDK input (`cfg.inputPrefix + "Input"`), built with a value
 * for each of `fields`.
 */
export function docSdkInput(env: DocExampleEnv, lang: DocLang, fields: readonly DocInputField[]): string {
  const inputName = env.cfg.inputPrefix + "Input";
  const set = new Set(oneMemberPerOneof(fields.map((f) => f.field)));
  const entries = fields
    .filter(({ field }) => set.has(field))
    .map(({ field, value }) => sdkEntry(lang, field, value ?? sdkValue(env, lang, field.type, 0)));
  return sdkConstruct(env, lang, inputName, entries);
}

/**
 * `fields` with each real oneof down to one member: the first that is not
 * a boolean or number, which Go's input holds behind a pointer no literal
 * can be written for; a oneof of only those is left out.
 */
function oneMemberPerOneof(fields: readonly FieldSchema[]): FieldSchema[] {
  const chosen = new Map<string, FieldSchema | null>();
  for (const f of fields) {
    if (!isRealOneofMember(f)) continue;
    const group = f.oneofGroup ?? "";
    if (chosen.get(group)) continue;
    chosen.set(group, isValuedOneofScalar(f) ? null : f);
  }
  return fields.filter((f) => !isRealOneofMember(f) || chosen.get(f.oneofGroup ?? "") === f);
}

/**
 * A literal SDK input `inputName` with `entries` set, as `lang` builds one.
 * A nested input is, in Java, a class inside the resource's own input
 * (`AgentInput.RunConfigInput`).
 */
function sdkConstruct(env: DocExampleEnv, lang: DocLang, inputName: string, entries: readonly Entry[], nested = false): string {
  switch (lang) {
    case "typescript":
      return formatObject(entries, "");
    case "go":
      return `&${goSdk(env)}.${inputName}${formatGoFields(entries)}`;
    case "python":
      return `${pySdk(env, inputName)}${formatPythonArgs(entries)}`;
    case "java": {
      const name = nested ? `${javaSdk(env, env.cfg.inputPrefix + "Input")}.${inputName}` : javaSdk(env, inputName);
      if (entries.length === 0) return `${name}.builder().build()`;
      return `${name}.builder()\n${entries.map((e) => `    .${e.name}(${e.value})`).join("\n")}\n    .build()`;
    }
  }
  return "";
}

/** One field of an SDK input, as `lang` names it. */
function sdkEntry(lang: DocLang, f: FieldSchema, value: string): Entry {
  switch (lang) {
    case "typescript":
      return { name: tsProtoFieldName(f.protoField), value };
    case "go":
      return { name: f.name, value, ...(hasExplicitPresence(f) && { note: GO_PRESENCE_NOTE }) };
    case "python":
      return { name: pyFieldName(f.protoField), value };
    case "java":
      return { name: javaCamel(f.protoField), value };
  }
  return { name: f.protoField, value };
}

/** How deep a nested SDK input's required fields are filled in before the example stops. */
const MAX_NESTING = 3;

/** A placeholder of SDK input field type `ts`. */
function sdkValue(env: DocExampleEnv, lang: DocLang, ts: TypeSpec, depth: number): string {
  if (isEnum(ts)) return enumValue(env, ts, lang);
  switch (ts.kind) {
    case "string":
    case "timestamp":
      return PLACEHOLDER;
    case "int32":
    case "uint32":
      return "0";
    case "int64":
      return lang === "typescript" ? "0n" : lang === "java" ? "0L" : "0";
    case "float":
      return lang === "java" ? "0f" : lang === "python" ? "0.0" : "0";
    case "double":
      return lang === "python" ? "0.0" : "0";
    case "bool":
      return lang === "python" ? "False" : "false";
    case "bytes":
      switch (lang) {
        case "typescript":
          return "new Uint8Array()";
        case "go":
          return "[]byte{}";
        case "python":
          return 'b""';
        case "java":
          return "new byte[0]";
      }
      return '""';
    case "struct":
      return lang === "go" ? "map[string]any{}" : emptyMap(env, lang);
    case "value":
      return lang === "python" ? "None" : lang === "go" ? "nil" : "null";
    case "array":
      return lang === "go" ? `${goSdkType(env, ts)}{}` : emptyList(env, lang);
    case "map":
      return lang === "go" ? `${goSdkType(env, ts)}{}` : emptyMap(env, lang);
    case "message":
      return sdkMessage(env, lang, ts, depth);
    default:
      return PLACEHOLDER;
  }
}

/**
 * A nested SDK input: a resource reference names an organization and a
 * slug; another input is built with its required fields set, so the
 * reader sees the type it takes.
 */
function sdkMessage(env: DocExampleEnv, lang: DocLang, ts: TypeSpec, depth: number): string {
  const messageType = ts.messageType ?? "";
  if (isSpecialType(messageType)) return sdkResourceRef(env, lang);
  const nested = env.specTypes.get(messageType);
  const required = nested === undefined || depth >= MAX_NESTING ? [] : oneMemberPerOneof(nested.fields.filter((f) => f.required));
  const entries = required.map((f) => sdkEntry(lang, f, sdkValue(env, lang, f.type, depth + 1)));
  return sdkConstruct(env, lang, messageType + "Input", entries, true);
}

/** A resource reference: organization `acme`, slug `my-<kind>`. */
export function sdkResourceRef(env: DocExampleEnv, lang: DocLang, slug = "..."): string {
  switch (lang) {
    case "typescript":
      return `{ org: "${DOC_EXAMPLE_ORG}", slug: "${slug}" }`;
    case "go":
      return `${goSdk(env)}.ResourceRef{Org: "${DOC_EXAMPLE_ORG}", Slug: "${slug}"}`;
    case "python":
      return `${pySdk(env, "ResourceRef")}(org="${DOC_EXAMPLE_ORG}", slug="${slug}")`;
    case "java":
      return `${javaSdk(env, "ResourceRef")}.of("${DOC_EXAMPLE_ORG}", "${slug}")`;
  }
  return "";
}

/** A delete's input: the id of the resource it deletes. */
export function sdkDeleteInput(env: DocExampleEnv, lang: DocLang, id: string): string {
  switch (lang) {
    case "typescript":
      return `{ resourceId: "${id}" }`;
    case "go":
      return `&${goSdk(env)}.DeleteResourceInput{ResourceID: "${id}"}`;
    case "python":
      return `${pySdk(env, "DeleteResourceInput")}(resource_id="${id}")`;
    case "java":
      return `${javaSdk(env, "DeleteResourceInput")}.builder()\n    .resourceId("${id}")\n    .build()`;
  }
  return "";
}

/**
 * The Go type of an SDK input field, as a caller outside the SDK writes it:
 * the client generator's own type (goTypeForTypeSpec) with the SDK's
 * types under `stigmer.` and each enum's package imported.
 */
function goSdkType(env: DocExampleEnv, ts: TypeSpec): string {
  importGoEnums(env, ts);
  const sdk = goSdk(env);
  return goTypeForTypeSpec(ts).replace(/(^|[^.\w])([A-Z]\w*)/g, (_, before: string, name: string) => `${before}${sdk}.${name}`);
}

function importGoEnums(env: DocExampleEnv, ts: TypeSpec | undefined): void {
  if (ts === undefined) return;
  if (isEnum(ts)) {
    const goType = goSDKEnumGoType(ts.enumType ?? "");
    env.imports.goPackage(goType.slice(0, goType.indexOf(".")), protoTypeToGoImportPath(ts.enumType ?? "", SDK_PROTO_IMPORT_PREFIX));
  }
  importGoEnums(env, ts.elementType);
  importGoEnums(env, ts.keyType);
  importGoEnums(env, ts.valueType);
}

// =========================================================================
// Java and output types
// =========================================================================

/** The Java type a method's result is declared as: the message the method returns, imported. */
export function javaResultType(env: DocExampleEnv, fullType: string): string {
  return env.imports.javaType(resolveJavaFQCN(fullType));
}

/** Java's `List.of(...)`, imported. */
export function javaListOf(env: DocExampleEnv, items: string): string {
  return `${env.imports.javaType("java.util.List")}.of(${items})`;
}

/** The SDK's Java stream type, imported. */
export function javaStream(env: DocExampleEnv): string {
  return javaSdk(env, "StigmerStream");
}

// =========================================================================
// Formatting
// =========================================================================

/** A TypeScript object literal over `entries`, each line indented after `indent`. */
function formatObject(entries: readonly Entry[], indent: string): string {
  if (entries.length === 0) return "{}";
  return `{\n${entries.map((e) => `${indent}  ${e.name}: ${indentContinuation(e.value, indent + "  ")},`).join("\n")}\n${indent}}`;
}

/** A Go composite literal's field list over `entries`, the names aligned as gofmt aligns them. */
function formatGoFields(entries: readonly Entry[]): string {
  if (entries.length === 0) return "{}";
  const width = Math.max(...entries.map((e) => e.name.length));
  const lines = entries.map(
    (e) => `  ${e.name}:${" ".repeat(width - e.name.length)} ${indentContinuation(e.value, "  ")},${e.note === undefined ? "" : ` // ${e.note}`}`,
  );
  return `{\n${lines.join("\n")}\n}`;
}

/** A Python call's keyword arguments over `entries`. */
function formatPythonArgs(entries: readonly Entry[]): string {
  if (entries.length === 0) return "()";
  return `(\n${entries.map((e) => `    ${e.name}=${indentContinuation(e.value, "    ")},`).join("\n")}\n)`;
}

/** `value`'s second and later lines indented by `indent`, so a nested literal lines up under its field. */
function indentContinuation(value: string, indent: string): string {
  return value.replaceAll("\n", "\n" + indent);
}
