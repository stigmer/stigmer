/**
 * AgentShare domain steps — ports pkg/domain/agentshare/controller/steps.go
 * and the get_shared_profile.go helpers: share defaults and the
 * same-organization invariant on agent_ref, the agent-id rebind pin, the
 * update immutability rules, the uniform-NotFound profile resolution
 * helpers, and the constant-time link-token predicate.
 *
 * A share's agent lives in the share's own organization. The
 * cross-organization arm this domain once carried (a share of another
 * organization's public agent, gated on a public audience and a sweep of
 * the agent's dependencies for public visibility) left with the public
 * level; sharing another organization's agent is done by installing the
 * plugin that carries it and sharing the installed copy. A stored share
 * whose agent is in another organization — a row from before — fails
 * closed at the profile like a dangling reference.
 *
 * OD-1 (deliberate exclusion): Go's boot migration
 * (pkg/domain/agentshare/migration/bootstrap_shares.go — protowire
 * decoding of the REMOVED Agent.spec.sharing fields into AgentShare rows)
 * is NOT ported. It exists only for self-hosters upgrading a SQLite file
 * across the decision-011 promotion; a TS server adopting such a database
 * arrives at cutover (D4 #24), by which time the Go binary has already
 * run the backfill on every upgraded installation. Ratified in the D4
 * breakdown (entry #12) and disclosed in the PR.
 *
 * Proven by agentshare.conformance.test.ts (CONFORMANCE_TARGET=local)
 * and __tests__/agentshare.test.ts.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

import { create, fromBinary } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import type { AgentShare } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { AgentShareStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/status_pb";
import { SharedAgentProfileSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/io_pb";
import type { SharedAgentProfile } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import {
  AUTHORIZATION_UNAVAILABLE_MESSAGE,
  evaluateAuthorizer,
} from "../../pipeline/steps/authorize.js";
import type { AuthorizationTarget } from "../../pipeline/steps/authorize.js";
import type { GetByReferenceDesc } from "../../pipeline/steps/authorize-resolved-target.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import {
  AGENT_REF_SLUG_REQUIRED_MESSAGE,
  ORG_REQUIRED_MESSAGE,
  SHARE_LINK_TOKEN_BYTES,
  agentRefImmutableMessage,
  sameOrgInvariantMessage,
} from "./constants.js";

type AgentShareDesc = typeof AgentShareSchema;

/**
 * Context key for the agent resolved from spec.agent_ref during
 * create/apply, so later steps never re-load it — Go referencedAgentKey.
 * ResolveShareDefaults writes it; the create lane's authorization step and
 * StampAgentPin read it.
 */
export const REFERENCED_AGENT_KEY = "agentShareReferencedAgent";

/** The deny copy of the agent's bar, the Java AgentShareCreateHandler's. */
export const SHARE_AGENT_DENIED_MESSAGE =
  "You don't have permission to share this agent";

/** The deny copy of the sharing organization's bar, the Java handler's. */
export const SHARE_ORGANIZATION_DENIED_MESSAGE =
  "You don't have permission to create agent shares in this organization";

/**
 * The create lane's authorization questions, for AuthorizeResolvedTarget
 * after ResolveShareDefaults, agent first: can_edit on the agent (sharing
 * puts it in front of a wider audience, an editor's act) and then
 * can_create_agent_share on the organization (a share spends the
 * organization's credits on the open internet, an admin-level act). The
 * RPC is is_skip_authorization because the target is the referenced agent,
 * resolved from a slug, not a request field. The resolve step has already
 * made the reference absolute and refused an agent outside the share's
 * organization, so the two bars are always the same organization's.
 */
export function resolveShareCreateTargets(
  ctx: RequestContext<AgentShareDesc>,
): ReadonlyArray<AuthorizationTarget> {
  const agent = ctx.get(REFERENCED_AGENT_KEY) as Agent | undefined;
  if (agent === undefined) {
    throw new Error("referenced agent not found in context");
  }
  return [
    {
      permission: IamPermission.can_edit,
      resourceKind: ApiResourceKind.agent,
      resourceId: agent.metadata?.id ?? "",
      deniedMessage: SHARE_AGENT_DENIED_MESSAGE,
    },
    {
      permission: IamPermission.can_create_agent_share,
      resourceKind: ApiResourceKind.organization,
      resourceId: ctx.newState.metadata?.org ?? "",
      deniedMessage: SHARE_ORGANIZATION_DENIED_MESSAGE,
    },
  ];
}

