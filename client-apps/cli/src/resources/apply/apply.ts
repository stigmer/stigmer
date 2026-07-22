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
  /**
   * The applied resource message (absent in dry-run). Carries the server's
   * authoritative metadata (id/slug) — the reconciler reads this to register
   * project membership, so membership matches what the backend stored.
   */
  readonly applied?: Message;
}

// Dependency apply order (ascending priority); kinds absent get 99 (applied
// last). Mirrors Go's applier.DefaultApplyOrder.
const APPLY_ORDER: ReadonlyMap<ApiResourceKind, number> = new Map([
  [ApiResourceKind.organization, 0],
  [ApiResourceKind.mcp_server, 1],
  // Before agent: an Agent references a Datastore via datastore_usages
  // (the McpServer-before-Agent pattern; mirrors the SDK manifest registry).
  [ApiResourceKind.datastore, 2],
  [ApiResourceKind.agent, 3],
  [ApiResourceKind.workflow, 4],
  [ApiResourceKind.environment, 5],
  [ApiResourceKind.identity_provider, 6],
  [ApiResourceKind.oauth_app, 7],
  [ApiResourceKind.agent_instance, 8],
  [ApiResourceKind.workflow_instance, 9],
  [ApiResourceKind.session, 10],
  // After agent and environment: a share references both.
  [ApiResourceKind.agent_share, 11],
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

/** Apply a single YAML item: strict-marshal to a proto, then apply the message. */
export async function applyItem(
  controller: ControllerFn,
  item: ApplyItem,
  org: string,
  dryRun: boolean,
): Promise<ApplyOutcome> {
  return applyMessage(controller, item.handler, marshalItem(item), org, dryRun);
}

/**
 * Strict YAML→proto marshal for one item, with a precise location in the error.
 * Split out from {@link applyItem} so the declarative reconciler can marshal
 * without immediately applying (it batches messages, then reconciles).
 */
export function marshalItem(item: ApplyItem): Message {
  try {
    return fromJson(item.handler.schema, item.document, { ignoreUnknownFields: false });
  } catch (err) {
    throw new UsageError(`invalid ${item.handler.displayName} in ${item.filePath}: ${(err as Error).message}`);
  }
}

/**
 * Apply a fully-marshalled resource message: inject org, then dry-run preview or
 * drive the controller's `apply` RPC. This is the single apply core shared by
 * both tracks — the declarative/file track feeds messages marshalled from YAML
 * (`marshalItem`), the synthesis track feeds messages decoded from `.pb`
 * (`fromBinary`). One core means one place where org injection, create/update
 * detection, and result shaping live (DD-009 §6).
 */
export async function applyMessage(
  controller: ControllerFn,
  handler: ApplyHandler,
  message: Message,
  org: string,
  dryRun: boolean,
): Promise<ApplyOutcome> {
  const warning = injectOrg(message, org);
  const created = (metaOf(message)?.id ?? "") === "";

  if (dryRun) {
    return { result: buildDryRunResult(handler, message), warning };
  }

  const applied = await handler.apply(controller, message);
  const result = buildApplyResult(handler, applied, created);
  if (handler.kind === ApiResourceKind.mcp_server) {
    return { result, appliedMcpServer: applied as McpServer, warning, applied };
  }
  return { result, warning, applied };
}

/** Read a resource message's metadata (id/name/slug/org), if present. */
export function resourceMetadata(message: Message): ApiResourceMetadata | undefined {
  return metaOf(message);
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
