// Service schema extraction — the port of extractServiceSchemas and its
// helpers (role assignment, method-type collection, enum collection, and
// resource/status extraction). One ServiceSchemaFile value per resource,
// serialized to services/<resource>.json.

import type { DescEnum, DescField, DescFile, DescMessage, DescMethod } from "@bufbuild/protobuf";

import type { GoJsonStruct } from "../gojson.js";
import { stripText } from "../internalcomment/internalcomment.js";
import type {
  EnumSchemaValue,
  ExtractContext,
  FieldSchemaValue,
  TypeSchemaValue,
  TypeSpecValue,
} from "./extract.js";
import {
  collectNestedTypes,
  extractTypeSpec,
  findTopLevelMessage,
  messageDescription,
  parseEnumSchema,
  parseSharedType,
} from "./extract.js";
import { capitalize } from "./gostrings.js";

interface MethodSchemaValue extends GoJsonStruct {
  name: string;
  inputType: string;
  inputFullType: string;
  outputType: string;
  outputFullType: string;
  serverStreaming?: boolean;
  clientStreaming?: boolean;
  description?: string;
}

interface ServiceDefinitionValue extends GoJsonStruct {
  name: string;
  role: string;
  protoFile?: string;
  methods: MethodSchemaValue[];
}

/** Mutable working form of ServiceSchemaFile before serialization. */
export interface ServiceSchema {
  package: string;
  goImportPath: string;
  services: ServiceDefinitionValue[];
  methodTypes: TypeSchemaValue[];
  enumTypes: EnumSchemaValue[];
  resourceDescription: string;
  statusType: TypeSchemaValue | undefined;
  statusNestedTypes: TypeSchemaValue[];
}

/**
 * Serializes a ServiceSchema in the exact Go struct-tag order, with the
 * resource name and SearchService listVia marker applied by the caller.
 */
export function serviceSchemaStruct(
  resource: string,
  listVia: string,
  schema: ServiceSchema,
): GoJsonStruct {
  return {
    resource,
    package: schema.package,
    goImportPath: schema.goImportPath,
    services: schema.services,
    listVia: listVia !== "" ? listVia : undefined,
    methodTypes: schema.methodTypes.length > 0 ? schema.methodTypes : undefined,
    enumTypes: schema.enumTypes.length > 0 ? schema.enumTypes : undefined,
    resourceDescription: schema.resourceDescription !== "" ? schema.resourceDescription : undefined,
    statusType: schema.statusType,
    statusNestedTypes: schema.statusNestedTypes.length > 0 ? schema.statusNestedTypes : undefined,
  };
}

/** Port of extractServiceSchemas over a group's files (walk order). */
export function extractServiceSchemas(
  groupFiles: DescFile[],
  ctx: ExtractContext,
): ServiceSchema | null {
  if (groupFiles.length === 0) return null;

  const schema: ServiceSchema = {
    package: "",
    goImportPath: "",
    services: [],
    methodTypes: [],
    enumTypes: [],
    resourceDescription: "",
    statusType: undefined,
    statusNestedTypes: [],
  };
  let resourceType = "";

  // Collect every service before assigning roles: assignment must see the
  // whole package at once so that adding a proto file can never rename an
  // existing service's role (see assignServiceRoles).
  const packageServices: Array<{ svc: DescFile["services"][number]; fd: DescFile }> = [];
  const roleInputs: ServiceRoleInput[] = [];
  for (const fd of groupFiles) {
    if (schema.package === "") {
      schema.package = fd.proto.package;
      schema.goImportPath = deriveGoImportAlias(fd.proto.package);
    }
    for (const svc of fd.services) {
      packageServices.push({ svc, fd });
      roleInputs.push({ serviceName: svc.name, protoFile: fd.proto.name });
    }
  }
  const roles = assignServiceRoles(roleInputs);

  for (const { svc, fd } of packageServices) {
    const methods: MethodSchemaValue[] = svc.methods.map((method) => ({
      name: capitalize(method.name),
      inputType: method.input.name,
      inputFullType: method.input.typeName,
      outputType: method.output.name,
      outputFullType: method.output.typeName,
      serverStreaming: method.proto.serverStreaming ? true : undefined,
      clientStreaming: method.proto.clientStreaming ? true : undefined,
      description: methodDescription(method, ctx) || undefined,
    }));
    if (methods.length > 0) {
      const svcDef: ServiceDefinitionValue = {
        name: svc.name,
        role: roles.get(svc.name) ?? "",
        protoFile: fd.proto.name !== "" ? fd.proto.name : undefined,
        methods,
      };
      schema.services.push(svcDef);
      if (svcDef.role === "command") {
        resourceType = inferResourceType(methods);
      }
    }
  }

  schema.methodTypes = collectMethodTypes(groupFiles, schema, resourceType, ctx);

  if (resourceType !== "") {
    extractResourceAndStatusSchemas(groupFiles, schema, resourceType, ctx);
  }

  schema.enumTypes = collectEnumTypes(groupFiles, schema, ctx);

  return schema;
}