/**
 * The single refusal for every anonymous/member resolution miss: share
 * missing, share disabled, dangling agent_ref, stale pin, wrong or absent
 * link token — Go sharedNotFound. The message deliberately says "Agent":
 * the visitor asked for an agent's chat page, and the share resource is an
 * internal modeling detail a public error must not teach. One constructor
 * guarantees the byte-identical-errors contract by construction.
 */
export function sharedNotFound(slug: string): ConnectError {
  return notFoundError("Agent", slug);
}

/**
 * AuthorizeMemberAudience — the member-profile lane's gate, membership
 * BEFORE existence: the Java AgentShareGetSharedProfileForMemberHandler
 * order. getSharedProfileForMember is the signed-in resolution path for a
 * share URL, and the proto pins its contract: a share that does not exist,
 * is disabled, or is asked for by someone who is not a member of the
 * sharing organization all answer the SAME NOT_FOUND, so a share URL
 * teaches a non-member nothing — not even whether the share exists. A
 * non-member resolving a public share uses the anonymous lane instead.
 *
 * The question is can_view on the organization named in the reference (the
 * viewer set: members and above), asked live on every call so a revoked
 * member loses access at once; the RPC is is_skip_authorization because
 * the target is the reference's organization, not a request field the
 * annotation can key on. This is deliberately NOT the shared
 * AuthorizeResolvedTarget step: that step answers deny with
 * PERMISSION_DENIED, and this lane's wire contract is the indistinguishable
 * NOT_FOUND above, so the lane keeps its own mapping over the same
 * evaluation (the decision form checkMyPermission uses). An empty org is
 * left to the loader's INVALID_ARGUMENT, the proto's own copy for it; an
 * unavailable authorizer is INTERNAL, never softened into a refusal; the
 * `internal` class is exempt as everywhere.
 */
export function newAuthorizeMemberAudienceStep(
  authorizer: Authorizer,
): PipelineStep<GetByReferenceDesc> {
  return {
    name: "AuthorizeMemberAudience",
    async execute(ctx: RequestContext<GetByReferenceDesc>): Promise<void> {
      const ref = ctx.input;
      if (ref.org === "" || ctx.callerIdentity.callerClass === "internal") {
        return;
      }
      const decision = await evaluateAuthorizer(
        authorizer,
        ctx.callerIdentity,
        {
          permission: IamPermission.can_view,
          resourceKind: ApiResourceKind.organization,
          resourceId: ref.org,
        },
      );
      switch (decision.kind) {
        case "allow":
          return;
        case "deny":
        case "not-found":
          throw sharedNotFound(ref.slug);
        case "unavailable":
          throw internalError(
            decision.cause,
            AUTHORIZATION_UNAVAILABLE_MESSAGE,
          );
        default: {
          const exhaustive: never = decision;
          throw internalError(
            new Error(`unknown decision ${JSON.stringify(exhaustive)}`),
            AUTHORIZATION_UNAVAILABLE_MESSAGE,
          );
        }
      }
    },
  };
}

/**
 * The link-token predicate — Go sharingLinkTokenAllowed, the mirror of the
 * cloud edition's SharingLinkTokenPolicy:
 *   - No live token: allowed (a stale ?k= on an unlocked link is harmless).
 *   - Live token set: the presented token must match exactly; a missing or
 *     rotated-away token refuses (surfacing as the uniform NotFound).
 *
 * Comparison is constant-time. Node's timingSafeEqual THROWS on unequal
 * lengths where Go's subtle.ConstantTimeCompare returns 0, so the length
 * guard restores Go's semantics; the length of a token is not secret (all
 * server-minted tokens are 27 chars).
 */
export function sharingLinkTokenAllowed(
  presented: string,
  live: string,
): boolean {
  if (live === "") {
    return true;
  }
  if (presented === "") {
    return false;
  }
  const presentedBytes = Buffer.from(presented);
  const liveBytes = Buffer.from(live);
  if (presentedBytes.length !== liveBytes.length) {
    return false;
  }
  return timingSafeEqual(presentedBytes, liveBytes);
}

