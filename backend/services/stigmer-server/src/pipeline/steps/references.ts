/**
 * References — the two shared steps every chain that stores a spec with
 * `ApiResourceReference` fields runs, and the ONE rule that decides whether
 * a reference may be written.
 *
 * NormalizeReferences resolves every ApiResourceReference inside the spec
 * to the id of the resource it names (`resolveReferences`): an EMPTY org
 * takes the resource's own metadata.org (an explicit org is preserved), the
 * kind is the field's, and a slug becomes the id its name table entry holds
 * now, the slug then cleared. A stored reference is {org, kind, id,
 * version}: it keeps meaning the resource it meant when that resource is
 * renamed, and never means a new resource that takes a deleted one's name.
 * Responses name each reference again with its target's current slug
 * (pipeline/interceptors/resource-references.ts). Only the spec is walked —
 * status is system-generated. It is a step, so it runs on serving and
 * in-process writes alike, and on every chain it runs as soon as the
 * resource's organization is known and before any step that reads a
 * reference: on create and in the apply pre-chains directly after
 * ValidateProto, on update directly after BuildUpdateState. Resolving is
 * idempotent on ids, so an apply that delegates resolves once in effect.
 * __tests__/reference-wiring.test.ts holds every chain to that order.
 *
 * ValidateReferences runs directly after it and asks `checkReference` for
 * every reference the walk finds, then the writer clause of (ii) for the
 * ones that clear it. The rule has three clauses, in the order they are
 * asked:
 *
 *   (i)  A reference with no organization is refused. After the normalize
 *        step the only way an org is still empty is a resource that has
 *        none itself; a slug looked up with no org matches any
 *        organization's row (helpers.ts), which is the cross-tenant read
 *        the reference lane's `requireOrgForReference` exists to forbid.
 *   (ii) Same organization as the resource: the target must exist, and,
 *        when the target's kind is one the RUN reads as the person
 *        (`readByRun` in the table below), its visibility must be at least
 *        the resource's on the order private < org < child_orgs — the FLOOR.
 *        What a person can run they must also be able to read: an
 *        org-visible agent over a private MCP server would run for every
 *        member and be readable by one. Vaults, OAuth apps and channel
 *        apps are resolved by the server on the run's behalf, so their
 *        level is not a leak the floor closes, and an org-visible channel
 *        may hold a private shared vault: attaching it is a choice to let
 *        its runs use it, made by someone who may use it.
 *
 *        The WRITER clause, for the kinds whose row says what the writer
 *        must hold (`writerMust`): a same-organization reference the write
 *        INTRODUCES — one the stored row does not already carry — must
 *        name a target the writer holds that permission on, asked of the
 *        edition's Authorizer. Vaults carry it with `can_use`: the server
 *        opens a vault for the run, and the run is a person with a shell,
 *        so attaching a vault one may not use would hand its values to
 *        whoever runs the surface. A refusal is PERMISSION_DENIED with its
 *        own sentence. Judging only what a write introduces is the
 *        reserved-label guard's echo rule (guard-reserved-labels.ts): an
 *        edit that keeps an attachment someone else made passes, and the
 *        attachment keeps its attacher (domain/vault/attachments.ts
 *        records who attached each vault, and every run asks that account
 *        again, so a revoked grant stops every surface its holder fed). A
 *        schedule whose agent changes re-judges every vault it keeps
 *        against the updater (the same module). The server acting as
 *        itself (the `internal` class) is exempt, as at every
 *        authorization step.
 *   (iii) Another organization: the target must exist, be shared with
 *        child organizations (visibility_child_orgs), AND belong to the
 *        writing organization's own parent, answered with ONE sentence
 *        that does not say which failed. The caller has no standing to
 *        learn what another organization holds (the anti-probe posture the
 *        AgentShare lane set first). The writer's parent is read once, from
 *        its organization's row, only when a reference crosses
 *        organizations, so a reference no run of the writer's could use is
 *        refused at write instead of stored. No vault, OAuth app or
 *        channel app is ever shared with child organizations, so every
 *        cross-organization reference to one is refused here.
 *
 * The kind a reference names is the kind its FIELD declares
 * (`reference_kind`, the contract's word for what the field points to),
 * never the `kind` value a client happened to put on the message: the
 * runtime resolves `skill_refs` as skills whatever the message says, and
 * the rule must agree with the runtime; NormalizeReferences refuses a
 * reference whose `kind` says otherwise. A reference with neither id nor
 * slug is unset and skipped (the message's own rule refuses one written
 * that way).
 *
 * The floor has a second door. Raising a resource's level through
 * updateVisibility could open the same gap a create cannot, so
 * GuardReferenceFloorOnEscalation runs on the agent chain, whose rows carry
 * run-read references, after ValidateVisibilityUpdate:
 * when the requested level is above the stored one, every run-read
 * reference the STORED row carries must be at least the requested level,
 * judged by the same function over the same collectors, else the escalation is
 * refused naming the dependencies. Only the floor is asked at
 * that door — a dependency that has since left or stopped being shared was
 * judged when the row was written and is the run's to refuse.
 *
 * A version on a reference is the contract's word, never this rule's: the
 * rule judges the row a reference names, whichever version it names. Every
 * surface that references a versioned kind honours the version (an agent's
 * through the session it starts, which pins it, and through a parent agent
 * that lists it as a subagent, which pins it at save; a skill's at run
 * start), and an unversioned kind's is ignored.
 *
 * A chain whose stored row is rewritten by machines as well as people (a
 * session, whose harness state the runner writes back with the whole row)
 * asks ValidateReferences to judge only the references a write introduces
 * (`judge: "introduced"`): a reference the stored row already carries was
 * judged when it was written, and one that has since left or stopped being
 * shared is the run's to refuse, the escalation door's posture above. Every
 * other chain judges every reference, as it always has.
 *
 * A later step that needs a reference's target (a session pinning its
 * agent) reads the reference's id, which NormalizeReferences set.
 *
 * REFERENCE_TARGET_KINDS is the one explicit table of kinds a spec may
 * reference, with each kind's schema and its `readByRun` flag: the
 * composition-root idiom (query/search/registry.ts) — an explicit list a
 * test pins against the protos, so a new `reference_kind` in the contract
 * fails the pin until this table says how it is read.
 *
 * Cost: one point read per distinct target a write judges, by id, and
 * one name read per distinct slug a write names. *
 * The refusal copy is exported below. The MCP-server sentence predates the
 * rule and is wire contract (byte-pinned by pipeline/__tests__/steps.test.ts
 * and the agent conformance suite); its siblings for the other kinds take
 * the same shape. `collectSpecReferences` is the walk exported for the
 * readers that ask the reverse question ("who references this?").
 */
