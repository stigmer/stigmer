/**
 * An agent's channels go with the agent. CascadeDeleteChannels runs in the
 * agent's delete chain and its kind purge: every channel in the agent's own
 * organization whose spec.agent_ref holds the agent's id, read through the
 * channel list index (queries.ts), is removed before the agent's row. A
 * Slack or WhatsApp channel's runtime state goes first through the composed
 * channel runtime's teardown, as the channel's own delete does; a teardown
 * that throws fails the agent's delete and keeps the agent and that
 * channel, for the idempotent retry the channel's delete promises. Then the
 * row, its names and its access go, while the agent still links it to its
 * organization.
 *
 * A channel in another organization (a chat link written before sharing
 * across organizations was retired) is that organization's resource:
 * deleting it here would make an agent's delete a cross-principal
 * destructive act, so it is left to fail closed through its dangling
 * reference.
 *
 * A channel created while its agent is being deleted removes itself when
 * its re-read after the write finds the agent gone
 * (EnsureChannelAgentStillExists). The re-read narrows the race, it does
 * not close it: a create that persists after this cascade has listed and
 * re-reads before the agent's row is deleted finds the agent and outlives
 * it, holding a dangling reference that fails closed.
 *
 * Proven by domain/agent/__tests__/agent.test.ts (the agent's delete) and
 * __tests__/cascade.test.ts (a create whose re-read finds the agent gone).
 */
import type { DescMessage } from "@bufbuild/protobuf";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Channel } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import type { ChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { internalError, notFoundError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { cleanUpDeletedResource } from "../../pipeline/steps/authorization-tuples.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { releaseNamesOfDeleted } from "../../pipeline/steps/names.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { ChannelRuntime } from "./channel-runtime.js";
import { listChannelsOfAgent } from "./queries.js";
import { hasProviderRuntime } from "./steps.js";

export interface ChannelCascadeDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composed channel runtime; undefined when no unit composes one. */
  readonly channelRuntime: ChannelRuntime | undefined;
}

export function newCascadeDeleteChannelsStep<Desc extends DescMessage>(
  deps: ChannelCascadeDeps,
): PipelineStep<Desc> {
  return {
    name: "CascadeDeleteChannels",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const agent = ctx.get(EXISTING_RESOURCE_KEY) as Agent | undefined;
      if (agent === undefined) {
        throw internalError(
          new Error("agent not found in context (LoadExistingForDelete must run first)"),
          "agent not found in context (LoadExistingForDelete must run first)",
        );
      }
      const agentId = agent.metadata?.id ?? "";
      const agentOrg = agent.metadata?.org ?? "";
      if (agentId === "") {
        return;
      }
      let channels: Channel[];
      try {
        channels = await listChannelsOfAgent(deps.store, deps.logger, agentId);
      } catch (error) {
        throw internalError(error, "failed to list the agent's channels for cascade delete");
      }
      let deleted = 0;
      for (const channel of channels) {
        if ((channel.metadata?.org ?? "") !== agentOrg) {
          continue;
        }
        await deleteChannelOfAgent(deps, channel, ctx.callerIdentity);
        deleted++;
      }
      if (deleted > 0) {
        deps.logger.info("Cascade-deleted channels of agent", {
          count: deleted,
          agent: `${agentOrg}/${agent.metadata?.slug ?? ""}`,
        });
      }
    },
  };
}

/** One channel of a deleted agent: its runtime state, its row, its names, then its access. */
async function deleteChannelOfAgent(
  deps: ChannelCascadeDeps,
  channel: Channel,
  caller: CallerIdentity,
): Promise<void> {
  const channelId = channel.metadata?.id ?? "";
  const org = channel.metadata?.org ?? "";
  if (deps.channelRuntime !== undefined && hasProviderRuntime(channel)) {
    await deps.channelRuntime.teardownOnDelete(channel, caller);
  }
  try {
    await deps.store.deleteResource(ApiResourceKind.channel, channelId);
  } catch (error) {
    if (!(error instanceof ResourceNotFoundError)) {
      throw internalError(error, `failed to cascade-delete channel ${channelId}`);
    }
  }
  await releaseNamesOfDeleted(deps.store, deps.logger, ApiResourceKind.channel, org, channelId);
  await cleanUpDeletedResource(deps.authorizationLifecycle, deps.logger, {
    kind: ApiResourceKind.channel,
    resourceId: channelId,
    orgId: org,
    caller,
  });
}

/**
 * EnsureChannelAgentStillExists: after the channel and its access are
 * written, its agent is read again. An agent deleted meanwhile (its delete
 * listed its channels before this one was stored) takes the channel with
 * it: the row, its names and its access are removed here and the create
 * answers NOT_FOUND for the agent, as a create naming a missing agent
 * does. A new channel has no runtime state yet (a Slack or WhatsApp
 * channel is pending its install), so nothing else needs tearing down.
 */
export function newEnsureChannelAgentStillExistsStep(
  deps: Omit<ChannelCascadeDeps, "channelRuntime">,
): PipelineStep<typeof ChannelSchema> {
  return {
    name: "EnsureChannelAgentStillExists",
    async execute(ctx: RequestContext<typeof ChannelSchema>): Promise<void> {
      const agentId = ctx.newState.spec?.agentRef?.id ?? "";
      try {
        await deps.store.getResource(ApiResourceKind.agent, agentId, AgentSchema);
        return;
      } catch (error) {
        if (!(error instanceof ResourceNotFoundError)) {
          throw internalError(error, "failed to read the channel's agent again");
        }
      }
      const channelId = ctx.newState.metadata?.id ?? "";
      deps.logger.warn("a channel's agent was deleted while it was created; removing the channel", {
        channelId,
        agentId,
      });
      await deleteChannelOfAgent({ ...deps, channelRuntime: undefined }, ctx.newState, ctx.callerIdentity);
      // NormalizeReferences made the reference an id before the write, so
      // the refusal names the agent by it.
      throw notFoundError("Agent", agentId);
    },
  };
}