/**
 * Fresh server-side entropy for status.share_link_token — Go
 * generateShareLinkToken: 20 crypto-random bytes, unpadded url-safe base64
 * (Node's "base64url" = Go's base64.RawURLEncoding), 27 characters.
 */
export function generateShareLinkToken(): string {
  return randomBytes(SHARE_LINK_TOKEN_BYTES).toString("base64url");
}

/**
 * Scans agents for an org+slug match — Go findAgentByOrgAndSlug. Full-scan
 * lookup matches the store's local/OSS posture; malformed rows are
 * skipped, as Go does. Module-private: consumed by the defaults resolver
 * and the profile projection, both in this file.
 */
async function findAgentByOrgAndSlug(
  store: Store,
  org: string,
  slug: string,
): Promise<Agent | undefined> {
  let rows: Uint8Array[];
  try {
    rows = await store.listResources(ApiResourceKind.agent);
  } catch (error) {
    throw internalError(error, "failed to list agent resources");
  }
  for (const data of rows) {
    let agent: Agent;
    try {
      agent = fromBinary(AgentSchema, data);
    } catch {
      continue;
    }
    if (agent.metadata?.slug === slug && agent.metadata.org === org) {
      return agent;
    }
  }
  return undefined;
}

/** Scans shares for an org+slug match — Go findShareByOrgAndSlug. */
export async function findShareByOrgAndSlug(
  store: Store,
  org: string,
  slug: string,
): Promise<AgentShare | undefined> {
  let rows: Uint8Array[];
  try {
    rows = await store.listResources(ApiResourceKind.agent_share);
  } catch (error) {
    throw internalError(error, "failed to list agent share resources");
  }
  for (const data of rows) {
    let share: AgentShare;
    try {
      share = fromBinary(AgentShareSchema, data);
    } catch {
      continue;
    }
    if (share.metadata?.slug === slug && share.metadata.org === org) {
      return share;
    }
  }
  return undefined;
}

/**
 * ResolveShareDefaults — Go resolveShareDefaultsStep:
 *   1. Requires metadata.org (URL + billing identity, never inferred).
 *   2. Normalizes spec.agent_ref.org (empty means same-org) and refuses an
 *      agent_ref that names another organization (the module header) with
 *      the same-organization sentence, BEFORE any lookup, so the share
 *      lane never says whether another organization's slug exists.
 *   3. Loads the referenced agent — a nonexistent agent is refused with
 *      the same NOT_FOUND a direct agent lookup would produce.
 *   4. Defaults metadata.slug (and name) from the agent when the caller
 *      provided neither — the canonical share keeps the agent's hosted URL.
 *      Runs before ResolveSlug, which skips already-set slugs.
 */
export function newResolveShareDefaultsStep(
  store: Store,
): PipelineStep<AgentShareDesc> {
  return {
    name: "ResolveShareDefaults",
    async execute(ctx: RequestContext<AgentShareDesc>): Promise<void> {
      const share = ctx.newState;
      const metadata = share.metadata;

      if ((metadata?.org ?? "") === "") {
        throw invalidArgumentError(ORG_REQUIRED_MESSAGE);
      }

      const agentRef = share.spec?.agentRef;
      if ((agentRef?.slug ?? "") === "") {
        throw invalidArgumentError(AGENT_REF_SLUG_REQUIRED_MESSAGE);
      }

      // Empty ref org means same-org (the platform-wide relative-reference
      // convention); make it absolute before anything compares orgs.
      if (agentRef!.org === "") {
        agentRef!.org = metadata!.org;
      }
      if (agentRef!.org !== metadata!.org) {
        throw failedPreconditionError(sameOrgInvariantMessage(agentRef!.org));
      }

      const agent = await findAgentByOrgAndSlug(
        store,
        agentRef!.org,
        agentRef!.slug,
      );
      if (agent === undefined) {
        throw notFoundError("Agent", agentRef!.slug);
      }

      ctx.set(REFERENCED_AGENT_KEY, agent);

      // Canonical-share default: no slug and no name means "share this
      // agent under its own slug". A caller-provided name still flows
      // through ResolveSlug for a deliberately distinct link.
      if (metadata!.slug === "" && metadata!.name === "") {
        metadata!.slug = agent.metadata?.slug ?? "";
        metadata!.name = agent.metadata?.name ?? "";
      }
    },
  };
}