import type {
  DescField,
  DescMessage,
  Message,
  MessageShape,
} from "@bufbuild/protobuf";
import { getOption, hasOption } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ConnectError } from "@connectrpc/connect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { reference_kind } from "@stigmer/protos/ai/stigmer/commons/apiresource/field_options_pb";
import type { UpdateVisibilityInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { Store } from "../../store/interface.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  permissionDeniedError,
} from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { kindEnumName } from "../apiresource-meta.js";
import { evaluateAuthorizer } from "./authorize.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import { messageFieldByName, metadataOf } from "./shapes.js";
import { findResourceByName, resolveName } from "./names.js";

const API_RESOURCE_REFERENCE_TYPE =
  "ai.stigmer.commons.apiresource.ApiResourceReference";

// ---------------------------------------------------------------------------
// The table.
// ---------------------------------------------------------------------------

/** One kind a spec may reference, and how the rule reads it (the module header). */
export interface ReferenceTargetKind {
  readonly kind: ApiResourceKind;
  readonly schema: DescMessage;
  /** Whether the run reads the target AS THE PERSON — the kinds the floor applies to. */
  readonly readByRun: boolean;
  /** The kind in the refusal copy's words, singular with the plural marker: "MCP server(s)". */
  readonly label: string;
  /** The CLI command a refusal points at, or undefined where the CLI has no verb for the kind. */
  readonly listHint: string | undefined;
  /**
   * What a writer must hold on a target their write introduces (the
   * writer clause of the module header), or undefined for a kind judged by
   * existence and the floor alone.
   */
  readonly writerMust: IamPermission | undefined;
}

export const REFERENCE_TARGET_KINDS: ReadonlyArray<ReferenceTargetKind> = [
  {
    kind: ApiResourceKind.skill,
    schema: SkillSchema,
    readByRun: true,
    label: "skill(s)",
    listHint: "stigmer list skills",
    writerMust: undefined,
  },
  {
    kind: ApiResourceKind.agent,
    schema: AgentSchema,
    readByRun: true,
    label: "agent(s)",
    listHint: "stigmer list agents",
    writerMust: undefined,
  },
  {
    kind: ApiResourceKind.plugin,
    schema: PluginSchema,
    readByRun: true,
    label: "plugin(s)",
    listHint: "stigmer list plugins",
    writerMust: undefined,
  },
  {
    kind: ApiResourceKind.vault,
    schema: VaultSchema,
    readByRun: false,
    label: "vault(s)",
    listHint: "stigmer list vaults",
    writerMust: IamPermission.can_use,
  },
  {
    kind: ApiResourceKind.channel_app,
    schema: ChannelAppSchema,
    readByRun: false,
    label: "channel app(s)",
    listHint: "stigmer list channel-app",
    writerMust: undefined,
  },
];

export function referenceTargetKind(
  kind: ApiResourceKind,
): ReferenceTargetKind | undefined {
  return REFERENCE_TARGET_KINDS.find((entry) => entry.kind === kind);
}

// ---------------------------------------------------------------------------
// The rule.
// ---------------------------------------------------------------------------

/**
 * One reference a spec carries, as the walker reads it; `kind` is the
 * field's declared kind. A stored reference holds its target's `id` and no
 * slug; a written one may hold a slug the resolver has not turned into an
 * id yet, which is a name nothing holds once NormalizeReferences has run.
 */
export interface SpecReference {
  readonly kind: ApiResourceKind;
  readonly id: string;
  readonly slug: string;
  readonly org: string;
  /** The version the reference names; empty or absent names none. */
  readonly version?: string;
}

/** The resource the references belong to, as the rule needs it. */
export interface ReferenceParent {
  readonly org: string;
  readonly visibility: ApiResourceVisibility;
}

/** What the rule found for one reference; the collectors turn it into copy. */
export type ReferenceVerdict =
  | { readonly kind: "ok" }
  /** Clause (i): the reference names no organization. */
  | { readonly kind: "no-org" }
  /** Clause (ii): the same-organization target does not exist. */
  | { readonly kind: "missing" }
  /** Clause (ii): the target exists and is less visible than the resource. */
  | {
      readonly kind: "below-floor";
      readonly targetVisibility: ApiResourceVisibility;
    }
  /** Clause (iii): the other-organization target is missing, not shared with child organizations, or not the writer's parent's — one answer. */
  | { readonly kind: "not-available" }
  /** The writer clause: the writer does not hold the kind's `writerMust` on the target. */
  | { readonly kind: "not-viewable" };

