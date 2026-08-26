// Shared MCP apply-input model — the port of mcp_model.go's buildMcpGen and
// its type-collection pass. The model resolves the flattened ergonomic
// projection (metadata hoist, enum→string, reference flattening with kind
// injection, oneof flattening, workflow task_config expansion) exactly once;
// the emitter consumes it. Field representations keep the Go-typed strings
// ("[]FooInput", "map[string]*BarInput") because the TS emitter's
// classification logic — ported byte-for-byte — interprets those prefixes.

import { goTrimSpace } from "../internalcomment/internalcomment.js";
import type { ExpandStructConfig, LoadedSchemas } from "./gen-common.js";
import { sanitizeDescription, singularize, toPascalCase } from "./gen-common.js";
import { versionedKinds } from "./resource-kind.js";
import type { FieldSchema, TaskConfigSchema, TypeSchema } from "./schema.js";

export interface McpInputType {
  name: string;
  description: string;
  isTopLevel: boolean;
  isReference: boolean;
  refKindVal: number;
  protoType: string;
  protoFile: string;
  fields: McpInputField[];
}

export interface McpInputField {
  goName: string;
  protoField: string;
  goType: string;
  jsonTag: string;
  schemaTag: string;
  description: string;
  inputTypeName: string;
  oneofGroup: string;
  enumType: string;
  isStruct: boolean;
  isValue: boolean;
  isTimestamp: boolean;
  isExpandedConfig: boolean;
  useExportedToProto: boolean;
}

export class McpGen {
  spec: TaskConfigSchema;
  types: Map<string, TypeSchema>;
  inputTypes: McpInputType[] = [];
  private seenTypes = new Set<string>();
  outputDir: string;
  expandStruct: ExpandStructConfig | null;

  constructor(spec: TaskConfigSchema, types: Map<string, TypeSchema>, outputDir: string, expandStruct: ExpandStructConfig | null) {
    this.spec = spec;
    this.types = types;
    this.outputDir = outputDir;
    this.expandStruct = expandStruct;
  }

  collectInputTypes(): void {
    const resourceName = trimSuffix(this.spec.name, "Spec");
    const topLevel: McpInputType = {
      name: resourceName + "Input",
      description: this.spec.description,
      isTopLevel: true,
      isReference: false,
      refKindVal: 0,
      protoType: this.spec.protoType,
      protoFile: this.spec.protoFile,
      fields: [],
    };

    for (const f of this.spec.fields) {
      if (IDENTITY_FIELD_NAMES.has(f.protoField)) continue;
      topLevel.fields.push(this.resolveField(f));
    }

    this.inputTypes.unshift(topLevel);
  }

