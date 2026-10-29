/**
 * Channel domain steps: the defaults every type shares (the same-org
 * invariant on agent_ref checked before the agent load, so no refusal says
 * whether another organization's slug exists; the write-time model-pin rule,
 * stigmer/stigmer#774; the one naming rule), the Slack and WhatsApp app_ref
 * rules and install state, the update immutability rules, and the web
 * channel's link: the uniform-NotFound profile resolution of the channel a
 * hosted chat link names by its id, and the constant-time link-token
 * predicate.
 *
 * One naming rule for every type: a channel created with neither a slug
 * nor a name takes the slug `<agent slug>-<type>` and the name
 * `<agent name> (<Type>)`, so a second nameless channel of one type on one
 * agent is a duplicate; a named channel takes its own slug.
 *
 * A channel's agent lives in the channel's own organization. A stored chat
 * link whose agent is in another organization fails closed at the profile
 * like a dangling reference: the anonymous page never shows another
 * organization's agent, whatever the stored reference says.
 *
 * Proven by channel.conformance.test.ts (CONFORMANCE_TARGET=local),
 * __tests__/channel.test.ts and __tests__/web-channel.test.ts.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import type { Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelAgentProfileSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/io_pb";
import type {
  ChannelAgentProfile,
  ChannelIdSchema,
} from "@stigmer/apis/ai/stigmer/agentic/channel/v1/io_pb";
import { ChannelSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import type { ChannelSpec } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import {
  ChannelInstallState,
  ChannelStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/channel/v1/status_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import {
  AUTHORIZATION_UNAVAILABLE_MESSAGE,
  evaluateAuthorizer,
} from "../../pipeline/steps/authorize.js";
import type { AuthorizationTarget } from "../../pipeline/steps/authorize.js";
import {
  loadReferenced,
  referenceDisplayName,
} from "../../pipeline/steps/references.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { fittedName, fittedSlug } from "../../pipeline/steps/slug.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { unknownModelPinRefusal } from "../../modelcatalog/pin-validation.js";
import { savedChoiceWithoutModelRefusal } from "../../modelcatalog/run-config-checks.js";
import type { ModelCatalogProvider } from "../../modelcatalog/model-catalog-provider.js";
import type { ChannelRuntime } from "./channel-runtime.js";
import {
  AGENT_REF_REQUIRED_MESSAGE,
  APP_REF_REQUIRED_FOR_WHATSAPP_MESSAGE,
  LINK_TOKEN_BYTES,
  ORG_REQUIRED_MESSAGE,
  agentRefImmutableMessage,
  appRefFrozenWhileInstalledMessage,
  appRefSameOrgMessage,
  sameOrgInvariantMessage,
  typeImmutableMessage,
} from "./constants.js";

type ChannelDesc = typeof ChannelSchema;

/** The display word of each type, for a nameless channel's name. */
const TYPE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  web: "Web",
  slack: "Slack",
  whatsapp: "WhatsApp",
};

/**
 * Whether a channel has a provider runtime: a Slack or WhatsApp channel
 * installs, delivers and is torn down through the composed channel
 * runtime; a web channel's runtime is the guest door.
 */
export function hasProviderRuntime(channel: Channel): boolean {
  const arm = channel.spec?.type.case;
  return arm === "slack" || arm === "whatsapp";
}

/**
 * The manifest vocabulary for the channel's type: the populated oneof
 * member's proto field name (what users declared in YAML), interpolated
 * into pinned error copy. protobuf-es surfaces the arm's camelCased
 * localName as the oneof `case`, which coincides with the proto name for
 * `web`, `slack` and `whatsapp` but would diverge for a future snake_case
 * arm, so the proto name is resolved through the schema descriptor.
 */
export function typeFieldName(spec: ChannelSpec | undefined): string {
  const arm = spec?.type.case;
  if (arm === undefined) {
    return "";
  }
  const oneof = ChannelSpecSchema.oneofs.find((o) => o.name === "type");
  return oneof?.fields.find((f) => f.localName === arm)?.name ?? arm;
}

/** The app reference a Slack or WhatsApp channel's settings carry; undefined for a web channel. */
function appRefOf(spec: ChannelSpec | undefined): ApiResourceReference | undefined {
  const type = spec?.type;
  if (type?.case === "slack" || type?.case === "whatsapp") {
    return type.value.appRef;
  }
  return undefined;
}