/** The visibility, id and name of every referenced row the rule may need, each read once (the module header). */
export interface ReferenceTargets {
  visibilityOf(ref: SpecReference): ApiResourceVisibility | undefined;
  idOf(ref: SpecReference): string | undefined;
  /** The target's own current slug, for the copy a person reads. */
  slugOf(ref: SpecReference): string | undefined;
  /**
   * The writing organization's parent, read only when a reference names
   * another organization; "" when it has none or none was needed.
   */
  readonly writerParentOrg: string;
}

/** One indexed target: what the floor reads, what the writer clause asks about, and its name. */
interface IndexedTarget {
  readonly visibility: ApiResourceVisibility;
  readonly id: string;
  readonly slug: string;
}

/**
 * Loads the rows the given references name: each distinct target read
 * once, by a point read of its id, or, for a reference still written by
 * name, through the name table (pipeline/steps/names.ts), so the rule
 * reads only the targets it judges. A row of another organization than the
 * reference names is no target of it. A reference whose kind is not in the
 * table is a contract the pin test has not admitted yet and is an internal
 * fault.
 */
export async function loadReferenceTargets(
  store: Store,
  refs: ReadonlyArray<SpecReference>,
  writerOrg: string,
): Promise<ReferenceTargets> {
  const found = new Map<string, IndexedTarget | undefined>();
  for (const ref of refs) {
    const entry = referenceTargetKind(ref.kind);
    if (entry === undefined) {
      throw internalError(
        new Error(
          `kind ${ApiResourceKind[ref.kind] ?? ref.kind} is not a reference target`,
        ),
        "reference rule table has no entry for the referenced kind",
      );
    }
    const key = referenceKey(ref);
    if (found.has(key) || ref.org === "" || (ref.id === "" && ref.slug === "")) {
      continue;
    }
    const target =
      ref.id !== ""
        ? await readReferenced(store, ref.kind, entry.schema, ref.id)
        : await findResourceByName(
            store,
            ref.kind,
            entry.schema,
            ref.org,
            ref.slug,
          );
    const metadata = target === undefined ? undefined : metadataOf(target);
    found.set(
      key,
      metadata === undefined || metadata.org !== ref.org
        ? undefined
        : {
            visibility: metadata.visibility,
            id: metadata.id,
            slug: metadata.slug,
          },
    );
  }
  const crosses = refs.some((ref) => ref.org !== "" && ref.org !== writerOrg);
  const writerParentOrg =
    crosses && writerOrg !== ""
      ? await parentOrgOfOrganization(store, writerOrg)
      : "";
  return {
    writerParentOrg,
    visibilityOf(ref) {
      return found.get(referenceKey(ref))?.visibility;
    },
    idOf(ref) {
      return found.get(referenceKey(ref))?.id;
    },
    slugOf(ref) {
      return found.get(referenceKey(ref))?.slug;
    },
  };
}

/**
 * What makes two references the same: their kind, organization and id, or,
 * for one still written by name, its slug.
 */
export function referenceKey(ref: SpecReference): string {
  return ref.id !== ""
    ? `${ref.kind}/${ref.org}/#${ref.id}`
    : `${ref.kind}/${ref.org}/${ref.slug}`;
}

/** A stored reference as the readers below take it. */
export interface HeldReference {
  readonly org: string;
  readonly id: string;
}

/**
 * The row a stored reference names: a point read by its id. Undefined when
 * the reference holds no id (a name nothing held when it was written), no
 * row of the kind holds the id (the target was deleted), or the row
 * belongs to another organization than the reference names.
 */
export async function loadReferenced<Desc extends DescMessage>(
  store: Store,
  kind: ApiResourceKind,
  schema: Desc,
  ref: HeldReference,
): Promise<MessageShape<Desc> | undefined> {
  if (ref.id === "") {
    return undefined;
  }
  const row = (await readReferenced(store, kind, schema, ref.id)) as
    | MessageShape<Desc>
    | undefined;
  return row !== undefined && metadataOf(row)?.org === ref.org ? row : undefined;
}

/**
 * The resource a reference REQUEST names (getByReference and the server
 * readers that load a reference they were handed): by its id, a point read
 * whose row must belong to the reference's organization when it names one;
 * else by its org and slug through the name table. A reference carrying
 * both is refused when the slug names a different resource
 * (INVALID_ARGUMENT, the resolver's rule). Undefined when nothing matches.
 */
export async function findByReference<Desc extends DescMessage>(
  store: Store,
  kind: ApiResourceKind,
  schema: Desc,
  ref: { readonly org: string; readonly id: string; readonly slug: string },
): Promise<MessageShape<Desc> | undefined> {
  if (ref.id === "") {
    return findResourceByName(store, kind, schema, ref.org, ref.slug);
  }
  const row = (await readReferenced(store, kind, schema, ref.id)) as
    | MessageShape<Desc>
    | undefined;
  const metadata = row === undefined ? undefined : metadataOf(row);
  if (metadata === undefined || (ref.org !== "" && metadata.org !== ref.org)) {
    return undefined;
  }
  if (ref.slug !== "" && ref.slug !== metadata.slug) {
    const named = await resolveName(store, kind, metadata.org, ref.slug);
    if (named !== undefined && named !== ref.id) {
      throw invalidArgumentError(
        `reference names '${ref.slug}' and id '${ref.id}', which are not the same resource; name it by its slug, by its id, or by both when they agree.`,
      );
    }
  }
  return row;
}

/**
 * The name a person reads for a stored reference in copy: its target's
 * current slug, else the slug it was written with, else its id (a target
 * that is gone has no name).
 */