  resolveField(f: FieldSchema): McpInputField {
    const field: McpInputField = {
      goName: f.name,
      protoField: f.protoField,
      goType: "",
      jsonTag: "",
      schemaTag: "",
      description: "",
      inputTypeName: "",
      oneofGroup: "",
      enumType: "",
      isStruct: false,
      isValue: false,
      isTimestamp: false,
      isExpandedConfig: false,
      useExportedToProto: false,
    };
    const t = f.type;
    const refKind = f.referenceKind ?? 0;

    if (t.kind === "array" && t.elementType?.kind === "message" && this.isResourceWrapper(t.elementType.messageType ?? "")) {
      const [, pkgName, inputType] = this.resourceWrapperGenImport(t.elementType.messageType ?? "");
      const qualifiedType = pkgName + "." + inputType;
      field.goType = "[]" + qualifiedType;
      field.inputTypeName = qualifiedType;
      field.useExportedToProto = true;
    } else if (t.kind === "message" && this.isResourceWrapper(t.messageType ?? "")) {
      const [, pkgName, inputType] = this.resourceWrapperGenImport(t.messageType ?? "");
      const qualifiedType = pkgName + "." + inputType;
      field.goType = "*" + qualifiedType;
      field.inputTypeName = qualifiedType;
      field.useExportedToProto = true;
    } else if (
      t.kind === "array" &&
      t.elementType?.kind === "message" &&
      t.elementType.messageType === "ApiResourceReference" &&
      refKind !== 0
    ) {
      const inputName = this.refInputTypeName(f);
      this.ensureRefInputType(inputName, refKind);
      field.goType = "[]" + inputName;
      field.inputTypeName = inputName;
    } else if (t.kind === "message" && t.messageType === "ApiResourceReference" && refKind !== 0) {
      const inputName = this.refInputTypeName(f);
      this.ensureRefInputType(inputName, refKind);
      field.goType = f.required ? inputName : "*" + inputName;
      field.inputTypeName = inputName;
    } else if (t.kind === "array" && t.elementType?.kind === "message") {
      const inputName = this.messageInputTypeName(t.elementType.messageType ?? "");
      this.ensureMessageInputType(t.elementType.messageType ?? "", inputName);
      field.goType = "[]" + inputName;
      field.inputTypeName = inputName;
    } else if (t.kind === "value") {
      field.goType = "any";
      field.isValue = true;
    } else if (t.kind === "message") {
      const inputName = this.messageInputTypeName(t.messageType ?? "");
      this.ensureMessageInputType(t.messageType ?? "", inputName);
      field.goType = "*" + inputName;
      field.inputTypeName = inputName;
    } else if (t.kind === "map" && t.valueType?.kind === "message") {
      const keyType = scalarGoType(t.keyType?.kind ?? "");
      const inputName = this.messageInputTypeName(t.valueType.messageType ?? "");
      this.ensureMessageInputType(t.valueType.messageType ?? "", inputName);
      field.goType = `map[${keyType}]*${inputName}`;
      field.inputTypeName = inputName;
    } else if (t.kind === "map") {
      const keyType = scalarGoType(t.keyType?.kind ?? "");
      const valType = scalarGoType(t.valueType?.kind ?? "");
      field.goType = `map[${keyType}]${valType}`;
    } else if (t.kind === "array" && t.elementType !== undefined) {
      field.goType = "[]" + scalarGoType(t.elementType.kind);
    } else if (t.kind === "struct") {
      field.goType = "map[string]any";
      field.isStruct = true;
    } else if (t.kind === "timestamp") {
      field.goType = "string";
      field.isTimestamp = true;
    } else {
      field.goType = scalarGoType(t.kind);
    }

    field.jsonTag = buildJsonTag(f);
    field.schemaTag = buildJsonSchemaTag(f);
    field.description = sanitizeDescription(f.description);
    field.oneofGroup = f.oneofGroup ?? "";
    field.enumType = t.enumType ?? "";
    // For repeated enums the enum metadata lives on the element type.
    if (field.enumType === "" && t.kind === "array" && t.elementType !== undefined) {
      field.enumType = t.elementType.enumType ?? "";
    }

    return field;
  }

  // "skill_refs" → "SkillRefInput" (schema field names are PascalCase).
  private refInputTypeName(f: FieldSchema): string {
    let name = f.name;
    if (f.type.kind === "array") {
      name = singularize(name);
    }
    return name + "Input";
  }

  // Every nested message gets the "Input" suffix without exception (a bare
  // name would collide with the proto Schema const the toProto bridge needs).
  messageInputTypeName(messageName: string): string {
    if (messageName.endsWith("Spec")) {
      return trimSuffix(messageName, "Spec") + "Input";
    }
    return messageName + "Input";
  }

  private ensureRefInputType(inputName: string, kindVal: number): void {
    if (this.seenTypes.has(inputName)) return;
    this.seenTypes.add(inputName);

    const refSchema = this.types.get("ApiResourceReference");
    if (refSchema === undefined) return;

    const it: McpInputType = {
      name: inputName,
      description: "Identifies a resource by org, slug, and optional version. Kind is auto-populated.",
      isTopLevel: false,
      isReference: true,
      refKindVal: kindVal,
      protoType: refSchema.protoType,
      protoFile: refSchema.protoFile,
      fields: [],
    };

    for (const f of refSchema.fields) {
      if (f.protoField === "kind") continue; // auto-populated
      if (f.protoField === "version" && !versionedKinds.has(kindVal)) continue;
      it.fields.push(this.resolveField(f));
    }

    this.inputTypes.push(it);
  }

