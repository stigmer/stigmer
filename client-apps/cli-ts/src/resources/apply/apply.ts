// File-mode apply orchestration (`apply -f <file|dir>`).
//
// Pipeline per document: strict YAML→proto marshal (S-strict) → inject the
// resolved org when absent → dry-run preview OR drive the raw command
// controller's `apply` RPC with the full proto → build a CommandResult. Items
// across all files are sorted into dependency order before applying so parents
// (org → mcp_server → agent → workflow → …) land before their dependents.

import { create, fromJson, type JsonValue, type Message } from "@bufbuild/protobuf";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  type ApiResourceMetadata,
  ApiResourceMetadataSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { UsageError } from "../../errors/index.js";
import { CommandResult } from "../../output/index.js";
import { defaultRegistry, Verb } from "../../registry/index.js";
import { loadDocuments, resolveYamlFiles } from "../documents.js";
import { type ApplyHandler, APPLY_HANDLERS, type ControllerFn } from "./handlers.js";

export interface ApplyItem {
  readonly filePath: string;
  readonly handler: ApplyHandler;
  readonly document: JsonValue;
}

export interface ApplyOutcome {
  readonly result: CommandResult;
  /** Set for successfully applied MCP servers, to drive post-apply discovery. */
  readonly appliedMcpServer?: McpServer;
  /** Optional org-mismatch warning to surface on stderr. */
  readonly warning?: string;
}

// Dependency apply order (ascending priority); kinds absent get 99 (applied
// last). Mirrors Go's applier.DefaultApplyOrder.
const APPLY_ORDER: ReadonlyMap<ApiResourceKind, number> = new Map([
  [ApiResourceKind.organization, 0],
  [ApiResourceKind.mcp_server, 1],
  [ApiResourceKind.agent, 2],
  [ApiResourceKind.workflow, 3],
  [ApiResourceKind.environment, 4],
  [ApiResourceKind.identity_provider, 5],
  [ApiResourceKind.oauth_app, 6],
  [ApiResourceKind.agent_instance, 7],
  [ApiResourceKind.workflow_instance, 8],
  [ApiResourceKind.session, 9],
]);

/** Expand a path into ordered, kind-resolved apply items (strict YAML parse). */
export function resolveApplyItems(path: string): ApplyItem[] {
  const files = resolveYamlFiles(path);
  if (files.length === 0) throw new UsageError("no YAML files found");

  const items: ApplyItem[] = [];
  for (const file of files) {
    for (const doc of loadDocuments(file, { strict: true })) {
      items.push({ filePath: file, handler: resolveHandlerForKind(doc.kind, file), document: doc.document });
    }
  }
  if (items.length === 0) throw new UsageError("no valid resources found in files");
  return sortApplyItems(items);
}

/**
 * Resolve a YAML `kind` to its apply handler, enforcing the verb-support gate.
 * Shared by file mode and declarative mode so the lookup + error wording lives
 * in exactly one place. `where` is woven into errors for a precise location.
 */
export function resolveHandlerForKind(kind: string, where: string): ApplyHandler {
  const info = defaultRegistry().getByYamlKind(kind);
  if (info === undefined) throw new UsageError(`unknown resource kind '${kind}' in ${where}`);
  if (!info.supportedVerbs.has(Verb.Apply)) throw new UsageError(`${info.displayName} does not support 'apply'`);
  const handler = APPLY_HANDLERS.get(info.kind);
  if (handler === undefined) throw new UsageError(`apply not implemented for ${info.displayName}`);
  return handler;
}

/** Stable sort by dependency priority (Array.prototype.sort is stable in V8). */
export function sortApplyItems(items: ApplyItem[]): ApplyItem[] {
  items.sort((a, b) => priorityOf(a.handler.kind) - priorityOf(b.handler.kind));
  return items;
}

/** True when any item needs org context (everything except Organization). */
export function requiresOrgContext(items: readonly ApplyItem[]): boolean {
  return items.some((item) => item.handler.kind !== ApiResourceKind.organization);
}

/** Apply a single item: marshal, inject org, then dry-run preview or apply. */
export async function applyItem(
  controller: ControllerFn,
  item: ApplyItem,
  org: string,
  dryRun: boolean,
): Promise<ApplyOutcome> {
  let message: Message;
  try {
    message = fromJson(item.handler.schema, item.document, { ignoreUnknownFields: false });
  } catch (err) {
    throw new UsageError(`invalid ${item.handler.displayName} in ${item.filePath}: ${(err as Error).message}`);
  }

  const warning = injectOrg(message, org);
  const created = (metaOf(message)?.id ?? "") === "";

  if (dryRun) {
    return { result: buildDryRunResult(item.handler, message), warning };
  }

  const applied = await item.handler.apply(controller, message);
  const result = buildApplyResult(item.handler, applied, created);
  if (item.handler.kind === ApiResourceKind.mcp_server) {
    return { result, appliedMcpServer: applied as McpServer, warning };
  }
  return { result, warning };
}

function metaOf(message: Message): ApiResourceMetadata | undefined {
  return (message as unknown as { metadata?: ApiResourceMetadata }).metadata;
}

// Inject the resolved org into metadata.org when the document omitted it. When
// the document specifies a *different* org, return a warning (Go warns but
// honors the document's value — we do the same).
function injectOrg(message: Message, org: string): string | undefined {
  if (org === "") return undefined;
  const holder = message as unknown as { metadata?: ApiResourceMetadata };
  if (holder.metadata === undefined) {
    holder.metadata = create(ApiResourceMetadataSchema, { org });
    return undefined;
  }
  if (holder.metadata.org === "") {
    holder.metadata.org = org;
    return undefined;
  }
  if (holder.metadata.org !== org) {
    return `resource org '${holder.metadata.org}' differs from target org '${org}'; using '${holder.metadata.org}'`;
  }
  return undefined;
}

function buildApplyResult(handler: ApplyHandler, applied: Message, created: boolean): CommandResult {
  const meta = metaOf(applied);
  const result = CommandResult.success(`${handler.displayName} ${created ? "created" : "updated"} successfully`);
  const section = result.addSection("Resource Details");
  if (meta?.id) section.field("ID", meta.id);
  if (meta?.name) section.field("Name", meta.name);
  if (meta?.slug) section.field("Slug", meta.slug);
  return result;
}

function buildDryRunResult(handler: ApplyHandler, message: Message): CommandResult {
  const meta = metaOf(message);
  const name = meta?.name ?? handler.displayName;
  const result = CommandResult.success(`Dry run: ${name} is valid`);
  const section = result.addSection(`${handler.displayName} Preview`);
  if (meta?.name) section.field("Name", meta.name);
  if (meta?.slug) section.field("Slug", meta.slug);
  if (meta?.org) section.field("Org", meta.org);
  return result;
}

function priorityOf(kind: ApiResourceKind): number {
  return APPLY_ORDER.get(kind) ?? 99;
}