export async function referenceDisplayName(
  store: Pick<Store, "resourceNames">,
  kind: ApiResourceKind,
  ref: HeldReference & { readonly slug: string },
): Promise<string> {
  if (ref.slug !== "" || ref.id === "") {
    return ref.slug;
  }
  const entry = await store.resourceNames.current(
    kindEnumName(kind),
    ref.org,
    ref.id,
  );
  return entry?.name ?? ref.id;
}

/**
 * The names a person reads for many stored references of one kind, in one
 * read of the name table (`currentMany`), in the order given: each one's
 * referenceDisplayName.
 */
export async function referenceDisplayNames(
  store: Pick<Store, "resourceNames">,
  kind: ApiResourceKind,
  refs: ReadonlyArray<HeldReference & { readonly slug: string }>,
): Promise<string[]> {
  const kindName = kindEnumName(kind);
  const held = refs.filter((ref) => ref.slug === "" && ref.id !== "");
  const entries =
    held.length === 0
      ? []
      : await store.resourceNames.currentMany(
          held.map((ref) => ({ kind: kindName, org: ref.org, id: ref.id })),
        );
  const names = new Map(entries.map((e) => [`${e.org}/${e.id}`, e.name]));
  return refs.map((ref) =>
    ref.slug !== "" || ref.id === ""
      ? ref.slug
      : (names.get(`${ref.org}/${ref.id}`) ?? ref.id),
  );
}

/** A row by id, or undefined when no row of the kind holds it. */
async function readReferenced(
  store: Store,
  kind: ApiResourceKind,
  schema: DescMessage,
  id: string,
): Promise<Message | undefined> {
  try {
    return await store.getResource(kind, id, schema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw internalError(error, "failed to read a referenced resource");
  }
}

/** An organization's `spec.parent_org`; "" when it has none or its row is gone. */
async function parentOrgOfOrganization(
  store: Store,
  org: string,
): Promise<string> {
  try {
    const organization = await store.getResource(
      ApiResourceKind.organization,
      org,
      OrganizationSchema,
    );
    return organization.spec?.parentOrg ?? "";
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return "";
    }
    throw internalError(error, "failed to read the writing organization");
  }
}

/** The three clauses of the module header, for one reference. */
export function checkReference(
  targets: ReferenceTargets,
  parent: ReferenceParent,
  ref: SpecReference,
): ReferenceVerdict {
  if (ref.org === "") {
    return { kind: "no-org" };
  }
  const target = targets.visibilityOf(ref);
  if (ref.org !== parent.org) {
    return target === ApiResourceVisibility.visibility_child_orgs &&
      targets.writerParentOrg !== "" &&
      ref.org === targets.writerParentOrg
      ? { kind: "ok" }
      : { kind: "not-available" };
  }
  if (target === undefined) {
    return { kind: "missing" };
  }
  const entry = referenceTargetKind(ref.kind);
  if (
    entry?.readByRun === true &&
    visibilityRank(target) < visibilityRank(parent.visibility)
  ) {
    return { kind: "below-floor", targetVisibility: target };
  }
  return { kind: "ok" };
}

/** The writer a write's references are judged for (the module header's writer clause). */
export interface ReferenceWriter {
  readonly authorizer: Authorizer;
  readonly caller: CallerIdentity;
  /** The references the stored row already carries; empty on a create. */
  readonly stored: ReadonlyArray<SpecReference>;
}

/**
 * The writer clause for one reference that cleared the three clauses:
 * `ok` unless its kind names a `writerMust` (or the caller passes the
 * permission, for a clause one field carries and its kind does not: an
 * agent's subagents, domain/agent/subagents.ts), the reference is the
 * write's own (same organization, not already on the stored row), the
 * writer is not the server itself, and the Authorizer does not admit the
 * writer. A
 * target the Authorizer cannot find has left since the scan and is the
 * `missing` verdict; an evaluation failure is thrown as an infrastructure
 * fault, never answered as a refusal or an admission.
 */
export async function checkWriter(
  targets: ReferenceTargets,
  parent: ReferenceParent,
  ref: SpecReference,
  writer: ReferenceWriter,
  fieldMust?: IamPermission,
): Promise<ReferenceVerdict> {
  const permission = fieldMust ?? referenceTargetKind(ref.kind)?.writerMust;
  if (
    permission === undefined ||
    ref.org !== parent.org ||
    writer.caller.callerClass === "internal" ||
    writer.stored.some((held) => sameReference(held, ref))
  ) {
    return { kind: "ok" };
  }
  // The three clauses admitted a same-organization target only if the scan
  // found it, so its id is known; a row that left since then is the
  // Authorizer's not-found, read as missing below.
  const resourceId = targets.idOf(ref) ?? "";
  const decision = await evaluateAuthorizer(writer.authorizer, writer.caller, {
    permission,
    resourceKind: ref.kind,
    resourceId,
  });
  if (decision.kind === "allow") {
    return { kind: "ok" };
  }
  if (decision.kind === "deny") {
    return { kind: "not-viewable" };
  }
  if (decision.kind === "not-found") {
    return { kind: "missing" };
  }
  throw internalError(
    decision.cause,
    "failed to authorize a referenced resource",
  );
}

function sameReference(a: SpecReference, b: SpecReference): boolean {
  return referenceKey(a) === referenceKey(b);
}

/**
 * The order the floor compares on: private < org < child_orgs, an unset
 * level reading as private (the level a row with no config holds). The
 * retired public level is unreachable here — refused at every door and
 * moved off every stored row by the store migration — so meeting it is a
 * fault, not a rank.
 */