  private ensureMessageInputType(messageName: string, inputName: string): void {
    if (this.seenTypes.has(inputName)) return;
    this.seenTypes.add(inputName);

    const ts = this.types.get(messageName);
    if (ts === undefined) return;

    const hasExpansion = this.expandStruct !== null && this.typeHasExpandableField(ts);

    const it: McpInputType = {
      name: inputName,
      description: hasExpansion
        ? "A single workflow task. Set kind to the task type and populate exactly one matching config field (e.g. kind='http_call' -> set the http_call field)."
        : sanitizeDescription(ts.description),
      isTopLevel: false,
      isReference: false,
      refKindVal: 0,
      protoType: ts.protoType,
      protoFile: ts.protoFile,
      fields: [],
    };

    for (const f of ts.fields) {
      if (hasExpansion && f.protoField === this.expandStruct!.structField) {
        for (const cfg of this.expandStruct!.configs) {
          it.fields.push(this.expandedConfigField(cfg));
        }
        continue;
      }
      if (hasExpansion && f.protoField === this.expandStruct!.discriminatorField) {
        f.description = "Task type. Set the matching config field (e.g. kind='http_call' -> populate http_call).";
      }
      it.fields.push(this.resolveField(f));
    }

    this.inputTypes.push(it);
  }

  private typeHasExpandableField(ts: TypeSchema): boolean {
    return ts.fields.some(
      (f) => f.protoField === this.expandStruct!.structField && f.type.kind === "struct",
    );
  }

  private expandedConfigField(cfg: TaskConfigSchema): McpInputField {
    let fieldName = this.expandStruct!.kindToEnum.get(cfg.kind ?? "") ?? "";
    if (fieldName === "") {
      fieldName = (cfg.kind ?? "").toLowerCase();
    }
    const inputName = this.messageInputTypeName(cfg.name);

    this.ensureConfigInputType(cfg, inputName);

    const desc = sanitizeDescription(cfg.description);
    const shortDesc = `Required when kind='${fieldName}'. ${desc}`;
    const schemaTag = shortDesc.replaceAll("`", "'").replaceAll('"', "'");

    return {
      goName: toPascalCase(fieldName),
      protoField: fieldName,
      goType: "*" + inputName,
      jsonTag: fieldName + ",omitempty",
      schemaTag,
      description: shortDesc,
      inputTypeName: inputName,
      oneofGroup: "",
      enumType: "",
      isStruct: false,
      isValue: false,
      isTimestamp: false,
      isExpandedConfig: true,
      useExportedToProto: false,
    };
  }

  private ensureConfigInputType(cfg: TaskConfigSchema, inputName: string): void {
    if (this.seenTypes.has(inputName)) return;
    this.seenTypes.add(inputName);

    const it: McpInputType = {
      name: inputName,
      description: sanitizeDescription(cfg.description),
      isTopLevel: false,
      isReference: false,
      refKindVal: 0,
      protoType: cfg.protoType,
      protoFile: cfg.protoFile,
      fields: cfg.fields.map((f) => this.resolveField(f)),
    };
    this.inputTypes.push(it);
  }

  hasExpandedConfigFields(it: McpInputType): boolean {
    return it.fields.some((f) => f.isExpandedConfig);
  }

  // Standard API resource envelope: api_version, kind, metadata
  // (ApiResourceMetadata), and spec fields. Imported cross-package rather
  // than re-generated inline.
  isResourceWrapper(messageName: string): boolean {
    const ts = this.types.get(messageName);
    if (ts === undefined) return false;

    let hasApiVersion = false;
    let hasKind = false;
    let hasMetadata = false;
    let hasSpec = false;
    for (const f of ts.fields) {
      switch (f.protoField) {
        case "api_version":
          hasApiVersion = true;
          break;
        case "kind":
          hasKind = true;
          break;
        case "metadata":
          if (f.type.kind === "message" && f.type.messageType === "ApiResourceMetadata") {
            hasMetadata = true;
          }
          break;
        case "spec":
          hasSpec = true;
          break;
      }
    }
    return hasApiVersion && hasKind && hasMetadata && hasSpec;
  }

  // "Agent" → package name "agent" + input type "AgentInput" (the Go import
  // path the Go emitter built is dead; only the projection survives).
  resourceWrapperGenImport(messageName: string): [importPath: string, pkgName: string, inputType: string] {
    const ts = this.types.get(messageName);
    if (ts === undefined) return ["", "", ""];
    const parts = ts.protoType.split(".");
    if (parts.length < 6) return ["", "", ""];
    const domain = parts[2];
    const resource = parts[3];
    return ["gen/" + domain + "/" + resource, resource, messageName + "Input"];
  }