/**
 * The write-time model-pin existence rule (stigmer/stigmer#774) on a
 * channel's run_config: a typo'd pin would otherwise ride through opaquely
 * and silently run (and bill) as Auto wherever the channel serves. Validated
 * against every registry harness section (the "" harness mode) because
 * this edition stores channel specs without a serving runtime. Saved
 * settings name the model their tier or thinking is for. Shared by create
 * (ResolveChannelDefaults) and update (ValidateChannelUpdate).
 */
function validateChannelModelPin(
  registry: ModelCatalogProvider,
  spec: ChannelSpec | undefined,
): void {
  const reason =
    unknownModelPinRefusal(
      registry,
      "spec.run_config.model_name",
      "",
      spec?.runConfig?.modelName ?? "",
    ) ||
    savedChoiceWithoutModelRefusal(
      { fieldPath: "spec.run_config" },
      spec?.runConfig,
    );
  if (reason !== "") {
    throw invalidArgumentError(reason);
  }
}

/**
 * ResolveChannelDefaults:
 *   1. Requires metadata.org (the billing and credentials org, never
 *      inferred).
 *   2. Requires spec.agent_ref. NormalizeReferences ran first: its org is
 *      absolute (empty meant same-org) and a slug is the agent's id.
 *   3. Enforces the same-org invariant before the agent load; no refusal
 *      here names whether another org's slug exists.
 *   4. Validates the model pin and a Slack or WhatsApp channel's app_ref
 *      rules (WhatsApp requires one; any one must be the channel's org's).
 *   5. Loads the referenced agent by id: a nonexistent agent is refused
 *      with the same NOT_FOUND a direct agent lookup would produce.
 *   6. Names a nameless channel `<agent slug>-<type>` /
 *      `<agent name> (<Type>)` (the module header). Runs before ResolveSlug,
 *      which skips an already-set slug.
 *   7. Asks a composed runtime's write constraints, for a Slack or
 *      WhatsApp channel, last.
 *
 * Resolution is idempotent, so the apply pipeline running it before the
 * create pipeline re-runs it is harmless.
 */
export function newResolveChannelDefaultsStep(
  store: Store,
  registry: ModelCatalogProvider,
  channelRuntime: ChannelRuntime | undefined,
): PipelineStep<ChannelDesc> {
  return {
    name: "ResolveChannelDefaults",
    async execute(ctx: RequestContext<ChannelDesc>): Promise<void> {
      const channel = ctx.newState;
      const metadata = channel.metadata;

      if ((metadata?.org ?? "") === "") {
        throw invalidArgumentError(ORG_REQUIRED_MESSAGE);
      }

      const agentRef = channel.spec?.agentRef;
      if (!namesResource(agentRef)) {
        throw invalidArgumentError(AGENT_REF_REQUIRED_MESSAGE);
      }
      const refOrg = agentRef!.org;
      if (refOrg !== metadata!.org) {
        throw failedPreconditionError(sameOrgInvariantMessage(refOrg));
      }

      validateChannelModelPin(registry, channel.spec);

      const appRef = appRefOf(channel.spec);
      if (channel.spec?.type.case === "whatsapp" && !namesResource(appRef)) {
        throw invalidArgumentError(APP_REF_REQUIRED_FOR_WHATSAPP_MESSAGE);
      }
      // The organization's own app, checked before the agent load. No
      // provider-match check: the install flow resolves the app and fails
      // closed (open source has no install flow).
      if (namesResource(appRef) && appRef!.org !== metadata!.org) {
        throw failedPreconditionError(appRefSameOrgMessage(typeFieldName(channel.spec)));
      }

      let agent: Agent | undefined;
      try {
        agent = await loadReferenced(store, ApiResourceKind.agent, AgentSchema, agentRef!);
      } catch (error) {
        throw internalError(error, "failed to read the agent");
      }
      if (agent === undefined) {
        // Byte-identical with the direct agent lookup's refusal.
        throw notFoundError("Agent", agentRef!.slug !== "" ? agentRef!.slug : agentRef!.id);
      }
      ctx.set(REFERENCED_AGENT_KEY, agent);

      // A slug and name the server chooses are made to fit the metadata
      // rules (pipeline/steps/slug.ts), so a long agent slug still names
      // its channel.
      const type = typeFieldName(channel.spec);
      if (metadata!.slug === "" && metadata!.name === "" && type !== "") {
        metadata!.slug = fittedSlug(`${agent.metadata?.slug ?? ""}-${type}`);
        metadata!.name = fittedName(`${agent.metadata?.name ?? ""} (${TYPE_DISPLAY_NAMES[type] ?? type})`);
      }

      // Write-time constraints only a serving runtime can state
      // (channel-runtime.ts), after every edition-neutral rule so a
      // composed runtime never changes their order or copy.
      if (channelRuntime !== undefined && hasProviderRuntime(channel)) {
        await channelRuntime.enforceWriteConstraints(channel);
      }
    },
  };
}