function visibilityRank(level: ApiResourceVisibility): number {
  switch (level) {
    case ApiResourceVisibility.api_resource_visibility_unspecified:
    case ApiResourceVisibility.visibility_private:
      return 0;
    case ApiResourceVisibility.visibility_org:
      return 1;
    case ApiResourceVisibility.visibility_child_orgs:
      return 2;
    case ApiResourceVisibility.visibility_public:
      throw new Error("the retired public level has no rank");
    default: {
      const exhaustive: never = level;
      throw new Error(`unknown visibility level: ${String(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// The copy.
// ---------------------------------------------------------------------------

/** Clause (i)'s sentence. */
export function noOrgReferenceMessage(
  entry: ReferenceTargetKind,
  slug: string,
): string {
  return `referenced ${entry.label} '${slug}' names no organization; a reference is 'org/slug', or 'slug' for a resource of this organization.`;
}

/**
 * Clause (ii)'s sentence for the targets not found, one per kind. The MCP
 * server form is the wire contract that predates the rule; the others are
 * its siblings.
 */
export function missingReferencesMessage(
  entry: ReferenceTargetKind,
  handles: ReadonlyArray<{ readonly slug: string; readonly org: string }>,
): string {
  const list = handles.map((h) => `'${h.slug}' (org: ${h.org})`).join(", ");
  const hint =
    entry.listHint === undefined
      ? ""
      : ` Use '${entry.listHint}' to list available ${plural(entry)}.`;
  return `referenced ${entry.label} not found: ${list}. Verify the slug and org are correct.${hint}`;
}

/** Clause (ii)'s floor sentence: the dependency and its level, against the resource's. */
export function belowFloorMessage(
  entry: ReferenceTargetKind,
  ref: SpecReference,
  targetVisibility: ApiResourceVisibility,
  parentVisibility: ApiResourceVisibility,
): string {
  return `referenced ${singular(entry)} '${ref.org}/${ref.slug}' is ${levelWord(targetVisibility)} while this resource is ${levelWord(parentVisibility)}; a resource may not be more visible than the ${plural(entry)} it runs with. Widen the referenced resource's visibility or narrow this one.`;
}

/** The level as the copy names it: an unset level reads as private, which is how every reader treats it. */
function levelWord(level: ApiResourceVisibility): string {
  return level === ApiResourceVisibility.api_resource_visibility_unspecified
    ? ApiResourceVisibility[ApiResourceVisibility.visibility_private]
    : ApiResourceVisibility[level];
}

/**
 * Clause (iii)'s one sentence — the same whether the target is missing,
 * not shared with child organizations, or another parent's, and whether
 * the organization it names exists: the
 * other organization is not named at all, because a name the edge resolved
 * would come back as that organization's id and a name nobody holds as
 * written, which would tell the writer which names exist.
 */
export function notAvailableReferenceMessage(
  entry: ReferenceTargetKind,
  ref: SpecReference,
): string {
  return `referenced ${singular(entry)} '${ref.slug}' of another organization is not available to this organization; another organization's resource can be referenced only when it is this organization's parent and shares it with its child organizations.`;
}

/** The writer clause's sentence: the target, and what the writer may attach instead. */
export function notViewableReferenceMessage(
  entry: ReferenceTargetKind,
  ref: SpecReference,
): string {
  if (entry.kind === ApiResourceKind.vault) {
    // The vault row's writer clause asks can_use: a member may see a
    // shared vault without being allowed to use it, and nobody else may
    // use a person's My vault.
    return `referenced vault '${ref.org}/${ref.slug}' is not one you may use; attach a vault you have been allowed to use, or ask a vault admin for its use.`;
  }
  return `referenced ${singular(entry)} '${ref.org}/${ref.slug}' is not one you can view; attach ${article(entry)} ${singular(entry)} you own or one shared with the organization.`;
}

/** The indefinite article before the kind's singular label. */
function article(entry: ReferenceTargetKind): string {
  return /^[aeiou]/i.test(singular(entry)) ? "an" : "a";
}

/** "MCP server(s)" → "MCP server" and "MCP servers": the label's two readings. */
function singular(entry: ReferenceTargetKind): string {
  return entry.label.replace("(s)", "");
}

function plural(entry: ReferenceTargetKind): string {
  return entry.label.replace("(s)", "s");
}

/**
 * The refusal for a set of verdicts, or undefined when every one is ok.
 * Missing same-organization targets are grouped per kind into one sentence
 * (the contract's shape); every other refusal is its own sentence; the
 * sentences are joined in the order the references were read. A no-org
 * reference is malformed input (INVALID_ARGUMENT); a target the writer may
 * not attach is PERMISSION_DENIED (the writer clause); everything else is
 * a precondition the store does not meet (FAILED_PRECONDITION), the code
 * the MCP-server contract already answers. The first that applies, in
 * that order, is the code of the whole refusal.
 */
export function referenceRefusal(
  parent: ReferenceParent,
  verdicts: ReadonlyArray<{
    readonly ref: SpecReference;
    readonly verdict: ReferenceVerdict;
  }>,
): ConnectError | undefined {
  // Missing same-organization targets, grouped per kind in the order the
  // first of each kind was read.
  const missingByKind = new Map<ApiResourceKind, SpecReference[]>();
  for (const { ref, verdict } of verdicts) {
    if (verdict.kind === "missing") {
      const held = missingByKind.get(ref.kind);
      if (held === undefined) {
        missingByKind.set(ref.kind, [ref]);
      } else {
        held.push(ref);
      }
    }
  }
  const sentences: string[] = [];
  const groupedKindsSaid = new Set<ApiResourceKind>();
  let malformed = false;
  let notPermitted = false;
  for (const { ref, verdict } of verdicts) {
    const entry = referenceTargetKind(ref.kind);
    if (entry === undefined) {
      continue;
    }
    switch (verdict.kind) {
      case "ok":
        break;
      case "no-org":
        malformed = true;
        sentences.push(noOrgReferenceMessage(entry, ref.slug));
        break;
      case "missing":
        if (!groupedKindsSaid.has(ref.kind)) {
          groupedKindsSaid.add(ref.kind);
          sentences.push(
            missingReferencesMessage(entry, missingByKind.get(ref.kind) ?? []),
          );
        }
        break;
      case "below-floor":
        sentences.push(
          belowFloorMessage(
            entry,
            ref,
            verdict.targetVisibility,
            parent.visibility,
          ),
        );
        break;
      case "not-available":
        sentences.push(notAvailableReferenceMessage(entry, ref));
        break;
      case "not-viewable":
        notPermitted = true;
        sentences.push(notViewableReferenceMessage(entry, ref));
        break;
      default: {
        const exhaustive: never = verdict;
        throw new Error(`unknown verdict: ${JSON.stringify(exhaustive)}`);
      }
    }
  }
  if (sentences.length === 0) {
    return undefined;
  }
  const text = sentences.join(" ");
  if (malformed) {
    return invalidArgumentError(text);
  }
  return notPermitted
    ? permissionDeniedError(text)
    : failedPreconditionError(text);
}

// ---------------------------------------------------------------------------
// The steps.
// ---------------------------------------------------------------------------

/**
 * Resolves every reference in a resource's spec in place (the module
 * header's resolution): see resolveReferencesIn.
 */
export async function resolveReferences(
  store: Store,
  schema: DescMessage,
  resource: Message,
  defaultOrg: string,
  now: Date = new Date(),
): Promise<void> {
  const found: Array<{ ref: ReflectMessage; field: DescField }> = [];
  forEachSpecReference(schema, resource, (ref, field) => found.push({ ref, field }));
  await resolveFound(store, found, defaultOrg, now);
}

/**
 * Resolves every reference anywhere in a message in place, not only under
 * `spec`: for a request that carries a reference of its own (the federated
 * account inputs, domain/identityaccount/controller.ts). For each one:
 *
 *   - an empty `org` takes `defaultOrg`;
 *   - a `kind` other than the field's `reference_kind` is refused
 *     (INVALID_ARGUMENT), and an empty one takes it;
 *   - a slug is resolved to its id through the name table, each distinct
 *     (kind, org, slug) once, a previous name included; the id is set and
 *     the slug cleared. An id the write also carries must be the one the
 *     slug names when the slug names one, or the write is refused naming
 *     both (INVALID_ARGUMENT). Beside an id, a slug nothing holds is a
 *     name read before its resource was deleted (a reader writing back
 *     what it read): the id stands and the slug is cleared;
 *   - a slug nothing holds and no id are left as written, for the
 *     reference rule to refuse as a missing target, so resolving never
 *     says which names exist.
 *
 * Idempotent: a reference that holds an id and no slug is left as it is.
 */
export async function resolveReferencesIn(
  store: Store,
  schema: DescMessage,
  message: Message,
  defaultOrg: string,
  now: Date = new Date(),
): Promise<void> {
  const found: Array<{ ref: ReflectMessage; field: DescField }> = [];
  walk(reflect(schema, message), (ref, field) => found.push({ ref, field }));
  await resolveFound(store, found, defaultOrg, now);
}

async function resolveFound(
  store: Store,
  found: ReadonlyArray<{ ref: ReflectMessage; field: DescField }>,
  defaultOrg: string,
  now: Date,
): Promise<void> {
  const resolved = new Map<string, string | undefined>();
  for (const { ref, field } of found) {
    const orgField = fieldNamed(ref, "org");
    if (defaultOrg !== "" && stringField(ref, "org") === "") {
      ref.set(orgField, defaultOrg);
    }
    const kind = settleKind(ref, field);
    const org = stringField(ref, "org");
    const slug = stringField(ref, "slug");
    if (slug === "" || org === "") {
      continue;
    }
    const key = `${kind}/${org}/${slug}`;
    if (!resolved.has(key)) {
      resolved.set(key, await resolveName(store, kind, org, slug, now));
    }
    const named = resolved.get(key);
    const written = stringField(ref, "id");
    if (written !== "" && named !== undefined && written !== named) {
      throw invalidArgumentError(
        `${field.name} names '${slug}' and id '${written}', which are not the same resource; name it by its slug, by its id, or by both when they agree.`,
      );
    }
    if (named === undefined && written === "") {
      continue;
    }
    ref.set(fieldNamed(ref, "id"), named ?? written);
    ref.set(fieldNamed(ref, "slug"), "");
  }
}

/**
 * The kind a reference names, written onto it: the field's declared kind
 * when the contract declares one. A reference that names another kind is
 * refused, with the copy the contract's per-field rules answered before the
 * declaration became the one rule.
 */
function settleKind(ref: ReflectMessage, field: DescField): ApiResourceKind {
  const written = numberField(ref, "kind") as ApiResourceKind;
  if (!hasOption(field, reference_kind)) {
    return written;
  }
  const declared = getOption(field, reference_kind);
  if (written === ApiResourceKind.api_resource_kind_unknown) {
    ref.set(fieldNamed(ref, "kind"), declared);
  } else if (written !== declared) {
    const target = field.fieldKind === "list" ? "resources" : "a resource";
    throw invalidArgumentError(
      `${field.name} must reference ${target} with kind=${ApiResourceKind[declared]}`,
    );
  }
  return declared;
}

function fieldNamed(msg: ReflectMessage, name: string): DescField {
  const field = msg.fields.find((f) => f.name === name);
  if (field === undefined) {
    throw new Error(`${msg.desc.typeName} has no field ${name}`);
  }
  return field;
}

/**
 * NormalizeReferences: every reference the spec carries resolved to its
 * id (resolveReferences), its org defaulting to the resource's own. Runs
 * as soon as the resource's organization is known and before any step that
 * reads a reference (the module header), so no step meets a reference in
 * two shapes.
 */
export function newNormalizeReferencesStep<Desc extends DescMessage>(
  store: Store,
): PipelineStep<Desc> {
  return {
    name: "NormalizeReferences",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const metadata = metadataOf(ctx.newState);
      if (metadata === undefined) {
        throw internalError(
          new Error("resource metadata is nil"),
          "normalize references",
        );
      }
      // With no org to default to, an org-less reference stays empty, and
      // the rule's first clause refuses it.
      await resolveReferences(store, ctx.schema, ctx.newState, metadata.org);
    },
  };
}

/** Whether a collected reference names anything: an unset message field collects as neither id nor slug. */
function isSet(ref: SpecReference): boolean {
  return ref.id !== "" || ref.slug !== "";
}

/** Which references ValidateReferences judges (the module header). */
export interface ValidateReferencesOptions {
  /**
   * `every` (the default): every reference the spec carries. `introduced`:
   * only those the stored row does not already carry (by kind,
   * organization and id); a create judges every one either way.
   */
  readonly judge?: "every" | "introduced";
}

/**
 * ValidateReferences: the references the spec carries, judged for the
 * request's caller against the stored row (EXISTING_RESOURCE_KEY on an
 * update; none on a create) — the module header's clauses and its writer
 * clause. Under `introduced`, it reads nothing when the write introduces
 * no reference. A later step that needs a target reads the reference's id,
 * which NormalizeReferences set.
 */
export function newValidateReferencesStep<Desc extends DescMessage>(
  store: Store,
  authorizer: Authorizer,
  options: ValidateReferencesOptions = {},
): PipelineStep<Desc> {
  return {
    name: "ValidateReferences",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const metadata = metadataOf(ctx.newState);
      if (metadata === undefined) {
        throw internalError(
          new Error("resource metadata is nil"),
          "validate references",
        );
      }
      const refs = collectSpecReferences(ctx.schema, ctx.newState).filter(
        isSet,
      );
      if (refs.length === 0) {
        return;
      }
      const parent: ReferenceParent = {
        org: metadata.org,
        visibility: metadata.visibility,
      };
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Message | undefined;
      const stored =
        existing === undefined
          ? []
          : collectSpecReferences(ctx.schema, existing);
      const judged =
        options.judge === "introduced"
          ? refs.filter(
              (ref) => !stored.some((held) => sameReference(held, ref)),
            )
          : refs;
      if (judged.length === 0) {
        return;
      }
      const targets = await loadReferenceTargets(store, judged, parent.org);
      const refusal = await judgeReferences(targets, store, parent, judged, {
        authorizer,
        caller: ctx.callerIdentity,
        stored,
      });
      if (refusal !== undefined) {
        throw refusal;
      }
    },
  };
}

/**
 * The rule over a collected list for one writer: load once, check each
 * against the three clauses and then the writer clause, render the
 * refusal.
 */
export async function checkReferences(
  store: Store,
  parent: ReferenceParent,
  refs: ReadonlyArray<SpecReference>,
  writer: ReferenceWriter,
): Promise<ReturnType<typeof referenceRefusal>> {
  return judgeReferences(
    await loadReferenceTargets(store, refs, parent.org),
    store,
    parent,
    refs,
    writer,
  );
}

/** checkReferences over targets already loaded. */
async function judgeReferences(
  targets: ReferenceTargets,
  store: Store,
  parent: ReferenceParent,
  refs: ReadonlyArray<SpecReference>,
  writer: ReferenceWriter,
): Promise<ReturnType<typeof referenceRefusal>> {
  const verdicts: Array<{ ref: SpecReference; verdict: ReferenceVerdict }> = [];
  for (const ref of refs) {
    const verdict = checkReference(targets, parent, ref);
    verdicts.push({
      ref,
      verdict:
        verdict.kind === "ok"
          ? await checkWriter(targets, parent, ref, writer)
          : verdict,
    });
  }
  return referenceRefusal(
    parent,
    await namedForPeople(store, targets, parent, verdicts),
  );
}

/**
 * The verdicts named for the refusal's copy: references are judged by id,
 * but a person reads the sentence. Each target is named by its own current
 * slug (a reference still written by name keeps the name it was written
 * with; one whose id names nothing is named by that id), and the writer's
 * own organization by its slug. Another organization is never named by a
 * refusal at all (notAvailableReferenceMessage says why).
 */
async function namedForPeople<
  V extends { readonly ref: SpecReference; readonly verdict: ReferenceVerdict },
>(
  store: Store,
  targets: ReferenceTargets,
  parent: ReferenceParent,
  given: ReadonlyArray<V>,
): Promise<ReadonlyArray<V>> {
  const verdicts = given.map((verdict) =>
    verdict.ref.slug !== ""
      ? verdict
      : {
          ...verdict,
          ref: {
            ...verdict.ref,
            slug: targets.slugOf(verdict.ref) ?? verdict.ref.id,
          },
        },
  );
  // Only a refusal is read by a person; a write that passes reads nothing.
  const refusesOwn = verdicts.some(
    ({ ref, verdict }) => ref.org === parent.org && verdict.kind !== "ok",
  );
  if (parent.org === "" || !refusesOwn) {
    return verdicts;
  }
  const slug = (
    await store.resourceNames.current(ApiResourceKind[ApiResourceKind.organization], "", parent.org)
  )?.name;
  if (slug === undefined || slug === parent.org) {
    return verdicts;
  }
  return verdicts.map((verdict) =>
    verdict.ref.org === parent.org ? { ...verdict, ref: { ...verdict.ref, org: slug } } : verdict,
  );
}

/** The references a stored row carries, for the escalation door; a chain passes one collector per place its row keeps them. */
export type ReferenceCollector = (row: Message) => ReadonlyArray<SpecReference>;

/**
 * The floor's second door (the module header): on an updateVisibility chain,
 * after the loaded row is on the context under `targetKey` and after
 * ValidateVisibilityUpdate, refuses raising the level while a run-read
 * reference the row carries would end below it.
 */
export function newGuardReferenceFloorOnEscalationStep(
  store: Store,
  targetKey: string,
  collectors: ReadonlyArray<ReferenceCollector>,
): PipelineStep<typeof UpdateVisibilityInputSchema> {
  return {
    name: "GuardReferenceFloorOnEscalation",
    async execute(
      ctx: RequestContext<typeof UpdateVisibilityInputSchema>,
    ): Promise<void> {
      const row = ctx.get(targetKey) as Message | undefined;
      if (row === undefined) {
        // Wiring error, not a user error: a guard that silently passes
        // un-guards the boundary it exists to protect.
        throw internalError(
          new Error(
            "GuardReferenceFloorOnEscalation ran without a loaded target — the step must follow the load step",
          ),
          "reference floor requires the loaded resource",
        );
      }
      const metadata = metadataOf(row);
      if (metadata === undefined) {
        throw internalError(
          new Error("resource metadata is nil"),
          "reference floor requires the loaded resource",
        );
      }
      const requested = ctx.input.visibility;
      if (visibilityRank(requested) <= visibilityRank(metadata.visibility)) {
        return;
      }
      const refs = collectors
        .flatMap((collect) => collect(row))
        .filter(isSet);
      if (refs.length === 0) {
        return;
      }
      const parent: ReferenceParent = {
        org: metadata.org,
        visibility: requested,
      };
      const targets = await loadReferenceTargets(store, refs, parent.org);
      const refusal = referenceRefusal(
        parent,
        await namedForPeople(
          store,
          targets,
          parent,
          refs
            .map((ref) => ({
              ref,
              verdict: checkReference(targets, parent, ref),
            }))
            .filter(({ verdict }) => verdict.kind === "below-floor"),
        ),
      );
      if (refusal !== undefined) {
        throw refusal;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The walk.
// ---------------------------------------------------------------------------

/**
 * Every ApiResourceReference in a resource's spec, each with the kind its
 * field declares — the walk both steps run, exported for the readers that
 * ask the reverse question ("who references this?"): the plugin delete
 * guard scans an organization's agents for references to a
 * member it is about to remove.
 */
export function collectSpecReferences(
  schema: DescMessage,
  msg: Parameters<typeof reflect>[1],
): SpecReference[] {
  const refs: SpecReference[] = [];
  forEachSpecReference(schema, msg, (ref, field) => {
    refs.push({
      kind: declaredKind(field, ref),
      id: stringField(ref, "id"),
      slug: stringField(ref, "slug"),
      org: stringField(ref, "org"),
      version: stringField(ref, "version"),
    });
  });
  return refs;
}

/**
 * The kind a reference names: the field's `reference_kind` option when the
 * contract declares one (every reference field does), else the kind the
 * message carries (the walk's only fallback, for a field the contract has
 * not annotated).
 */
function declaredKind(field: DescField, ref: ReflectMessage): ApiResourceKind {
  if (hasOption(field, reference_kind)) {
    return getOption(field, reference_kind);
  }
  return numberField(ref, "kind") as ApiResourceKind;
}

/**
 * Walks the resource's spec and invokes fn on every ApiResourceReference
 * (singular, repeated, and map-valued message fields, recursively) with
 * the field that holds it. Mutations through the ReflectMessage write
 * through.
 */
function forEachSpecReference(
  schema: DescMessage,
  msg: Parameters<typeof reflect>[1],
  fn: (ref: ReflectMessage, field: DescField) => void,
): void {
  const root = reflect(schema, msg);
  const specField = messageFieldByName(root, "spec");
  if (specField === undefined || !root.isSet(specField)) {
    return;
  }
  walk(root.get(specField), fn);
}

function walk(
  msg: ReflectMessage,
  fn: (ref: ReflectMessage, field: DescField) => void,
): void {
  for (const field of msg.fields) {
    if (field.fieldKind === "list") {
      if (field.listKind !== "message") {
        continue;
      }
      for (const item of msg.get(field)) {
        visit(item as ReflectMessage, field, fn);
      }
    } else if (field.fieldKind === "map") {
      if (field.mapKind !== "message") {
        continue;
      }
      const map = msg.get(field);
      for (const [, value] of map) {
        visit(value as ReflectMessage, field, fn);
      }
    } else if (field.fieldKind === "message") {
      if (!msg.isSet(field)) {
        continue;
      }
      visit(msg.get(field), field, fn);
    }
  }
}

function visit(
  sub: ReflectMessage,
  field: DescField,
  fn: (ref: ReflectMessage, field: DescField) => void,
): void {
  if (sub.desc.typeName === API_RESOURCE_REFERENCE_TYPE) {
    fn(sub, field);
  } else {
    walk(sub, fn);
  }
}

function stringField(msg: ReflectMessage, name: string): string {
  const field = msg.fields.find((f) => f.name === name);
  if (field === undefined) {
    return "";
  }
  const value = msg.get(field);
  return typeof value === "string" ? value : "";
}

function numberField(msg: ReflectMessage, name: string): number {
  const field = msg.fields.find((f) => f.name === name);
  if (field === undefined) {
    return 0;
  }
  const value = msg.get(field);
  return typeof value === "number" ? value : 0;
}
