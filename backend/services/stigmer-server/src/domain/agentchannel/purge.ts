/**
 * The agent channel's purge (domain/organization/purge/kind-purge.ts):
 * every channel of an organization being deleted, removed with its delete
 * chain's cleanup (controller.ts `deleteChannel`): the composed channel
 * runtime's teardown when one is composed (an edition's install and its
 * stored delivery state), the row, its access.
 */
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import type { ChannelRuntime } from "./channel-runtime.js";
import { newTeardownChannelRuntimeStep } from "./steps.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";

type DeleteInput = typeof AgentChannelCommandController.method.delete.input;

export interface AgentChannelPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composed channel runtime; undefined when no unit composes one. */
  readonly channelRuntime: ChannelRuntime | undefined;
}

export function newAgentChannelPurge(deps: AgentChannelPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.agent_channel,
    schema: AgentChannelSchema,
    input: AgentChannelCommandController.method.delete.input,
    steps: [
      ...(deps.channelRuntime === undefined
        ? []
        : [newTeardownChannelRuntimeStep<DeleteInput>(deps.channelRuntime)]),
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    ],
  });
}
