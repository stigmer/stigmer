// File-mode apply orchestration (`apply -f <file|dir>`).
//
// Pipeline per document: strict YAML→proto marshal, reduced to the desired
// state the file declares (no etag, references by slug) → inject the
// resolved org when absent → dry-run preview OR drive the raw command
// controller's `apply` RPC with the full proto → build a CommandResult. Items
// across all files are sorted into dependency order before applying so parents
// (org → agent → channel → …) land before their dependents.
//
// Whether the apply created or updated is the server's word: the apply
// stamps its audit event ("created" or "updated") on the resource it
// answers, read before any follow-up runs. The file cannot tell: a file
// without an id updates the resource its slug names, and a file whose id
// the server no longer holds creates a new one. An answer with no event
// says "applied", never a guess.
//
// The slug rules (a renamed-away slug named, a declared slug followed with a
// rename, a kind that cannot rename) and the visibility rule (a declared
// level followed with `updateVisibility`, a kind that cannot change it) are
// the SDK's, shared with the console's YAML editors; this file words their
// outcomes for the terminal.

import { create, equals, fromJson, type JsonValue, type Message } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { UpdateOrganizationPoliciesInputSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/io_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import {
  type OrganizationPolicies,
  OrganizationPoliciesSchema,
} from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/spec_pb";
import {
  type ApiResourceMetadata,
  ApiResourceMetadataSchema,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import type { ApiResourceAudit } from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";
import {
  type OrganizationReader,
  organizationLabel,
  organizationNamed,
} from "../../client/organizations.js";
import {
  applyNamingCurrentSlug,
  followDeclaredSlug,
  followDeclaredVisibility,
  SlugChangeRefusedError,
  SlugRenamedError,
  toDesiredState,
  VisibilityChangeRefusedError,
} from "@stigmer/client";
import { classify, UsageError } from "../../errors/index.js";
import { CommandResult } from "../../output/index.js";
import { defaultRegistry, unknownKindError, Verb } from "../../registry/index.js";
import { loadDocuments, resolveYamlFiles } from "../documents.js";
import { type ApplyHandler, APPLY_HANDLERS, type ControllerFn } from "./handlers.js";

export interface ApplyItem {
  readonly filePath: string;
  readonly handler: ApplyHandler;
  readonly document: JsonValue;
}

export interface ApplyOutcome {
  readonly result: CommandResult;
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
 * with `validate -f`, so an unknown kind is refused with the same sentence on
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
 *
 * A file is a desired state (`toDesiredState`): its etag is dropped, and so
 * is the id of each reference it names by slug. A file `get -o yaml`
 * printed whole applies after the resource changed, and a reference whose
 * slug was edited follows the new slug instead of disagreeing with a
 * leftover id.
 */
export function marshalItem(item: ApplyItem): Message {
  try {
    return toDesiredState(
      item.handler.schema,
      fromJson(item.handler.schema, item.document, { ignoreUnknownFields: false }),
    );
  } catch (err) {
    throw new UsageError(`invalid ${item.handler.displayName} in ${item.filePath}: ${(err as Error).message}`);
  }
}

/**
 * Apply a fully-marshalled resource message: inject org, then dry-run preview or
 * drive the controller's `apply` RPC. The single apply core behind file mode,
 * taking the message rather than the YAML so org injection, the server's
 * created-or-updated word and result shaping live in one place whatever
 * produced the message.
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

  if (dryRun) {
    return { result: await buildDryRunResult(controller, handler, message), warning: orgWarning };
  }

  const applied = await applyNamingSlug(controller, handler, message);
  const verb = appliedVerb(applied);
  // Visibility and policies land before the slug: a refused rename stops
  // the command, so everything else the manifest asked for has landed by
  // then, and the refusal reports it.
  const visibilityWarning = await applyDeclaredVisibility(controller, handler, message, applied);
  await applyDeclaredPolicies(controller, handler, message, applied);
  const slugWarning = await applyDeclaredSlug(controller, handler, message, applied, visibilityWarning);
  const warning = combineWarnings(orgWarning, visibilityWarning, slugWarning);
  const result = buildApplyResult(handler, applied, verb);
  return { result, warning, applied };
}

/**
 * Land a manifest-declared visibility through the guarded door (the SDK's
 * `followDeclaredVisibility`). Plain updates preserve the stored
 * visibility on both editions (oss#573), so a manifest that declares
 * another level is followed with one `updateVisibility`; a manifest that
 * declares none, or the stored one, costs nothing extra. The landed level
 * is copied onto the outcome the caller already holds. A server-side
 * refusal (an unsupported level) fails the command after the spec has
 * landed, and the error says so.
 *
 * Returns a warning, instead of following up, for kinds without the RPC:
 * their manifests can only carry a level the create path already rejected,
 * so a diff here means a pre-existing resource and an unsupported ask.
 */
async function applyDeclaredVisibility(
  controller: ControllerFn,
  handler: ApplyHandler,
  message: Message,
  applied: Message,
): Promise<string | undefined> {
  try {
    const followed = await followDeclaredVisibility(controller, handler, message, applied);
    if (followed.visibilityKept) {
      return (
        `${handler.displayName} visibility cannot be changed declaratively — ` +
        "the manifest's metadata.visibility was ignored (the stored value is kept)"
      );
    }
    const appliedMeta = metaOf(applied);
    const landedMeta = metaOf(followed.message);
    if (appliedMeta !== undefined && landedMeta !== undefined) {
      appliedMeta.visibility = landedMeta.visibility;
    }
    return undefined;
  } catch (err) {
    /* v8 ignore next -- @preserve: followDeclaredVisibility throws only VisibilityChangeRefusedError; the guard narrows the type */
    if (!(err instanceof VisibilityChangeRefusedError)) throw err;
    throw new UsageError(
      `${handler.displayName} spec applied, but the manifest's visibility change was rejected: ${(err.cause as Error).message}`,
    );
  }
}

/**
 * Land an Organization manifest's declared policies through the guarded
 * door. An update or apply keeps the stored policies (a stale manifest
 * neither fails nor reverts one), so when the applied organization comes
 * back with different policies than the manifest declared, follow up with
 * one `updatePolicies` — the visibility precedent: a manifest that declares
 * no policies, or the ones already stored, costs nothing extra. A refusal
 * (a member who may not change them) fails the command after the spec has
 * landed, and the error says so.
 */
async function applyDeclaredPolicies(
  controller: ControllerFn,
  handler: ApplyHandler,
  message: Message,
  applied: Message,
): Promise<void> {
  if (handler.updatePolicies === undefined) return;
  const declared = (message as Organization).spec?.policies;
  if (declared === undefined) return;
  const appliedOrg = applied as Organization;
  const orgId = appliedOrg.metadata?.id ?? "";
  if (orgId === "" || equals(OrganizationPoliciesSchema, storedPolicies(appliedOrg), declared)) return;

  try {
    const updated = (await handler.updatePolicies(
      controller,
      create(UpdateOrganizationPoliciesInputSchema, { orgId, policies: declared }),
    )) as Organization;
    // Reflect the landed policies on the outcome the caller already holds.
    if (appliedOrg.spec !== undefined) {
      appliedOrg.spec.policies = updated.spec?.policies;
    }
  } catch (err) {
    throw new UsageError(
      `${handler.displayName} spec applied, but the manifest's policies change was rejected: ${(err as Error).message}`,
    );
  }
}

/**
 * The policies an organization holds: a row stored without them holds the
 * defaults (members may create agents), as the server reads it.
 */
function storedPolicies(organization: Organization): OrganizationPolicies {
  return (
    organization.spec?.policies ?? create(OrganizationPoliciesSchema, { membersCanCreateAgents: true })
  );
}

/**
 * Land a manifest-declared slug change through the guarded door (the SDK's
 * `followDeclaredSlug`). An apply finds its resource by the manifest's id
 * when it carries one, and an update ignores the slug, so a manifest that
 * carries the id and a new slug (an organization's `get -o yaml`, edited)
 * updates the resource and leaves the slug as it was; one `rename` follows,
 * as visibility is followed up. Without the id the slug is how apply finds
 * the resource, so a new slug means a new resource. A kind with no rename
 * keeps its slug, and the returned warning says so. A refusal fails the
 * command after the spec and any declared visibility have landed; the error
 * says what landed and carries the visibility follow-up's warning. Its
 * advice follows the refusal: a slug that is taken or reserved
 * (AlreadyExists) asks for another slug, a caller who may not rename
 * (PermissionDenied: renaming needs what deleting needs, an organization's
 * owner for an organization) is told so, anything else gets none.
 */
async function applyDeclaredSlug(
  controller: ControllerFn,
  handler: ApplyHandler,
  message: Message,
  applied: Message,
  visibilityWarning: string | undefined,
): Promise<string | undefined> {
  const declared = metaOf(message);
  const appliedMeta = metaOf(applied);
  try {
    const followed = await followDeclaredSlug(controller, handler, message, applied);
    if (followed.slugKept) {
      return (
        `${handler.displayName} slugs do not change: the file's metadata.slug '${declared?.slug ?? ""}' ` +
        `was not applied, and the slug stays '${appliedMeta?.slug ?? ""}'`
      );
    }
    if (followed.renamedFrom !== undefined && appliedMeta !== undefined) {
      appliedMeta.slug = metaOf(followed.message)?.slug ?? declared?.slug ?? appliedMeta.slug;
    }
    return undefined;
  } catch (err) {
    /* v8 ignore next -- @preserve: followDeclaredSlug throws only SlugChangeRefusedError; the guard narrows the type */
    if (!(err instanceof SlugChangeRefusedError)) throw err;
    const visibilityLanded =
      declared !== undefined &&
      declared.visibility !== ApiResourceVisibility.api_resource_visibility_unspecified &&
      appliedMeta?.visibility === declared.visibility;
    const landed = visibilityLanded ? "spec and visibility" : "spec";
    const warning = visibilityWarning === undefined ? "" : ` (${visibilityWarning})`;
    throw new UsageError(
      `${handler.displayName} ${landed} applied${warning}, but the manifest's slug change was rejected: ` +
        `${(err.cause as Error).message}. The slug stays '${err.slug}'${renameAdvice(err.cause, handler)}.`,
    );
  }
}

/** What to do after a refused rename, by the refusal's code; "" when there is nothing to add. */
function renameAdvice(err: unknown, handler: ApplyHandler): string {
  switch (classify(err)?.code) {
    case Code.AlreadyExists:
      return "; choose another slug and apply again";
    case Code.PermissionDenied:
      return handler.kind === ApiResourceKind.organization
        ? "; renaming needs the organization's owner"
        : `; renaming needs the permission to delete the ${handler.displayName.toLowerCase()}`;
    default:
      return "";
  }
}

/**
 * Applies the message (the SDK's `applyNamingCurrentSlug`); a refusal for a
 * renamed-away slug is answered with the slug the resource has now, read
 * as the caller by the old slug (which still leads to it for reading), so
 * the file can be corrected. A caller who may not read the resource, or a
 * kind with no read by reference, gets the server's own words.
 */
async function applyNamingSlug(controller: ControllerFn, handler: ApplyHandler, message: Message): Promise<Message> {
  try {
    return await applyNamingCurrentSlug(controller, handler, message);
  } catch (err) {
    if (!(err instanceof SlugRenamedError)) throw err;
    throw new UsageError(
      `${handler.displayName} '${err.slug}' was renamed to '${err.currentSlug}'; update the file's metadata.slug to '${err.currentSlug}' and apply again`,
    );
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
// the document specifies a *different* org, return a warning and honour the
// document's value. An organization is named
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

/**
 * What the server says the apply did, from the audit event it stamped on
 * the resource it answered: "created" or "updated", and "applied" for an
 * answer that carries no event.
 */
function appliedVerb(applied: Message): "created" | "updated" | "applied" {
  const event = (applied as unknown as { status?: { audit?: ApiResourceAudit } }).status?.audit?.specAudit?.event;
  return event === "created" || event === "updated" ? event : "applied";
}

function buildApplyResult(handler: ApplyHandler, applied: Message, verb: ReturnType<typeof appliedVerb>): CommandResult {
  const meta = metaOf(applied);
  const result = CommandResult.success(`${handler.displayName} ${verb} successfully`);
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

