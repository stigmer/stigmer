/**
 * AgentChannel controller — ports pkg/domain/agentchannel/controller
 * (AgentChannelCommandController + AgentChannelQueryController): the
 * connection binding an agent to an external messaging-platform workspace
 * (Slack/WhatsApp). Workspace identity and credentials are produced by
 * the provider install flow and live in STATUS — a declarative apply can
 * never clobber them. Unlike shares (decision 013), channels have NO
 * cross-org arm: the channel's org is the billing org and the credentials
 * org, and both must be the referenced agent's (decision 004).
 *
 * Install posture (OSS, T02 §0-b — a deliberate, developer-approved
 * divergence): initiateInstall and completeInstall validate, LOAD the
 * channel (byte-identical NOT_FOUND with cloud's LoadChannel step), then
 * refuse FailedPrecondition — this edition has no webhook receiver and no
 * delivery runtime, so an installed channel could never serve traffic.
 * Nothing is persisted on that path. The messaging/conversation runtime
 * surfaces live in message.ts / conversation.ts (Go's file seams).
 *
 * NOT search-indexed by design; channels are NOT swept on agent delete
 * (only same-org shares are) — a dangling channel is tolerated because
 * OSS has no serving runtime and cloud fails closed elsewhere.
 *
 * Proven by agentchannel.conformance.test.ts (CONFORMANCE_TARGET=local)
 * and __tests__/agentchannel.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create, fromBinary } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/command_pb";
import { AgentChannelQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/query_pb";
import { AgentChannelListSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/io_pb";
import type {
  AgentChannelId,
  AgentChannelList,
  CompleteChannelInstallInput,
  GetAgentChannelsByAgentRequest,
  InitiateChannelInstallInput,
  InitiateChannelInstallOutput,
  ListAgentChannelsRequest,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/io_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import {
  failedPreconditionError,
  internalError,
  notFoundError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import {
  compareCreatedAtDesc,
  matchesAllLabels,
} from "../../pipeline/steps/helpers.js";
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import {
  SHOULD_CREATE_KEY,
  newLoadForApplyStep,
} from "../../pipeline/steps/load-for-apply.js";
import { newLoadByReferenceStep } from "../../pipeline/steps/load-by-reference.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import { newNormalizeReferencesStep } from "../../pipeline/steps/references.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import type { Store } from "../../store/interface.js";
import type { ModelCatalogProvider } from "../workflow/registry/model-catalog-provider.js";
import { INSTALL_UNAVAILABLE_MESSAGE } from "./constants.js";
import {
  newInitInstallStateStep,
  newResolveChannelDefaultsStep,
  newValidateChannelUpdateStep,
} from "./steps.js";

export interface AgentChannelControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  readonly modelRegistry: ModelCatalogProvider;
}

/** Registers both agentchannel resource services on the router. */
export function registerAgentChannelServices(
  router: ConnectRouter,
  deps: AgentChannelControllerDeps,
): void {
  router.service(AgentChannelCommandController, {
    apply: (channel, ctx) => apply(deps, channel, ctx),
    create: (channel, ctx) => createChannel(deps, channel, ctx),
    update: (channel, ctx) => update(deps, channel, ctx),
    initiateInstall: (input, ctx) => initiateInstall(deps, input, ctx),
    completeInstall: (input, ctx) => completeInstall(deps, input, ctx),
    delete: (channelId, ctx) => deleteChannel(deps, channelId, ctx),
  });
  router.service(AgentChannelQueryController, {
    get: (channelId, ctx) => get(deps, channelId, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    getByAgent: (req, ctx) => getByAgent(deps, req, ctx),
    list: (req, ctx) => list(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — chain per Go buildCreatePipeline. InitInstallState runs AFTER
 * BuildNewState so the status wipe cannot erase pending_install; no
 * agent-slug default (channels are N-per-agent — see ResolveChannelDefaults).
 */
async function createChannel(
  deps: AgentChannelControllerDeps,
  channel: AgentChannel,
  ctx: HandlerContext,
): Promise<AgentChannel> {
  const reqCtx = new RequestContext(
    AgentChannelSchema,
    channel,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentChannelSchema>(
    "agent-channel-create",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentChannelCommandController.method.create,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newResolveChannelDefaultsStep(deps.store, deps.modelRegistry))
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newInitInstallStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newPersistStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Update — chain per Go buildUpdatePipeline. The spec is replaced
 * wholesale; status is preserved verbatim, which keeps the install facts
 * and credentials reference immune to declarative clobber (the install
 * flow is their sole writer — decision 004).
 */
async function update(
  deps: AgentChannelControllerDeps,
  channel: AgentChannel,
  ctx: HandlerContext,
): Promise<AgentChannel> {
  const reqCtx = new RequestContext(
    AgentChannelSchema,
    channel,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentChannelSchema>(
    "agent-channel-update",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentChannelCommandController.method.update,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newValidateChannelUpdateStep(deps.modelRegistry))
    .addStep(newBuildUpdateStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newPersistStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Apply — kubectl-style create-or-update. Delegates with the pipeline's
 * CLONED state (Go delegates reqCtx.NewState(), like agentshare and
 * unlike channelapp): the normalized agent_ref (from
 * ResolveChannelDefaults) and the populated id (from LoadForApply) live
 * only on the clone. Defaults resolution runs BEFORE routing so the
 * existence check sees the normalized ref and the same-org invariant
 * fails loudly first (matching the cloud edition's resolver-before-
 * routing order); the create pipeline re-running it is harmless
 * (resolution is idempotent).
 */
async function apply(
  deps: AgentChannelControllerDeps,
  channel: AgentChannel,
  ctx: HandlerContext,
): Promise<AgentChannel> {
  const reqCtx = new RequestContext(
    AgentChannelSchema,
    channel,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentChannelSchema>(
    "agent-channel-apply",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentChannelCommandController.method.apply,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveChannelDefaultsStep(deps.store, deps.modelRegistry))
    .addStep(newResolveSlugStep())
    .addStep(newLoadForApplyStep(deps.store))
    .build()
    .execute(reqCtx);

  const shouldCreate = reqCtx.get(SHOULD_CREATE_KEY);
  if (typeof shouldCreate !== "boolean") {
    throw internalError(
      new Error("apply pipeline did not set shouldCreate flag"),
      "apply operation failed to determine create vs update",
    );
  }
  const resolved = reqCtx.newState;
  return shouldCreate
    ? createChannel(deps, resolved, ctx)
    : update(deps, resolved, ctx);
}

// ---------------------------------------------------------------------------
// Install lane — Go install.go. Input validation is Layer-1 (the transport
// interceptor chain validates every request, matching Go's explicit
// SharedValidator call); the channel is loaded FIRST so the NOT_FOUND
// contract is identical to cloud's LoadChannel step, and only the final
// step diverges — the documented one. Nothing is persisted.
// ---------------------------------------------------------------------------

async function initiateInstall(
  deps: AgentChannelControllerDeps,
  input: InitiateChannelInstallInput,
  ctx: HandlerContext,
): Promise<InitiateChannelInstallOutput> {
  await loadChannelForInstall(deps, ctx, input.resourceId);
  throw failedPreconditionError(INSTALL_UNAVAILABLE_MESSAGE);
}

/**
 * CompleteInstall — same load-then-refuse contract; a completion can only
 * be reached with a state token from a successful initiate, which this
 * edition never issues.
 */
async function completeInstall(
  deps: AgentChannelControllerDeps,
  input: CompleteChannelInstallInput,
  ctx: HandlerContext,
): Promise<AgentChannel> {
  await loadChannelForInstall(deps, ctx, input.resourceId);
  throw failedPreconditionError(INSTALL_UNAVAILABLE_MESSAGE);
}

/** Verifies the target exists — cloud's LoadChannel NOT_FOUND, verbatim. */
async function loadChannelForInstall(
  deps: AgentChannelControllerDeps,
  ctx: HandlerContext,
  resourceId: string,
): Promise<void> {
  try {
    await deps.store.getResource(kindOf(ctx), resourceId, AgentChannelSchema);
  } catch {
    throw notFoundError("AgentChannel", resourceId);
  }
}

/**
 * Delete — the connection's full teardown; disabling (update with
 * enabled=false) is the config-preserving pause. Versus cloud, OSS
 * excludes the teardown cascade (managed credentials environment, OAuth
 * grant, pending-delivery abandonment) — none of that state can exist
 * here because the install flow never runs (§0-b).
 */
async function deleteChannel(
  deps: AgentChannelControllerDeps,
  channelId: AgentChannelId,
  ctx: HandlerContext,
): Promise<AgentChannel> {
  const reqCtx = new RequestContext(
    AgentChannelCommandController.method.delete.input,
    channelId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentChannelCommandController.method.delete.input>(
    "agent-channel-delete",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentChannelCommandController.method.delete,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, AgentChannelSchema))
    .addStep(newDeleteResourceStep(deps.store))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted agent channel not found in context"),
      "deleted agent channel not found in context",
    );
  }
  return deleted as AgentChannel;
}

/** Get — LoadTarget by id-wrapper input (AgentChannelId). */
async function get(
  deps: AgentChannelControllerDeps,
  channelId: AgentChannelId,
  ctx: HandlerContext,
): Promise<AgentChannel> {
  const reqCtx = new RequestContext(
    AgentChannelQueryController.method.get.input,
    channelId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentChannelQueryController.method.get.input>(
    "agent-channel-get",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(AgentChannelQueryController.method.get, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, AgentChannelSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as AgentChannel;
}

/** GetByReference — org/slug lookup. */
async function getByReference(
  deps: AgentChannelControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<AgentChannel> {
  const reqCtx = new RequestContext(
    AgentChannelQueryController.method.getByReference.input,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<
    typeof AgentChannelQueryController.method.getByReference.input
  >("agent-channel-get-by-reference", deps.logger)
    .addStep(
      newAuthorizeStep(
        AgentChannelQueryController.method.getByReference,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceStep(deps.store, AgentChannelSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as AgentChannel;
}

const CHANNEL_LIST_KEY = "agentChannelList";

/**
 * GetByAgent — all channels of one agent, optionally org-scoped. This is
 * how the agent's integrations surface and CLI resolve an agent's
 * channels regardless of slug (channels are N-per-agent across
 * providers). A nonexistent agent yields an EMPTY list, not an error.
 * The org filter is contract parity, not authorization (channels are
 * same-org by invariant, so it only excludes rows when the requested org
 * differs from the agent's — kept for parity with the sibling RPCs).
 */
async function getByAgent(
  deps: AgentChannelControllerDeps,
  req: GetAgentChannelsByAgentRequest,
  ctx: HandlerContext,
): Promise<AgentChannelList> {
  const reqCtx = new RequestContext(
    AgentChannelQueryController.method.getByAgent.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentChannelQueryController.method.getByAgent.input>(
    "agent-channel-get-by-agent",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentChannelQueryController.method.getByAgent,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadChannelsByAgentStep(deps.store))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(CHANNEL_LIST_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("agent channel list not found in context"),
      "agent channel list not found in context",
    );
  }
  return result as AgentChannelList;
}

/** LoadChannelsByAgent — Go loadChannelsByAgentStep. */
function newLoadChannelsByAgentStep(
  store: Store,
): PipelineStep<typeof AgentChannelQueryController.method.getByAgent.input> {
  return {
    name: "LoadChannelsByAgent",
    async execute(
      ctx: RequestContext<
        typeof AgentChannelQueryController.method.getByAgent.input
      >,
    ): Promise<void> {
      const req = ctx.input;
      const emptyList = create(AgentChannelListSchema, {
        totalCount: 0,
        items: [],
      });

      let agentOrg: string;
      let agentSlug: string;
      try {
        const agent = await store.getResource(
          ApiResourceKind.agent,
          req.agentId,
          AgentSchema,
        );
        agentOrg = agent.metadata?.org ?? "";
        agentSlug = agent.metadata?.slug ?? "";
      } catch {
        ctx.set(CHANNEL_LIST_KEY, emptyList);
        return;
      }

      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ApiResourceKind.agent_channel);
      } catch (error) {
        throw internalError(error, "failed to list agent channels");
      }

      const channels: AgentChannel[] = [];
      for (const bytes of rows) {
        let channel: AgentChannel;
        try {
          channel = fromBinary(AgentChannelSchema, bytes);
        } catch {
          continue;
        }
        const ref = channel.spec?.agentRef;
        if ((ref?.org ?? "") !== agentOrg || (ref?.slug ?? "") !== agentSlug) {
          continue;
        }
        if (req.org !== "" && (channel.metadata?.org ?? "") !== req.org) {
          continue;
        }
        channels.push(channel);
      }

      ctx.set(
        CHANNEL_LIST_KEY,
        create(AgentChannelListSchema, {
          totalCount: channels.length,
          items: channels,
        }),
      );
    },
  };
}

const LIST_RESULT_KEY = "listResult";

/** List — org + labels filter (AND semantics), newest first (Go list.go). */
async function list(
  deps: AgentChannelControllerDeps,
  req: ListAgentChannelsRequest,
  ctx: HandlerContext,
): Promise<AgentChannelList> {
  const reqCtx = new RequestContext(
    AgentChannelQueryController.method.list.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentChannelQueryController.method.list.input>(
    "agent-channel-list",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentChannelQueryController.method.list,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newListByOrgAndLabelsStep(deps.store))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(LIST_RESULT_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("agent channel list not found in context"),
      "agent channel list not found in context",
    );
  }
  return result as AgentChannelList;
}

/**
 * ListByOrgAndLabels — Go listByOrgAndLabelsStep. Malformed rows are
 * skipped SILENTLY (Go's list routes through unmarshalChannel, which does
 * not log — unlike agentshare's list, which warns; the asymmetry is Go's).
 */
function newListByOrgAndLabelsStep(
  store: Store,
): PipelineStep<typeof AgentChannelQueryController.method.list.input> {
  return {
    name: "ListByOrgAndLabels",
    async execute(
      ctx: RequestContext<typeof AgentChannelQueryController.method.list.input>,
    ): Promise<void> {
      const { org, labels: filterLabels } = ctx.input;

      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ctx.apiResourceKind);
      } catch (error) {
        throw internalError(error, "failed to list agent channels");
      }

      const channels: AgentChannel[] = [];
      for (const bytes of rows) {
        let channel: AgentChannel;
        try {
          channel = fromBinary(AgentChannelSchema, bytes);
        } catch {
          continue;
        }
        if ((channel.metadata?.org ?? "") !== org) {
          continue;
        }
        if (!matchesAllLabels(channel.metadata?.labels ?? {}, filterLabels)) {
          continue;
        }
        channels.push(channel);
      }

      channels.sort((a, b) =>
        compareCreatedAtDesc(
          a.status?.audit?.specAudit?.createdAt,
          b.status?.audit?.specAudit?.createdAt,
        ),
      );

      ctx.set(
        LIST_RESULT_KEY,
        create(AgentChannelListSchema, {
          totalCount: channels.length,
          items: channels,
        }),
      );
    },
  };
}