/**
 * Context key for the agent ResolveChannelDefaults resolved from
 * spec.agent_ref, read by the create lane's authorization step.
 */
export const REFERENCED_AGENT_KEY = "channelReferencedAgent";

/** The deny copy of the agent's bar on a channel create. */
export const CHANNEL_AGENT_DENIED_MESSAGE =
  "You don't have permission to make a channel for this agent";

/** The deny copy of the organization's bar on a channel create. */
export const CHANNEL_ORGANIZATION_DENIED_MESSAGE =
  "You don't have permission to create channels in this organization";

/**
 * The create lane's authorization questions, for AuthorizeResolvedTarget
 * after ResolveChannelDefaults, agent first: can_manage_audience on the
 * referenced agent (a channel puts the agent in front of a wider audience,
 * so it decides who reaches the agent: the owner's act, never an editor's,
 * who may change the definition but not its audience), then
 * can_create_channel on the organization (a channel spends the
 * organization's provider keys on outside traffic, an admin-level act; a
 * member owns the agents they create, so ownership alone is not enough).
 * The RPC is is_skip_authorization because its target is that agent,
 * resolved from a slug, not a request field. The same-org invariant binds
 * the channel's organization to the agent's, so the two bars are one
 * organization's.
 */
export function resolveChannelCreateTargets(
  ctx: RequestContext<ChannelDesc>,
): ReadonlyArray<AuthorizationTarget> {
  const agent = ctx.get(REFERENCED_AGENT_KEY) as Agent | undefined;
  if (agent === undefined) {
    throw new Error("referenced agent not found in context");
  }
  return [
    {
      permission: IamPermission.can_manage_audience,
      resourceKind: ApiResourceKind.agent,
      resourceId: agent.metadata?.id ?? "",
      deniedMessage: CHANNEL_AGENT_DENIED_MESSAGE,
    },
    {
      permission: IamPermission.can_create_channel,
      resourceKind: ApiResourceKind.organization,
      resourceId: ctx.newState.metadata?.org ?? "",
      deniedMessage: CHANNEL_ORGANIZATION_DENIED_MESSAGE,
    },
  ];
}

/**
 * InitInstallState: a Slack or WhatsApp channel starts at
 * status.install_state = pending_install; it exists but serves no traffic
 * until the provider install completes, which in this edition never
 * happens (the install lane's refusal is the only install surface). A web
 * channel has nothing to install and keeps the unspecified state.
 *
 * Runs after BuildNewState, which clears client-provided status: the
 * install state is system-managed and must survive that wipe, exactly like
 * the audit fields.
 */
export function newInitInstallStateStep(): PipelineStep<ChannelDesc> {
  return {
    name: "InitInstallState",
    execute(ctx: RequestContext<ChannelDesc>): void {
      const channel = ctx.newState;
      if (!hasProviderRuntime(channel)) {
        return;
      }
      const status = channel.status ?? create(ChannelStatusSchema);
      status.installState = ChannelInstallState.pending_install;
      channel.status = status;
    },
  };
}

/**
 * ValidateChannelUpdate: spec.agent_ref must keep referencing the same
 * agent, compared by id (NormalizeReferences resolved the request's
 * reference); the type must not change (the link token, the install state,
 * credentials and delivery records are all type-shaped); the model pin is
 * re-validated; then a Slack or WhatsApp channel's app_ref rules
 * (validateAppRefUpdate) and a composed runtime's write constraints.
 * metadata.slug/org and status need no step: the generic BuildUpdateState
 * preserves them wholesale.
 */
