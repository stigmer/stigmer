/**
 * References — the two shared steps every chain that stores a spec with
 * `ApiResourceReference` fields runs, and the ONE rule that decides whether
 * a reference may be written.
 *
 * NormalizeReferences fills EMPTY org fields in ApiResourceReference
 * messages inside the spec from the resource's own metadata.org, so stored
 * references are absolute; an explicit org is preserved. Only the spec is
 * walked — status is system-generated and already absolute. Runs after
 * BuildNewState/BuildUpdateState, before Persist.
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
 *        the resource's on the order private < org < platform — the FLOOR.
 *        What a person can run they must also be able to read: an
 *        org-visible agent over a private MCP server would run for every
 *        member and be readable by one. Environments, OAuth apps and
 *        channel apps are resolved by the server on the run's behalf, so
 *        their level is not a leak the floor closes, and an org-visible
 *        instance may hold its owner's private environment: attaching it
 *        is the owner's choice to let that instance's runs use it. A
 *        RELATIVE reference (below) is compared against the resource's
 *        level capped at org.
 *
 *        The WRITER clause, for the kinds whose row says what the writer
 *        must hold (`writerMust`): a same-organization reference the write
 *        INTRODUCES — one the stored row does not already carry — must
 *        name a target the writer holds that permission on, asked of the
 *        edition's Authorizer. Environments carry it with `can_view`: the
 *        server resolves an environment for the run, and the run is a
 *        person with a shell, so attaching a teammate's private
 *        environment by name would hand its values to the attacher. A
 *        refusal is PERMISSION_DENIED with its own sentence, the answer
 *        the read by reference already gives that writer. Judging only
 *        what a write introduces is the reserved-label guard's echo rule
 *        (guard-reserved-labels.ts): an edit that keeps an attachment
 *        someone else made passes. The server acting as itself (the
 *        `internal` class) is exempt, as at every authorization step.
 *        Two limits hold until access to an environment is its own
 *        permission: `can_view` is held by every member on an org-visible
 *        environment and by an explicit viewer grantee on a private one,
 *        and each of them may attach it; and an editor who keeps an
 *        attachment someone else made may change what consumes it (an
 *        `agent_call` task's agent, a schedule's agent), since who may edit
 *        the row is that kind's own permission. Grant view on an
 *        environment, and edit on a row that carries one, as you would its
 *        values.
 *   (iii) Another organization: the target must exist AND be
 *        platform-visible, answered with ONE sentence that does not say
 *        which failed. The caller has no standing to learn what another
 *        organization holds (the anti-probe posture the AgentShare lane set
 *        first). The rule reads the target's LEVEL, not tenancy: whether
 *        the writer's organization is one the target's identity provider
 *        links is the run-time authorizer's question, asked when the run
 *        reads the target, and the copy here claims no more than the rule
 *        checks. No Environment, OAuth app or channel app is ever
 *        platform-visible, so every cross-organization reference to one is
 *        refused here.
 *
 * The kind a reference names is the kind its FIELD declares
 * (`reference_kind`, the contract's word for what the field points to),
 * never the `kind` value a client happened to put on the message: the
 * runtime resolves `skill_refs` as skills whatever the message says, and
 * the rule must agree with the runtime. A reference with an empty slug is
 * unset and skipped (the field-level CEL rules own "required").
 *
 * A reference is RELATIVE when it names no organization of its own and
 * the runtime resolves it in the organization the resource RUNS in, not
 * the one it is stored in. Exactly one exists: a workflow `agent_call`
 * task's bare slug (domain/workflow/agent-call-references.ts), which the
 * runner resolves in the execution's organization; any workflow a person
 * may execute can run from another organization by id. The rule judges
 * it in the resource's own organization — the one its author can see, so
 * the target must exist there — and caps its floor at org: only the
 * running organization's own people ever read a target through it, and
 * they can read an org-visible one. The cap changes nothing for a
 * private or org resource and lets a platform-visible workflow call its
 * organization's org-visible agent. A value fixed only at run (an
 * `agent_call` agent holding a runtime expression) is not a reference at
 * all: the collector yields nothing for it, and the run reads the
 * resolved target as the person the run acts as, as it reads every
 * id-bound binding.
 *
 * The floor has a second door. Raising a resource's level through
 * updateVisibility could open the same gap a create cannot, so
 * GuardReferenceFloorOnEscalation runs on the two chains whose rows carry
 * run-read references (agent, workflow) after ValidateVisibilityUpdate:
 * when the requested level is above the stored one, every run-read
 * reference the STORED row carries must be at least the requested level
 * (a relative one, at least the requested level capped at org), judged by
 * the same function over the same collectors, else the escalation is
 * refused naming the dependencies. Only the floor is asked at
 * that door — a dependency that has since left or stopped being shared was
 * judged when the row was written and is the run's to refuse.
 *
 * REFERENCE_TARGET_KINDS is the one explicit table of kinds a spec may
 * reference, with each kind's schema and its `readByRun` flag: the
 * composition-root idiom (query/search/registry.ts) — an explicit list a
 * test pins against the protos, so a new `reference_kind` in the contract
 * fails the pin until this table says how it is read.
 *
 * Cost: one `listResources` scan per referenced KIND per write (not per
 * reference), decoded once into a (org, slug) index; the same scan every
 * runtime path already pays per reference when it resolves the target at
 * run start. A store read by (kind, org, slug) is the follow-on that
 * removes the scan everywhere, and is not this module's.
 *
 * The refusal copy is exported below. The MCP-server sentence predates the
 * rule and is wire contract (byte-pinned by pipeline/__tests__/steps.test.ts
 * and the agent conformance suite); its siblings for the other kinds take
 * the same shape. `collectSpecReferences` is the walk exported for the
 * readers that ask the reverse question ("who references this?").
 */
