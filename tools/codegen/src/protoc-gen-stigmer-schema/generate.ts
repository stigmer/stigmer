// Comprehensive-mode orchestration: the port of runComprehensiveGeneration,
// generateNamespaceSchemas, generateSDKServiceSchemas, and
// extractCommonsSchema. The Go tool discovered work by scanning the apis/
// filesystem; here the same groups are derived from the compiled file names
// buf hands the plugin, sorted into filepath.Walk visit order so every
// order-dependent byte (package selection, array ordering, first-seen type
// collection) is reproduced.

import type { DescFile } from "@bufbuild/protobuf";

import type { GoJsonStruct } from "../gojson.js";
import { marshalIndent } from "../gojson.js";
import type { EnumSchemaValue, ExtractContext, TypeSchemaValue } from "./extract.js";
import { collectNestedTypes, parseEnumSchema, parseSharedType, parseTaskConfig } from "./extract.js";
import { compareWalkOrder, trimSuffix } from "./gostrings.js";
import { extractServiceSchemas, serviceSchemaStruct } from "./services.js";

export interface OutputFile {
  name: string;
  content: string;
}

const NAMESPACES = ["agentic", "iam", "tenancy"] as const;

// Resources that use SearchService for listing — a server-side indexing
// concern mirrored from the Go tool.
const SEARCH_LIST_RESOURCES = new Set(["agent", "skill", "mcpserver", "workflow"]);

// Curated commons types/enums for SDK reference documentation; internal
// types like AuthorizationConfig and ApiResourceKindMeta are excluded.
const SDK_FACING_COMMONS_TYPES = new Set([
  "ApiResourceMetadata",
  "ApiResourceMetadataVersion",
  "ApiResourceAudit",
  "ApiResourceAuditInfo",
  "ApiResourceAuditActor",
]);
const SDK_FACING_COMMONS_ENUMS = new Set(["ApiResourceVisibility", "ApiResourceKind"]);

/** Runs the full comprehensive generation over the module's files. */
export function generateSchemas(moduleFiles: DescFile[], ctx: ExtractContext): OutputFile[] {
  const out: OutputFile[] = [];

  // Namespace Spec schemas: ai/stigmer/<ns>/<subdomain>/v1/** → <ns>/<subdomain>/.
  for (const ns of NAMESPACES) {
    for (const sub of subdomains(moduleFiles, ns)) {
      const group = groupFiles(moduleFiles, `ai/stigmer/${ns}/${sub}/v1/`);
      out.push(...generateNamespaceSchemas(group, `${ns}/${sub}`, "Spec", ctx));
    }
  }

  // Workflow tasks: nested under agentic/workflow/v1/tasks/ → tasks/.
  const taskGroup = groupFiles(moduleFiles, "ai/stigmer/agentic/workflow/v1/tasks/");
  out.push(...generateNamespaceSchemas(taskGroup, "tasks", "TaskConfig", ctx));

  // Service schemas: one file per resource with gRPC services.
  for (const ns of NAMESPACES) {
    for (const sub of subdomains(moduleFiles, ns)) {
      const group = groupFiles(moduleFiles, `ai/stigmer/${ns}/${sub}/v1/`);
      const schema = extractServiceSchemas(group, ctx);
      if (schema === null || schema.services.length === 0) continue;
      const listVia = SEARCH_LIST_RESOURCES.has(sub) ? "SearchService" : "";
      out.push(jsonFile(`services/${sub}.json`, serviceSchemaStruct(sub, listVia, schema)));
    }
  }

  // SearchService lives outside the resource namespaces.
  const searchGroup = groupFiles(moduleFiles, "ai/stigmer/search/v1/");
  const searchSchema = extractServiceSchemas(searchGroup, ctx);
  if (searchSchema !== null && searchSchema.services.length > 0) {
    out.push(jsonFile("services/search.json", serviceSchemaStruct("search", "", searchSchema)));
  }

  // Commons shared types and enums for SDK docs.
  const commonsGroup = groupFiles(moduleFiles, "ai/stigmer/commons/apiresource/");
  if (commonsGroup.length > 0) {
    out.push(jsonFile("services/commons.json", extractCommonsSchema(commonsGroup, ctx)));
  }

  return out;
}

/** Port of generateNamespaceSchemas for one group of files. */
function generateNamespaceSchemas(
  group: DescFile[],
  outPrefix: string,
  messageSuffix: string,
  ctx: ExtractContext,
): OutputFile[] {
  if (group.length === 0) return [];

  const taskConfigs = new Map<string, GoJsonStruct>();
  const sharedTypes = new Map<string, TypeSchemaValue>();

  for (const fd of group) {
    for (const msg of fd.messages) {
      if (msg.name.endsWith(messageSuffix)) {
        taskConfigs.set(msg.name, parseTaskConfig(msg, ctx));
        collectNestedTypes(msg, sharedTypes, ctx);
      }
    }
  }

  const out: OutputFile[] = [];
  for (const [name, schema] of taskConfigs) {
    const baseName = trimSuffix(name, messageSuffix).toLowerCase();
    out.push(jsonFile(`${outPrefix}/${baseName}.json`, schema));
  }
  for (const [name, typeSchema] of sharedTypes) {
    out.push(jsonFile(`${outPrefix}/types/${name.toLowerCase()}.json`, typeSchema));
  }
  return out;
}

/** Port of extractCommonsSchema over the commons/apiresource files. */
function extractCommonsSchema(group: DescFile[], ctx: ExtractContext): GoJsonStruct {
  const messageTypes: TypeSchemaValue[] = [];
  const enumTypes: EnumSchemaValue[] = [];
  const seenMsgs = new Set<string>();
  const seenEnums = new Set<string>();

  for (const fd of group) {
    for (const msg of fd.messages) {
      if (SDK_FACING_COMMONS_TYPES.has(msg.name) && !seenMsgs.has(msg.name)) {
        seenMsgs.add(msg.name);
        messageTypes.push(parseSharedType(msg, ctx));
      }
    }
    for (const enumDesc of fd.enums) {
      if (SDK_FACING_COMMONS_ENUMS.has(enumDesc.name) && !seenEnums.has(enumDesc.name)) {
        seenEnums.add(enumDesc.name);
        enumTypes.push(parseEnumSchema(enumDesc, ctx));
      }
    }
  }

  // No omitempty on either field in Go: nil slices marshal as null.
  return {
    messageTypes: messageTypes.length > 0 ? messageTypes : null,
    enumTypes: enumTypes.length > 0 ? enumTypes : null,
  };
}

/** Subdomains of a namespace, in ReadDir (sorted) order. */
function subdomains(moduleFiles: DescFile[], ns: string): string[] {
  const prefix = `ai/stigmer/${ns}/`;
  const subs = new Set<string>();
  for (const fd of moduleFiles) {
    const name = fd.proto.name;
    if (!name.startsWith(prefix)) continue;
    const rest = name.slice(prefix.length);
    const [sub, next] = rest.split("/", 2);
    if (sub !== undefined && next === "v1") {
      subs.add(sub);
    }
  }
  return [...subs].sort();
}

/** Group files by path prefix, in filepath.Walk visit order. */
function groupFiles(moduleFiles: DescFile[], prefix: string): DescFile[] {
  return moduleFiles
    .filter((fd) => fd.proto.name.startsWith(prefix))
    .sort((a, b) => compareWalkOrder(a.proto.name, b.proto.name));
}

function jsonFile(name: string, value: GoJsonStruct): OutputFile {
  return { name, content: marshalIndent(value) };
}