function methodDescription(method: DescMethod, ctx: ExtractContext): string {
  return stripText(ctx.comments.method(method));
}

/** Port of collectMethodTypes. */
function collectMethodTypes(
  groupFiles: DescFile[],
  schema: ServiceSchema,
  resourceType: string,
  ctx: ExtractContext,
): TypeSchemaValue[] {
  const seen = new Set<string>();
  const result: TypeSchemaValue[] = [];

  const msgDescMap = new Map<string, DescMessage>();
  for (const fd of groupFiles) {
    for (const svc of fd.services) {
      for (const method of svc.methods) {
        msgDescMap.set(method.input.typeName, method.input);
        msgDescMap.set(method.output.typeName, method.output);
      }
    }
  }

  for (const svc of schema.services) {
    for (const m of svc.methods) {
      for (const fqn of [m.inputFullType, m.outputFullType]) {
        const shortName = fqn.slice(fqn.lastIndexOf(".") + 1);
        if (seen.has(shortName)) continue;
        if (shouldSkipMethodType(shortName, fqn, resourceType)) continue;
        const msgDesc = msgDescMap.get(fqn);
        if (msgDesc === undefined) continue;
        seen.add(shortName);
        result.push(parseSharedType(msgDesc, ctx));
      }
    }
  }

  return result;
}

// Types the SDK doc generator already handles with built-in rendering.
function shouldSkipMethodType(shortName: string, fqn: string, resourceType: string): boolean {
  if (fqn === "google.protobuf.Empty") return true;
  if (shortName === resourceType) return true;
  if (shortName.endsWith("Id") || shortName.endsWith("ID")) return true;
  if (shortName === "ApiResourceDeleteInput") return true;
  return false;
}

/** Port of collectEnumTypes (the specTypes parameter was dead in Go). */
function collectEnumTypes(
  groupFiles: DescFile[],
  schema: ServiceSchema,
  ctx: ExtractContext,
): EnumSchemaValue[] {
  const seen = new Set<string>();
  const result: EnumSchemaValue[] = [];

  for (const mt of schema.methodTypes) {
    for (const f of mt.fields) {
      if (fieldEnumType(f) !== "") collectEnumFromFieldSchema(f, groupFiles, seen, result, ctx);
    }
  }

  if (schema.statusType !== undefined) {
    for (const f of schema.statusType.fields) {
      if (fieldEnumType(f) !== "") collectEnumFromFieldSchema(f, groupFiles, seen, result, ctx);
    }
  }

  for (const nt of schema.statusNestedTypes) {
    for (const f of nt.fields) {
      if (fieldEnumType(f) !== "") collectEnumFromFieldSchema(f, groupFiles, seen, result, ctx);
    }
  }

  // Walk resource message fields recursively (for types like
  // ApiResourceMetadata that may reference enums not captured above).
  const visited = new Set<string>();
  const walkMessage = (msg: DescMessage): void => {
    if (visited.has(msg.typeName) || msg.typeName.startsWith("google.protobuf")) return;
    visited.add(msg.typeName);
    for (const f of msg.fields) {
      collectEnumFromDescField(f, seen, result, ctx);
    }
    // Go recursed on TYPE_MESSAGE fields but skipped map entries entirely,
    // so map VALUE messages are deliberately not walked here.
    for (const f of msg.fields) {
      const mt =
        f.fieldKind === "message"
          ? f.message
          : f.fieldKind === "list" && f.listKind === "message"
            ? f.message
            : undefined;
      if (mt !== undefined) walkMessage(mt);
    }
  };
  for (const fd of groupFiles) {
    for (const svc of fd.services) {
      for (const method of svc.methods) {
        walkMessage(method.input);
        walkMessage(method.output);
      }
    }
  }

  return result;
}

// Direct or list-of-enum only — Go's collectEnumFromTypeSpec never captured
// map-value enums on this path.
function collectEnumFromDescField(
  field: DescField,
  seen: Set<string>,
  result: EnumSchemaValue[],
  ctx: ExtractContext,
): void {
  const ts = extractTypeSpec(field);
  const isDirect = ts.enumType !== undefined && ts.enumType !== "";
  const isArray = ts.kind === "array" && ts.elementType?.enumType !== undefined && ts.elementType.enumType !== "";
  if (!isDirect && !isArray) return;

  const enumDesc =
    field.fieldKind === "enum"
      ? field.enum
      : field.fieldKind === "list" && field.listKind === "enum"
        ? field.enum
        : undefined;
  if (enumDesc === undefined) return;

  const fqn = `${enumDesc.file.proto.package}.${enumDesc.name}`;
  if (seen.has(fqn)) return;
  seen.add(fqn);
  result.push(parseEnumSchema(enumDesc, ctx));
}