import type { DescField, DescMessage, Message } from "@bufbuild/protobuf";
import { fromBinary, getOption, hasOption } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ConnectError } from "@connectrpc/connect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { reference_kind } from "@stigmer/protos/ai/stigmer/commons/apiresource/field_options_pb";
import type { UpdateVisibilityInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { Store } from "../../store/interface.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  permissionDeniedError,
} from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { evaluateAuthorizer } from "./authorize.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import { messageFieldByName, metadataOf } from "./shapes.js";

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
    kind: ApiResourceKind.mcp_server,
    schema: McpServerSchema,
    readByRun: true,
    label: "MCP server(s)",
    listHint: "stigmer get mcp-servers",
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
    kind: ApiResourceKind.environment,
    schema: EnvironmentSchema,
    readByRun: false,
    label: "environment(s)",
    listHint: "stigmer list environments",
    writerMust: IamPermission.can_view,
  },
  {
    kind: ApiResourceKind.channel_app,
    schema: ChannelAppSchema,
    readByRun: false,
    label: "channel app(s)",
    listHint: "stigmer list channel-app",
    writerMust: undefined,
  },
  {
    kind: ApiResourceKind.oauth_app,
    schema: OAuthAppSchema,
    readByRun: false,
    label: "OAuth app(s)",
    listHint: undefined,
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

/** One reference a spec carries, as the walker reads it; `kind` is the field's declared kind. */
export interface SpecReference {
  readonly kind: ApiResourceKind;
  readonly slug: string;
  readonly org: string;
  /**
   * Present only on a RELATIVE reference (the module header): `org` is the
   * resource's own, filled by the collector, and the runtime resolves the
   * slug in the organization the resource runs in. The generic walker
   * never sets it; only the `agent_call` collector does.
   */
  readonly resolvesIn?: "running-organization";
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
  /** Clause (iii): the other-organization target is missing or not platform-visible — one answer. */
  | { readonly kind: "not-available" }
  /** The writer clause: the writer does not hold the kind's `writerMust` on the target. */
  | { readonly kind: "not-viewable" };

/** The visibility and id of every referenced row the rule may need, one scan per kind (the module header). */
export interface ReferenceTargets {
  visibilityOf(ref: SpecReference): ApiResourceVisibility | undefined;
  idOf(ref: SpecReference): string | undefined;
}

/** One indexed target: what the floor reads and what the writer clause asks about. */
interface IndexedTarget {
  readonly visibility: ApiResourceVisibility;
  readonly id: string;
}

/**
 * Loads the rows the given references could name: one `listResources` per
 * distinct kind, decoded once, indexed by (org, slug). A row that does not
 * decode is skipped as the slug helpers skip it — it is not a row a
 * reference can reach. A reference whose kind is not in the table is a
 * contract the pin test has not admitted yet and is an internal fault.
 */
export async function loadReferenceTargets(
  store: Store,
  refs: ReadonlyArray<SpecReference>,
): Promise<ReferenceTargets> {
  const byKind = new Map<ApiResourceKind, Map<string, IndexedTarget>>();
  for (const kind of new Set(refs.map((ref) => ref.kind))) {
    const entry = referenceTargetKind(kind);
    if (entry === undefined) {
      throw internalError(
        new Error(
          `kind ${ApiResourceKind[kind] ?? kind} is not a reference target`,
        ),
        "reference rule table has no entry for the referenced kind",
      );
    }
    const index = new Map<string, IndexedTarget>();
    for (const data of await store.listResources(kind)) {
      let metadata;
      try {
        metadata = metadataOf(fromBinary(entry.schema, data));
      } catch {
        continue;
      }
      if (metadata === undefined || metadata.slug === "") {
        continue;
      }
      index.set(targetKey(metadata.org, metadata.slug), {
        visibility: metadata.visibility,
        id: metadata.id,
      });
    }
    byKind.set(kind, index);
  }
  return {
    visibilityOf(ref) {
      return byKind.get(ref.kind)?.get(targetKey(ref.org, ref.slug))
        ?.visibility;
    },
    idOf(ref) {
      return byKind.get(ref.kind)?.get(targetKey(ref.org, ref.slug))?.id;
    },
  };
}

function targetKey(org: string, slug: string): string {
  return `${org}/${slug}`;
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
    return target === ApiResourceVisibility.visibility_platform
      ? { kind: "ok" }
      : { kind: "not-available" };
  }
  if (target === undefined) {
    return { kind: "missing" };
  }
  const entry = referenceTargetKind(ref.kind);
  if (
    entry?.readByRun === true &&
    visibilityRank(target) < visibilityRank(floorOf(parent, ref))
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
 * `ok` unless its kind names a `writerMust`, the reference is the write's
 * own (same organization, not already on the stored row), the writer is
 * not the server itself, and the Authorizer does not admit the writer. A
 * target the Authorizer cannot find has left since the scan and is the
 * `missing` verdict; an evaluation failure is thrown as an infrastructure
 * fault, never answered as a refusal or an admission.
 */
export async function checkWriter(
  targets: ReferenceTargets,
  parent: ReferenceParent,
  ref: SpecReference,
  writer: ReferenceWriter,
): Promise<ReferenceVerdict> {
  const permission = referenceTargetKind(ref.kind)?.writerMust;
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
  return a.kind === b.kind && a.org === b.org && a.slug === b.slug;
}

/**
 * The level a same-organization target must reach: the resource's own,
 * capped at org for a relative reference (the module header).
 */
function floorOf(
  parent: ReferenceParent,
  ref: SpecReference,
): ApiResourceVisibility {
  if (
    ref.resolvesIn === "running-organization" &&
    visibilityRank(parent.visibility) >
      visibilityRank(ApiResourceVisibility.visibility_org)
  ) {
    return ApiResourceVisibility.visibility_org;
  }
  return parent.visibility;
}

/**
 * The order the floor compares on: private < org < platform, an unset
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
    case ApiResourceVisibility.visibility_platform:
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
 * Clause (iii)'s one sentence — the same whether the target is missing or
 * not platform-visible, and whether the organization it names exists: the
 * other organization is not named at all, because a name the edge resolved
 * would come back as that organization's id and a name nobody holds as
 * written, which would tell the writer which names exist.
 */
export function notAvailableReferenceMessage(
  entry: ReferenceTargetKind,
  ref: SpecReference,
): string {
  return `referenced ${singular(entry)} '${ref.slug}' of another organization is not available to this organization; another organization's resource can be referenced only when that organization shares it at platform visibility.`;
}

/** The writer clause's sentence: the target, and what the writer may attach instead. */
export function notViewableReferenceMessage(
  entry: ReferenceTargetKind,
  ref: SpecReference,
): string {
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

export function newNormalizeReferencesStep<
  Desc extends DescMessage,
>(): PipelineStep<Desc> {
  return {
    name: "NormalizeReferences",
    execute(ctx: RequestContext<Desc>): void {
      const metadata = metadataOf(ctx.newState);
      if (metadata === undefined) {
        throw internalError(
          new Error("resource metadata is nil"),
          "normalize references",
        );
      }
      // No org to resolve from — skip silently; the rule's first clause
      // refuses a reference left without one.
      if (metadata.org === "") {
        return;
      }
      forEachSpecReference(ctx.schema, ctx.newState, (ref) => {
        const orgField = ref.fields.find((f) => f.name === "org");
        if (orgField !== undefined && (ref.get(orgField) as string) === "") {
          ref.set(orgField, metadata.org);
        }
      });
    },
  };
}

/**
 * ValidateReferences: every reference the spec carries, judged for the
 * request's caller against the stored row (EXISTING_RESOURCE_KEY on an
 * update; none on a create) — the module header's clauses and its writer
 * clause.
 */
export function newValidateReferencesStep<Desc extends DescMessage>(
  store: Store,
  authorizer: Authorizer,
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
        (ref) => ref.slug !== "",
      );
      if (refs.length === 0) {
        return;
      }
      const parent: ReferenceParent = {
        org: metadata.org,
        visibility: metadata.visibility,
      };
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Message | undefined;
      const refusal = await checkReferences(store, parent, refs, {
        authorizer,
        caller: ctx.callerIdentity,
        stored:
          existing === undefined
            ? []
            : collectSpecReferences(ctx.schema, existing),
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
  const targets = await loadReferenceTargets(store, refs);
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
  return referenceRefusal(parent, await namedForPeople(store, parent, verdicts));
}

/**
 * The verdicts with the writer's own organization named by its slug, for
 * the refusal's copy: references are judged by id, but a person reads the
 * sentence. Another organization is never named by a refusal at all
 * (notAvailableReferenceMessage says why).
 */
async function namedForPeople<
  V extends { readonly ref: SpecReference; readonly verdict: ReferenceVerdict },
>(
  store: Store,
  parent: ReferenceParent,
  verdicts: ReadonlyArray<V>,
): Promise<ReadonlyArray<V>> {
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
        .filter((ref) => ref.slug !== "");
      if (refs.length === 0) {
        return;
      }
      const parent: ReferenceParent = {
        org: metadata.org,
        visibility: requested,
      };
      const targets = await loadReferenceTargets(store, refs);
      const refusal = referenceRefusal(
        parent,
        await namedForPeople(
          store,
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
 * guard scans an organization's agents and workflows for references to a
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
      slug: stringField(ref, "slug"),
      org: stringField(ref, "org"),
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