  // "ai.stigmer.<namespace>.<resource>.<version>.<Type>" → "<namespace>.stigmer.ai/<version>".
  deriveApiVersion(protoType: string): string {
    const parts = protoType.split(".");
    if (parts.length < 6) return "unknown";
    return parts[2] + ".stigmer.ai/" + parts[4];
  }

  findInputType(name: string): McpInputType | null {
    return this.inputTypes.find((it) => it.name === name) ?? null;
  }
}

// identityFieldNames: proto fields provided by the inline identity fields
// on every top-level input struct.
const IDENTITY_FIELD_NAMES = new Set(["name", "slug", "org", "visibility", "labels", "tags"]);

/** Port of buildMcpGen: promote the resource spec and build the model. */
export function buildMcpGen(gen: LoadedSchemas, outputDir: string): McpGen {
  // When --schema-dir points directly at a resource directory, the loader
  // categorises the spec JSON as a taskConfig. Promote it.
  let resourceSpecs: TaskConfigSchema[] = [];
  let taskConfigs = gen.taskConfigs;
  if (taskConfigs.length > 0) {
    const dirBase = baseName(gen.schemaDir).toLowerCase();
    let promoted: TaskConfigSchema | null = null;
    const remaining: TaskConfigSchema[] = [];
    for (const tc of taskConfigs) {
      const nameLower = trimSuffix(tc.name, "Spec").toLowerCase();
      if (promoted === null && nameLower === dirBase) {
        promoted = tc;
      } else {
        remaining.push(tc);
      }
    }
    if (promoted === null && taskConfigs.length === 1) {
      promoted = taskConfigs[0];
      remaining.length = 0;
    }
    if (promoted !== null) {
      resourceSpecs = [promoted];
      taskConfigs = remaining;
    }
  }

  if (resourceSpecs.length === 0) {
    throw new Error(`no resource spec found; expected one *Spec schema in ${gen.schemaDir}`);
  }

  const typesMap = new Map<string, TypeSchema>();
  for (const t of gen.sharedTypes) {
    typesMap.set(t.name, t);
  }
  if (gen.expandStruct !== null) {
    for (const t of gen.expandStruct.configTypes) {
      if (!typesMap.has(t.name)) {
        typesMap.set(t.name, t);
      }
    }
  }

  const m = new McpGen(resourceSpecs[0], typesMap, outputDir, gen.expandStruct);
  m.collectInputTypes();
  return m;
}

function buildJsonTag(f: FieldSchema): string {
  return f.required ? f.protoField : f.protoField + ",omitempty";
}

function buildJsonSchemaTag(f: FieldSchema): string {
  let desc = f.description;
  if (desc === "") return "";

  desc = desc.replaceAll("\n", " ");
  while (desc.includes("  ")) {
    desc = desc.replaceAll("  ", " ");
  }
  desc = goTrimSpace(desc);
  desc = desc.replaceAll("`", "'").replaceAll('"', "'");

  let enumVals = f.type.enumValues ?? [];
  if (enumVals.length === 0 && f.type.kind === "array" && f.type.elementType !== undefined) {
    enumVals = f.type.elementType.enumValues ?? [];
  }
  if (enumVals.length === 0 && f.validation !== undefined) {
    enumVals = f.validation.enum ?? [];
  }
  if (enumVals.length > 0) {
    desc += " Allowed values: " + enumVals.join(", ") + ".";
  }
  return desc;
}

export function scalarGoType(kind: string): string {
  switch (kind) {
    case "string":
      return "string";
    case "bool":
      return "bool";
    case "int32":
      return "int32";
    case "uint32":
      return "uint32";
    case "int64":
      return "int64";
    case "float":
      return "float32";
    case "double":
      return "float64";
    case "bytes":
      return "[]byte";
    default:
      return "string";
  }
}

export function parseMapType(goType: string): [keyType: string, valType: string] {
  const inner = goType.startsWith("map[") ? goType.slice(4) : goType;
  const idx = inner.indexOf("]");
  if (idx < 0) return ["string", "string"];
  return [inner.slice(0, idx), inner.slice(idx + 1)];
}

function trimSuffix(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : s;
}

function baseName(p: string): string {
  const at = p.lastIndexOf("/");
  return at === -1 ? p : p.slice(at + 1);
}
