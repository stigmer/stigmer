// File-mode apply orchestration (`apply -f <file|dir>`).
//
// Pipeline per document: strict YAML→proto marshal → inject the
// resolved org when absent → dry-run preview OR drive the raw command
// controller's `apply` RPC with the full proto → build a CommandResult. Items
// across all files are sorted into dependency order before applying so parents
// (org → mcp_server → agent → workflow → …) land before their dependents.

import { create, fromJson, type JsonValue, type Message } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { RenameInputSchema, UpdateVisibilityInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import {
  type ApiResourceMetadata,
  ApiResourceMetadataSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  type OrganizationReader,
  organizationLabel,
  organizationNamed,
} from "../../client/organizations.js";
import { classify, UsageError } from "../../errors/index.js";
import { CommandResult } from "../../output/index.js";
import { defaultRegistry, unknownKindError, Verb } from "../../registry/index.js";
import { loadDocuments, resolveYamlFiles } from "../documents.js";
import { decodeWorkflowTaskConfigs } from "../task-configs.js";
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
   * The applied resource message (absent in dry-run), as the server stored
   * it: authoritative metadata (id, slug, visibility) for anything that
   * runs after the apply.
   */
  readonly applied?: Message;
}

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
 * The unknown-kind wording is the registry's (`unknownKindError`), shared
 * with `validate -f`, so a retired kind is refused with the same sentence on
 * both paths. `where` is woven into errors for a precise location.
 */
export function resolveHandlerForKind(kind: string, where: string): ApplyHandler {
  const info = defaultRegistry().getByYamlKind(kind);
  if (info === undefined) throw unknownKindError(kind, where);
  if (!info.supportedVerbs.has(Verb.Apply)) throw new UsageError(`${info.displayName} does not support 'apply'`);
  const handler = APPLY_HANDLERS.get(info.kind);
  if (handler === undefined) throw new UsageError(`apply not implemented for ${info.displayName}`);
  return handler;
}

/**
 * Stable sort by dependency priority (Array.prototype.sort is stable in V8).
 * The priority rides each handler (`applyOrder`, sourced from the SDK
 * manifest registry) — there is deliberately no local ordering table to
 * drift from it.
 */