export function newValidateChannelUpdateStep(
  store: Store,
  registry: ModelCatalogProvider,
  channelRuntime: ChannelRuntime | undefined,
): PipelineStep<ChannelDesc> {
  return {
    name: "ValidateChannelUpdate",
    async execute(ctx: RequestContext<ChannelDesc>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Channel | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing channel not found in context"),
          "existing channel not found in context",
        );
      }

      const inputRef = ctx.newState.spec?.agentRef;
      const existingRef = existing.spec?.agentRef;
      if (
        (inputRef?.id ?? "") !== (existingRef?.id ?? "") ||
        (inputRef?.org ?? "") !== (existingRef?.org ?? "")
      ) {
        throw failedPreconditionError(
          agentRefImmutableMessage(
            existingRef?.org ?? "",
            await referenceDisplayName(store, ApiResourceKind.agent, {
              org: existingRef?.org ?? "",
              id: existingRef?.id ?? "",
              slug: existingRef?.slug ?? "",
            }),
          ),
        );
      }

      const inputType = typeFieldName(ctx.newState.spec);
      const existingType = typeFieldName(existing.spec);
      if (inputType !== existingType) {
        throw failedPreconditionError(typeImmutableMessage(existingType));
      }

      validateChannelModelPin(registry, ctx.newState.spec);

      if (hasProviderRuntime(existing)) {
        validateAppRefUpdate(ctx, existing);
        if (channelRuntime !== undefined) {
          await channelRuntime.enforceWriteConstraints(ctx.newState);
        }
      }
    },
  };
}

/**
 * TeardownChannelRuntime: the serving runtime's delete-time cascade over a
 * Slack or WhatsApp channel's runtime state (channel-runtime.ts: sealed
 * channel credentials, pending deliveries). Spliced into the delete chain
 * only when a runtime is composed, after LoadExistingForDelete and before
 * DeleteResource: dependent runtime state dies before the row, and a thrown
 * teardown leaves the row for an idempotent retry. A web channel has no
 * runtime state and passes through.
 *
 * Generic over the chain desc: the delete chain is typed on the delete
 * input (ChannelId), and this step reads the loaded resource from
 * EXISTING_RESOURCE_KEY exactly as the controller's post-chain read does.
 */
export function newTeardownChannelRuntimeStep<Desc extends DescMessage>(
  channelRuntime: ChannelRuntime,
): PipelineStep<Desc> {
  return {
    name: "TeardownChannelRuntime",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Channel | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing channel not found in context"),
          "existing channel not found in context",
        );
      }
      if (hasProviderRuntime(existing)) {
        await channelRuntime.teardownOnDelete(existing, ctx.callerIdentity);
      }
    },
  };
}

/**
 * A Slack or WhatsApp channel's app_ref rules on update, byte-identical
 * with the cloud edition's:
 *   - required for WhatsApp (repeated here because update does not run the
 *     defaults step; type immutability guarantees the existing channel is
 *     also WhatsApp);
 *   - same-org always;
 *   - frozen while installed: pending and revoked channels rebind freely
 *     (in open source only the rebind-while-pending half is reachable:
 *     install_state never reaches `installed` here).
 */
function validateAppRefUpdate(
  ctx: RequestContext<ChannelDesc>,
  existing: Channel,
): void {
  const arm = typeFieldName(ctx.newState.spec);
  const inputAppRef = appRefOf(ctx.newState.spec);
  const existingAppRef = appRefOf(existing.spec);

  if (ctx.newState.spec?.type.case === "whatsapp" && !namesResource(inputAppRef)) {
    throw invalidArgumentError(APP_REF_REQUIRED_FOR_WHATSAPP_MESSAGE);
  }

  const inputAppOrg = namesResource(inputAppRef) ? inputAppRef!.org : "";
  if (inputAppOrg !== "" && inputAppOrg !== (existing.metadata?.org ?? "")) {
    throw failedPreconditionError(appRefSameOrgMessage(arm));
  }

  const installed =
    existing.status?.installState === ChannelInstallState.installed;
  const changed =
    heldTarget(inputAppRef) !== heldTarget(existingAppRef) ||
    (namesResource(inputAppRef) && inputAppOrg !== (existingAppRef?.org ?? ""));
  if (installed && changed) {
    throw failedPreconditionError(appRefFrozenWhileInstalledMessage(arm));
  }
}