/** Port of collectEnumFromFieldSchema: resolve by FQN through group deps. */
function collectEnumFromFieldSchema(
  f: FieldSchemaValue,
  groupFiles: DescFile[],
  seen: Set<string>,
  result: EnumSchemaValue[],
  ctx: ExtractContext,
): void {
  const enumFQN = fieldEnumType(f);
  if (enumFQN === "" || seen.has(enumFQN)) return;

  const dotAt = enumFQN.lastIndexOf(".");
  const enumName = enumFQN.slice(dotAt + 1);
  const enumPkg = enumFQN.slice(0, dotAt);

  for (const fd of groupFiles) {
    const enumDesc = findEnumInDependencies(fd, enumPkg, enumName);
    if (enumDesc !== undefined) {
      seen.add(enumFQN);
      result.push(parseEnumSchema(enumDesc, ctx));
      return;
    }
  }
}

/** Port of resolveEnumFQN over the serialized TypeSpec value. */
function fieldEnumType(f: FieldSchemaValue): string {
  const ts: TypeSpecValue = f.type;
  if (ts.enumType !== undefined && ts.enumType !== "") return ts.enumType;
  if (ts.kind === "array" && ts.elementType?.enumType) return ts.elementType.enumType;
  if (ts.kind === "map" && ts.valueType?.enumType) return ts.valueType.enumType;
  return "";
}

/** Port of findEnumInDependencies (unbounded DAG recursion, as in Go). */
function findEnumInDependencies(fd: DescFile, pkg: string, name: string): DescEnum | undefined {
  if (fd.proto.package === pkg) {
    for (const e of fd.enums) {
      if (e.name === name) return e;
    }
  }
  for (const dep of fd.dependencies) {
    const result = findEnumInDependencies(dep, pkg, name);
    if (result !== undefined) return result;
  }
  return undefined;
}

/** Port of extractResourceAndStatusSchemas. */
function extractResourceAndStatusSchemas(
  groupFiles: DescFile[],
  schema: ServiceSchema,
  resourceType: string,
  ctx: ExtractContext,
): void {
  const resourceMsg = findTopLevelMessage(groupFiles, resourceType);
  if (resourceMsg === undefined) return;

  schema.resourceDescription = messageDescription(resourceMsg, ctx);

  const statusField = resourceMsg.fields.find((f) => f.name === "status");
  if (statusField === undefined || statusField.fieldKind !== "message") return;

  const statusMsg = statusField.message;
  const hasNonAuditField = statusMsg.fields.some((f) => f.name !== "audit");
  if (!hasNonAuditField) return;

  schema.statusType = parseSharedType(statusMsg, ctx);

  const statusNested = new Map<string, TypeSchemaValue>();
  collectNestedTypes(statusMsg, statusNested, ctx);
  schema.statusNestedTypes = [...statusNested.values()];
  schema.statusNestedTypes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Port of deriveGoImportAlias: "ai.stigmer.agentic.agent.v1" → "agentv1". */
export function deriveGoImportAlias(pkg: string): string {
  const parts = pkg.split(".");
  if (parts.length < 2) return pkg.replaceAll(".", "");
  return parts[parts.length - 2] + parts[parts.length - 1];
}

/**
 * Port of inferResourceType: prefer the output of Update or Delete (which
 * return the resource directly) over Create (which may return a wrapper).
 */
function inferResourceType(methods: MethodSchemaValue[]): string {
  for (const m of methods) {
    if (m.name.toLowerCase() === "update") return m.outputType;
  }
  for (const m of methods) {
    if (m.name.toLowerCase() === "delete") return m.outputType;
  }
  return methods[0].outputType;
}

interface ServiceRoleInput {
  serviceName: string;
  protoFile: string;
}

/**
 * Port of assignServiceRoles. Roles become field names on the generated SDK
 * clients in every language, so they must be stable: adding a service to a
 * package must never rename an existing service's role. When several
 * services claim the same role, the bare role goes to the service defined in
 * the file named exactly "<role>.proto"; every other claimant gets its
 * unique name-derived role.
 */
export function assignServiceRoles(services: ServiceRoleInput[]): Map<string, string> {
  const claimants = new Map<string, ServiceRoleInput[]>();
  for (const svc of services) {
    const role = inferServiceRole(svc.serviceName);
    const group = claimants.get(role);
    if (group === undefined) claimants.set(role, [svc]);
    else group.push(svc);
  }

  const roles = new Map<string, string>();
  for (const [role, group] of claimants) {
    if (group.length === 1) {
      roles.set(group[0].serviceName, role);
      continue;
    }
    let bareAssigned = false;
    for (const svc of group) {
      if (!bareAssigned && baseName(svc.protoFile) === role + ".proto") {
        roles.set(svc.serviceName, role);
        bareAssigned = true;
        continue;
      }
      roles.set(svc.serviceName, inferUniqueServiceRole(svc.serviceName));
    }
  }
  return roles;
}

function inferServiceRole(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("command")) return "command";
  if (lower.includes("query")) return "query";
  if (lower.includes("token")) return "token";
  return "query";
}

function inferUniqueServiceRole(name: string): string {
  const role = name.endsWith("Controller") ? name.slice(0, -"Controller".length) : name;
  if (role.length === 0) return name.toLowerCase();
  return role.slice(0, 1).toLowerCase() + role.slice(1);
}

function baseName(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? path : path.slice(at + 1);
}