export function sortApplyItems(items: ApplyItem[]): ApplyItem[] {
  items.sort((a, b) => a.handler.applyOrder - b.handler.applyOrder);
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
 * Split out from {@link applyItem} so marshalling can be exercised and reused
 * apart from the apply it feeds.
 */
export function marshalItem(item: ApplyItem): Message {
  try {
    const message = fromJson(item.handler.schema, item.document, { ignoreUnknownFields: false });
    // Workflow task_config blocks live inside an open Struct the top-level
    // decode cannot see into; decode them per kind so a dry-run rejects
    // exactly what a real apply rejects (stigmer/stigmer#778).
    if (item.handler.kind === ApiResourceKind.workflow) {
      decodeWorkflowTaskConfigs(message as Workflow);
    }
    return message;
  } catch (err) {
    throw new UsageError(`invalid ${item.handler.displayName} in ${item.filePath}: ${(err as Error).message}`);
  }
}

/**
 * Apply a fully-marshalled resource message: inject org, then dry-run preview or
 * drive the controller's `apply` RPC. The single apply core behind file mode,
 * taking the message rather than the YAML so org injection, create/update
 * detection and result shaping live in one place whatever produced the message.
 */
export async function applyMessage(
  controller: ControllerFn,
  handler: ApplyHandler,
  message: Message,
  org: string,
  dryRun: boolean,
): Promise<ApplyOutcome> {
  // An organization belongs to no organization: its own metadata.org stays
  // empty, whatever the context or `--org` names for the file's other kinds.
  const orgWarning =
    handler.kind === ApiResourceKind.organization ? undefined : await injectOrg(controller, message, org);
  const created = (metaOf(message)?.id ?? "") === "";

  if (dryRun) {
    return { result: await buildDryRunResult(controller, handler, message), warning: orgWarning };
  }

  const applied = await handler.apply(controller, message);
  // Visibility lands before the slug: a refused rename stops the command,
  // so everything else the manifest asked for has landed by then, and the
  // refusal reports it.
  const visibilityWarning = await applyDeclaredVisibility(controller, handler, message, applied);
  await applyDeclaredSlug(controller, handler, message, applied, visibilityWarning);
  const warning = combineWarnings(orgWarning, visibilityWarning);
  const result = buildApplyResult(handler, applied, created);
  if (handler.kind === ApiResourceKind.mcp_server) {
    return { result, appliedMcpServer: applied as McpServer, warning, applied };
  }
  return { result, warning, applied };
}

/**
 * Land a manifest-declared visibility through the guarded door. Plain
 * updates preserve the stored visibility on both editions (oss#573) — the
 * `updateVisibility` RPC is the only mutation path, so when the applied
 * resource comes back with a different level than the manifest declared,
 * follow up with one RPC (the skill-push precedent: no-ops are skipped, an
 * unchanged manifest costs nothing extra). Server-side guard rejections
 * (unsupported level, default-instance) propagate as command failures —
 * the spec update has landed at that point, and the error says so.
 *
 * Returns a warning (instead of following up) for kinds without the RPC:
 * their manifests can only carry a level the create path already rejected,
 * so a diff here means a pre-existing resource and an unsupported ask.
 */
async function applyDeclaredVisibility(
  controller: ControllerFn,
  handler: ApplyHandler,
  message: Message,
  applied: Message,
): Promise<string | undefined> {
  const declared = metaOf(message)?.visibility ?? ApiResourceVisibility.api_resource_visibility_unspecified;
  if (declared === ApiResourceVisibility.api_resource_visibility_unspecified) return undefined;

  const appliedMeta = metaOf(applied);
  const resourceId = appliedMeta?.id ?? "";
  if (resourceId === "" || appliedMeta?.visibility === declared) return undefined;

  if (handler.updateVisibility === undefined) {
    return (
      `${handler.displayName} visibility cannot be changed declaratively — ` +
      "the manifest's metadata.visibility was ignored (the stored value is kept)"
    );
  }

  try {
    const updated = await handler.updateVisibility(
      controller,
      create(UpdateVisibilityInputSchema, { resourceId, visibility: declared }),
    );
    // Reflect the landed level on the outcome the caller already holds.
    const updatedMeta = metaOf(updated);
    if (appliedMeta !== undefined && updatedMeta !== undefined) {
      appliedMeta.visibility = updatedMeta.visibility;
    }
    return undefined;
  } catch (err) {
    throw new UsageError(
      `${handler.displayName} spec applied, but the manifest's visibility change was rejected: ${(err as Error).message}`,
    );
  }
}

/**
 * Land a manifest-declared slug change through the guarded door. An apply
 * finds its resource by the manifest's id when it carries one, and an
 * update ignores the slug, so a manifest that carries the id and a new slug
 * (an organization's `get -o yaml`, edited) updates the resource and leaves
 * the slug as it was; this follows up with one `rename`, as visibility is
 * followed up. Only kinds with the RPC are driven, and only when the
 * manifest names the id: without it the slug is how apply finds the
 * resource, so a new slug means a new resource. A refusal fails the
 * command after the spec and any declared visibility have landed; the error
 * says what landed and carries the visibility follow-up's warning. Its advice
 * follows the refusal: a slug that is taken or reserved (AlreadyExists) asks
 * for another slug, a caller who may not rename (PermissionDenied: renaming
 * needs the organization's owner) is told so, anything else gets none.
 */
async function applyDeclaredSlug(
  controller: ControllerFn,
  handler: ApplyHandler,
  message: Message,
  applied: Message,
  visibilityWarning: string | undefined,
): Promise<void> {
  const declared = metaOf(message);
  const appliedMeta = metaOf(applied);
  if (
    handler.rename === undefined ||
    declared === undefined ||
    appliedMeta === undefined ||
    declared.id === "" ||
    declared.slug === "" ||
    declared.slug === appliedMeta.slug
  ) {
    return;
  }
  try {
    const renamed = await handler.rename(
      controller,
      create(RenameInputSchema, { resourceId: appliedMeta.id, slug: declared.slug }),
    );
    appliedMeta.slug = metaOf(renamed)?.slug ?? declared.slug;
  } catch (err) {
    const visibilityLanded =
      declared.visibility !== ApiResourceVisibility.api_resource_visibility_unspecified &&
      appliedMeta.visibility === declared.visibility;
    const landed = visibilityLanded ? "spec and visibility" : "spec";
    const warning = visibilityWarning === undefined ? "" : ` (${visibilityWarning})`;
    throw new UsageError(
      `${handler.displayName} ${landed} applied${warning}, but the manifest's slug change was rejected: ` +
        `${(err as Error).message}. The slug stays '${appliedMeta.slug}'${renameAdvice(err)}.`,
    );
  }
}

/** What to do after a refused rename, by the refusal's code; "" when there is nothing to add. */
function renameAdvice(err: unknown): string {
  switch (classify(err)?.code) {
    case Code.AlreadyExists:
      return "; choose another slug and apply again";
    case Code.PermissionDenied:
      return "; renaming needs the organization's owner";
    default:
      return "";
  }
}

function combineWarnings(...warnings: (string | undefined)[]): string | undefined {
  const present = warnings.filter((w): w is string => w !== undefined);
  return present.length > 0 ? present.join("; ") : undefined;
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
// honors the document's value — we do the same). An organization is named
// by its id or its slug, so two different strings are asked about before
// they are called different organizations, and the warning names each by
// its slug where the caller can see it.
async function injectOrg(
  controller: ControllerFn,
  message: Message,
  org: string,
): Promise<string | undefined> {
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
  if (holder.metadata.org === org) return undefined;
  const reader = organizationReader(controller);
  const [declared, target] = await Promise.all([
    organizationNamed(reader, holder.metadata.org),
    organizationNamed(reader, org),
  ]);
  if (declared !== undefined && declared.id === target?.id) return undefined;
  const declaredLabel = declared?.slug || holder.metadata.org;
  const targetLabel = target?.slug || org;
  return `resource org '${declaredLabel}' differs from target org '${targetLabel}'; using '${declaredLabel}'`;
}

/**
 * The organization get the shared name helpers ask, over the raw query
 * controller, asked once per value for as long as the controller lives (one
 * command): a manifest of many documents naming one organization makes one
 * lookup, not two per document.
 */
function organizationReader(controller: ControllerFn): OrganizationReader {
  let gets = organizationGets.get(controller);
  if (gets === undefined) {
    gets = new Map();
    organizationGets.set(controller, gets);
  }
  const memo = gets;
  return {
    organization: {
      get: (value) => {
        let got = memo.get(value);
        if (got === undefined) {
          got = controller(OrganizationQueryController).get({ value });
          memo.set(value, got);
        }
        return got;
      },
    },
  };
}

/** Each controller's organization gets, by the value asked. */
const organizationGets = new WeakMap<ControllerFn, Map<string, ReturnType<OrganizationReader["organization"]["get"]>>>();

function buildApplyResult(handler: ApplyHandler, applied: Message, created: boolean): CommandResult {
  const meta = metaOf(applied);
  const result = CommandResult.success(`${handler.displayName} ${created ? "created" : "updated"} successfully`);
  const section = result.addSection("Resource Details");
  if (meta?.id) section.field("ID", meta.id);
  if (meta?.name) section.field("Name", meta.name);
  if (meta?.slug) section.field("Slug", meta.slug);
  return result;
}

// The preview names the organization by slug, as other output does: the
// injected context organization is an id.
async function buildDryRunResult(
  controller: ControllerFn,
  handler: ApplyHandler,
  message: Message,
): Promise<CommandResult> {
  const meta = metaOf(message);
  const name = meta?.name ?? handler.displayName;
  const result = CommandResult.success(`Dry run: ${name} is valid`);
  const section = result.addSection(`${handler.displayName} Preview`);
  if (meta?.name) section.field("Name", meta.name);
  if (meta?.slug) section.field("Slug", meta.slug);
  if (meta?.org) section.field("Org", await organizationLabel(organizationReader(controller), meta.org));
  return result;
}