/** Whether a reference names a resource at all, by id or by a slug nothing held. */
function namesResource(
  ref: { readonly id: string; readonly slug: string } | undefined,
): boolean {
  return ref !== undefined && (ref.id !== "" || ref.slug !== "");
}

/** What a reference holds, for comparing two of them: its id, else the slug it was written with. */
function heldTarget(
  ref: { readonly id: string; readonly slug: string } | undefined,
): string {
  return ref === undefined ? "" : ref.id !== "" ? `#${ref.id}` : ref.slug;
}

// ---------------------------------------------------------------------------
// The web channel's link: the profile reads and the link token.
// ---------------------------------------------------------------------------

/**
 * Context key for the channel both profile lanes resolved from the link's
 * channel id: the loaders write it, AuthorizeMemberAudience and the
 * projections read it.
 */
export const RESOLVED_CHANNEL_KEY = "resolvedChannel";

/**
 * The single refusal for every anonymous or member resolution miss:
 * channel missing, not a web channel, disabled, its organization gone,
 * dangling agent_ref, wrong or absent link token. It echoes the channel id
 * the caller sent, which the caller already holds. The message
 * deliberately says "Agent": the visitor asked for an agent's chat page,
 * and the channel resource is a modeling detail a public error must not
 * teach. One constructor guarantees the byte-identical-errors contract by
 * construction.
 */
export function linkNotFound(channelId: string): ConnectError {
  return notFoundError("Agent", channelId);
}

/**
 * Loads the web channel a hosted chat link names, for both profile lanes.
 * A link carries only the channel's id, which never changes and is never
 * reused, so no rename of the channel's organization breaks it and no
 * later holder of that organization's name can capture it. A missing row
 * (an unknown id, or another kind's id), a channel of another type, and a
 * channel whose organization no longer exists, or is being deleted, answer
 * the uniform refusal: a deleted organization's row stays until its purge
 * has removed what it owned (domain/organization/lifecycle.ts), and a link
 * must stop working the moment its organization is deleted. The link names
 * no organization, so neither the deleting rule's interceptor nor the
 * anonymous lane's Authorizer reaches it; this loader is its seat for both
 * profile lanes. Each read is by primary key; any other store failure is
 * Internal.
 */
export async function loadLinkedChannel(
  store: Store,
  channelId: string,
): Promise<Channel> {
  let channel: Channel;
  try {
    channel = await store.getResource(ApiResourceKind.channel, channelId, ChannelSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw linkNotFound(channelId);
    }
    throw internalError(error, "failed to load channel");
  }
  if (channel.spec?.type.case !== "web") {
    throw linkNotFound(channelId);
  }
  try {
    await store.getResource(
      ApiResourceKind.organization,
      channel.metadata?.org ?? "",
      OrganizationSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw linkNotFound(channelId);
    }
    throw internalError(error, "failed to load organization");
  }
  let deleting: boolean;
  try {
    deleting = await store.organizationDeletions.isDeleting(
      channel.metadata?.org ?? "",
    );
  } catch (error) {
    throw internalError(error, "failed to load organization");
  }
  if (deleting) {
    throw linkNotFound(channelId);
  }
  return channel;
}

/** A web channel's live link token; empty when the link is plain or the channel is another type. */
export function linkTokenOf(channel: Channel): string {
  const status = channel.status?.typeStatus;
  return status?.case === "web" ? status.value.linkToken : "";
}

/**
 * AuthorizeMemberAudience: the member-profile lane's gate, after the
 * channel loads. getAgentProfileForMember is the signed-in resolution path
 * for a chat link, and the proto pins its contract: a channel that does
 * not exist, is disabled, or is asked for by someone who is not a member
 * of its organization all answer the SAME NOT_FOUND, so a chat link
 * teaches a non-member nothing. A non-member resolving a public link uses
 * the anonymous lane instead.
 *
 * The link names only the channel, so the organization to ask about is the
 * loaded channel's own: the step runs after LoadChannelForMemberProfile.
 * Its refusal is byte-identical to the loader's for a missing channel, so
 * the order changes no answer; only its timing differs, and only for a
 * caller who already holds the channel's id.
 *
 * The question is can_view on that organization (the viewer set: members
 * and above), asked live on every call so a revoked member loses access at
 * once; the RPC is is_skip_authorization because the target is the
 * channel's organization, not a request field the annotation can key on.
 * This is deliberately NOT the shared AuthorizeResolvedTarget step: that
 * step answers deny with PERMISSION_DENIED, and this lane's wire contract
 * is the indistinguishable NOT_FOUND above, so the lane keeps its own
 * mapping over the same evaluation (the decision form checkMyPermission
 * uses). An unavailable authorizer is INTERNAL, never softened into a
 * refusal; the `internal` class is exempt as everywhere.
 */