/**
 * StampAgentPin — Go stampAgentPinStep: writes status.agent_id, the
 * server-owned rebind pin (decision 013). agent_ref is org+slug and slugs
 * are reusable after delete, so without the pin a stale share would
 * silently attach its audience, link token, and bound credentials to
 * whatever agent later claims the slug.
 *
 * Runs AFTER BuildNewState, which clears client-provided status — the pin
 * is system-managed and must survive that wipe, exactly like the audit
 * fields. Reads the agent ResolveShareDefaults already loaded.
 */
export function newStampAgentPinStep(): PipelineStep<AgentShareDesc> {
  return {
    name: "StampAgentPin",
    execute(ctx: RequestContext<AgentShareDesc>): void {
      const agent = ctx.get(REFERENCED_AGENT_KEY) as Agent | undefined;
      if (agent === undefined) {
        throw internalError(
          new Error("referenced agent not found in context"),
          "referenced agent not found in context (ResolveShareDefaults must run first)",
        );
      }

      const share = ctx.newState;
      const status = share.status ?? create(AgentShareStatusSchema);
      status.agentId = agent.metadata?.id ?? "";
      share.status = status;
    },
  };
}

/**
 * ValidateShareUpdate — Go validateShareUpdateStep: spec.agent_ref must
 * keep referencing the same agent. Runs after LoadExisting.
 * metadata.slug/org immutability needs no step — the generic
 * BuildUpdateState preserves both, and status (including the pin and link
 * token) wholesale.
 */
export function newValidateShareUpdateStep(): PipelineStep<AgentShareDesc> {
  return {
    name: "ValidateShareUpdate",
    execute(ctx: RequestContext<AgentShareDesc>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as AgentShare | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing agent share not found in context"),
          "existing agent share not found in context",
        );
      }

      const inputRef = ctx.input.spec?.agentRef;
      const existingRef = existing.spec?.agentRef;

      // Normalize the input ref's org the same way create does (empty
      // means the share's own org) before comparing.
      const inputOrg =
        (inputRef?.org ?? "") !== ""
          ? inputRef!.org
          : (existing.metadata?.org ?? "");

      if (
        (inputRef?.slug ?? "") !== (existingRef?.slug ?? "") ||
        inputOrg !== (existingRef?.org ?? "")
      ) {
        throw failedPreconditionError(
          agentRefImmutableMessage(
            existingRef?.org ?? "",
            existingRef?.slug ?? "",
          ),
        );
      }
    },
  };
}

/**
 * Projects a share and its referenced agent to the trimmed public profile
 * — Go buildSharedAgentProfile, the single projection shared by the
 * anonymous and member paths. URL identity (org, slug) comes from the
 * SHARE; display fields and default_instance_id from the AGENT. Three
 * misses all fail closed with the uniform refusal, indistinguishable from
 * absence: a dangling agent_ref, a stale agent-id pin (the rebind guard),
 * and an agent in another organization (a share written before the
 * same-organization invariant; this release serves no such share).
 */
export async function buildSharedAgentProfile(
  store: Store,
  share: AgentShare,
): Promise<SharedAgentProfile> {
  const ref = share.spec?.agentRef;
  const agent = await findAgentByOrgAndSlug(
    store,
    ref?.org ?? "",
    ref?.slug ?? "",
  );
  if (agent === undefined) {
    throw sharedNotFound(share.metadata?.slug ?? "");
  }

  const pin = share.status?.agentId ?? "";
  if (pin !== "" && pin !== (agent.metadata?.id ?? "")) {
    throw sharedNotFound(share.metadata?.slug ?? "");
  }

  if ((share.metadata?.org ?? "") !== (agent.metadata?.org ?? "")) {
    throw sharedNotFound(share.metadata?.slug ?? "");
  }

  return create(SharedAgentProfileSchema, {
    org: share.metadata?.org ?? "",
    slug: share.metadata?.slug ?? "",
    name: agent.metadata?.name ?? "",
    description: agent.spec?.description ?? "",
    iconUrl: agent.spec?.iconUrl ?? "",
    defaultInstanceId: agent.status?.defaultInstanceId ?? "",
  });
}
