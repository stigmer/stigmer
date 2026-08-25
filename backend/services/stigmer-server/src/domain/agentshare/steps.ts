/**
 * AgentShare domain steps — ports pkg/domain/agentshare/controller/steps.go
 * and the get_shared_profile.go helpers: share defaults + the cross-org
 * public-dependency contract (decision 013), the agent-id rebind pin, the
 * update immutability rules, the uniform-NotFound profile resolution
 * helpers, and the constant-time link-token predicate.
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
import { AgentShareAudience } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import {
  AGENT_REF_SLUG_REQUIRED_MESSAGE,
  ORG_REQUIRED_MESSAGE,
  SHARE_LINK_TOKEN_BYTES,
  agentRefImmutableMessage,
  crossOrgAudienceMessage,
  crossOrgBlockersMessage,
} from "./constants.js";

type AgentShareDesc = typeof AgentShareSchema;

/**
 * Context key for the agent resolved from spec.agent_ref during
 * create/apply, so later steps never re-load it — Go referencedAgentKey.
 * Module-private: only ResolveShareDefaults writes it and StampAgentPin
 * reads it, both in this file.
 */
const REFERENCED_AGENT_KEY = "agentShareReferencedAgent";

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
export function sharingLinkTokenAllowed(presented: string, live: string): boolean {
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
 *   2. Normalizes spec.agent_ref.org (empty means same-org) and loads the
 *      referenced agent — a nonexistent agent is refused with the same
 *      NOT_FOUND a direct agent lookup would produce.
 *   3. For a CROSS-ORG share, enforces the decision-013 contract.
 *   4. Defaults metadata.slug (and name) from the agent when the caller
 *      provided neither — the canonical share keeps the agent's hosted URL.
 *      Runs before ResolveSlug, which skips already-set slugs.
 */
export function newResolveShareDefaultsStep(store: Store): PipelineStep<AgentShareDesc> {
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

      const agent = await findAgentByOrgAndSlug(store, agentRef!.org, agentRef!.slug);
      if (agent === undefined) {
        throw notFoundError("Agent", agentRef!.slug);
      }

      if (agentRef!.org !== metadata!.org) {
        await validateCrossOrgShare(store, share, agent);
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
 * The cross-org share contract (decision 013) — Go validateCrossOrgShare:
 *   - The agent must be marketplace-public; a non-public agent is refused
 *     with the same NOT_FOUND as a missing one (no existence probe for
 *     private slugs).
 *   - The audience must be public — org-audience semantics don't carry
 *     across the org boundary.
 *   - Every declared dependency must itself be public; the refusal names
 *     every blocker (sorted) so the sharing org knows exactly what to ask
 *     the agent's org to publish.
 * Runtime re-enforcement is cloud-side; this create-time sweep is the
 * fail-loud half, mirrored in both editions.
 */
async function validateCrossOrgShare(
  store: Store,
  share: AgentShare,
  agent: Agent,
): Promise<void> {
  const agentMeta = agent.metadata;

  if (agentMeta?.visibility !== ApiResourceVisibility.visibility_public) {
    throw notFoundError("Agent", agentMeta?.slug ?? "");
  }

  // protobuf-es strips the shared enum prefix: proto
  // agent_share_audience_org generates as AgentShareAudience.org.
  if (share.spec?.audience === AgentShareAudience.org) {
    throw failedPreconditionError(crossOrgAudienceMessage(agentMeta.org));
  }

  const blockers = await findNonPublicDependencies(store, agent);
  if (blockers.length > 0) {
    throw failedPreconditionError(
      crossOrgBlockersMessage(agentMeta.org, agentMeta.slug, blockers),
    );
  }
}

/**
 * Sweeps the agent's declared blueprint dependencies — skill_refs
 * (including every sub-agent's) and mcp_server_usages — and returns a
 * deterministic "kind org/slug" entry for each that is missing or not
 * visibility_public — Go findNonPublicDependencies. A reference with an
 * empty org is relative to the AGENT's org (defensive parity with the
 * cloud edition's referenceMatches; agent writes normalize refs to
 * absolute form).
 */
async function findNonPublicDependencies(
  store: Store,
  agent: Agent,
): Promise<string[]> {
  const spec = agent.spec;
  const agentOrg = agent.metadata?.org ?? "";

  interface DepRef {
    kind: ApiResourceKind;
    org: string;
    slug: string;
  }

  const seen = new Set<string>();
  const deps: DepRef[] = [];
  const add = (kind: ApiResourceKind, ref: ApiResourceReference | undefined): void => {
    if (ref === undefined || ref.slug === "") {
      return;
    }
    const org = ref.org !== "" ? ref.org : agentOrg;
    const key = `${kind}|${org}|${ref.slug}`;
    if (!seen.has(key)) {
      seen.add(key);
      deps.push({ kind, org, slug: ref.slug });
    }
  };

  for (const ref of spec?.skillRefs ?? []) {
    add(ApiResourceKind.skill, ref);
  }
  for (const sub of spec?.subAgents ?? []) {
    for (const ref of sub.skillRefs) {
      add(ApiResourceKind.skill, ref);
    }
  }
  for (const usage of spec?.mcpServerUsages ?? []) {
    add(ApiResourceKind.mcp_server, usage.mcpServerRef);
  }

  const blockers: string[] = [];
  for (const dep of deps) {
    let visibility: ApiResourceVisibility | undefined;
    try {
      // Per-kind resolution, exactly Go's switch — skill and mcp_server
      // are the only dependency kinds an agent blueprint declares.
      const resolved =
        dep.kind === ApiResourceKind.skill
          ? await findResourceBySlug(store, dep.kind, SkillSchema, dep.slug, dep.org)
          : await findResourceBySlug(store, dep.kind, McpServerSchema, dep.slug, dep.org);
      visibility = resolved?.metadata?.visibility;
    } catch (error) {
      throw internalError(
        error,
        `failed to resolve ${ApiResourceKind[dep.kind]} ${dep.org}/${dep.slug} while validating cross-org share`,
      );
    }
    if (visibility !== ApiResourceVisibility.visibility_public) {
      blockers.push(`${ApiResourceKind[dep.kind]} ${dep.org}/${dep.slug}`);
    }
  }

  blockers.sort();
  return blockers;
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
 * keep referencing the same agent, and the cross-org public-audience rule
 * must hold on update too (update replaces the spec wholesale and must not
 * open a side door to an org-audience cross-org share). Runs after
 * LoadExisting. metadata.slug/org immutability needs no step — the generic
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
        (inputRef?.org ?? "") !== "" ? inputRef!.org : (existing.metadata?.org ?? "");

      if (
        (inputRef?.slug ?? "") !== (existingRef?.slug ?? "") ||
        inputOrg !== (existingRef?.org ?? "")
      ) {
        throw failedPreconditionError(
          agentRefImmutableMessage(existingRef?.org ?? "", existingRef?.slug ?? ""),
        );
      }

      const isCrossOrg = (existingRef?.org ?? "") !== (existing.metadata?.org ?? "");
      if (isCrossOrg && ctx.input.spec?.audience === AgentShareAudience.org) {
        throw failedPreconditionError(crossOrgAudienceMessage(existingRef?.org ?? ""));
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
 * and a cross-org agent no longer visibility_public (withdrawing public
 * visibility must kill every external channel).
 */
export async function buildSharedAgentProfile(
  store: Store,
  share: AgentShare,
): Promise<SharedAgentProfile> {
  const ref = share.spec?.agentRef;
  const agent = await findAgentByOrgAndSlug(store, ref?.org ?? "", ref?.slug ?? "");
  if (agent === undefined) {
    throw sharedNotFound(share.metadata?.slug ?? "");
  }

  const pin = share.status?.agentId ?? "";
  if (pin !== "" && pin !== (agent.metadata?.id ?? "")) {
    throw sharedNotFound(share.metadata?.slug ?? "");
  }

  const isCrossOrg = (share.metadata?.org ?? "") !== (agent.metadata?.org ?? "");
  if (
    isCrossOrg &&
    agent.metadata?.visibility !== ApiResourceVisibility.visibility_public
  ) {
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