export function newAuthorizeMemberAudienceStep(
  authorizer: Authorizer,
): PipelineStep<typeof ChannelIdSchema> {
  return {
    name: "AuthorizeMemberAudience",
    async execute(ctx: RequestContext<typeof ChannelIdSchema>): Promise<void> {
      if (ctx.callerIdentity.callerClass === "internal") {
        return;
      }
      const channel = ctx.get(RESOLVED_CHANNEL_KEY) as Channel;
      const decision = await evaluateAuthorizer(authorizer, ctx.callerIdentity, {
        permission: IamPermission.can_view,
        resourceKind: ApiResourceKind.organization,
        resourceId: channel.metadata?.org ?? "",
      });
      switch (decision.kind) {
        case "allow":
          return;
        case "deny":
        case "not-found":
          throw linkNotFound(ctx.input.value);
        case "unavailable":
          throw internalError(decision.cause, AUTHORIZATION_UNAVAILABLE_MESSAGE);
        /* v8 ignore start -- @preserve: the never arm; the compiler proves no decision reaches it */
        default: {
          const exhaustive: never = decision;
          throw internalError(
            new Error(`unknown decision ${JSON.stringify(exhaustive)}`),
            AUTHORIZATION_UNAVAILABLE_MESSAGE,
          );
        }
        /* v8 ignore stop */
      }
    },
  };
}

/**
 * The link-token predicate, the mirror of the cloud edition's:
 *   - No live token: allowed (a stale ?k= on an unlocked link is harmless).
 *   - Live token set: the presented token must match exactly; a missing or
 *     rotated-away token refuses (surfacing as the uniform NotFound).
 *
 * Comparison is constant-time. Node's timingSafeEqual throws on unequal
 * lengths, so the length guard answers false first; the length of a token
 * is not secret (every server-minted token is 27 characters).
 */
export function linkTokenAllowed(presented: string, live: string): boolean {
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
 * Fresh server-side entropy for a web channel's link token: 20
 * crypto-random bytes, unpadded url-safe base64, 27 characters.
 */
export function generateLinkToken(): string {
  return randomBytes(LINK_TOKEN_BYTES).toString("base64url");
}

/**
 * Projects a web channel and its referenced agent to the trimmed public
 * profile, the single projection the anonymous and member paths share. The
 * channel's org, slug and agent reference come from the channel (the
 * hosted page starts its sessions on exactly that reference, version
 * included); display fields from the agent. Two misses fail closed with
 * the uniform refusal, naming the channel's id as every other miss does,
 * indistinguishable from absence: a dangling agent_ref, and an agent in
 * another organization (the same-organization invariant, held here too).
 * The stored reference holds the agent's id, so it never names a later
 * agent of the same name.
 */
export async function buildChannelAgentProfile(
  store: Store,
  channel: Channel,
): Promise<ChannelAgentProfile> {
  const ref = channel.spec?.agentRef;
  let agent: Agent | undefined;
  try {
    agent = await loadReferenced(store, ApiResourceKind.agent, AgentSchema, {
      org: ref?.org ?? "",
      id: ref?.id ?? "",
    });
  } catch (error) {
    throw internalError(error, "failed to read the agent");
  }
  if (agent === undefined) {
    throw linkNotFound(channel.metadata?.id ?? "");
  }
  if ((channel.metadata?.org ?? "") !== (agent.metadata?.org ?? "")) {
    throw linkNotFound(channel.metadata?.id ?? "");
  }
  return create(ChannelAgentProfileSchema, {
    org: channel.metadata?.org ?? "",
    slug: channel.metadata?.slug ?? "",
    name: agent.metadata?.name ?? "",
    description: agent.spec?.description ?? "",
    iconUrl: agent.spec?.iconUrl ?? "",
    agentRef: ref,
  });
}
