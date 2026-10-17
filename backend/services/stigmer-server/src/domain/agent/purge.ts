/**
 * The agent's purge (domain/organization/purge/kind-purge.ts): every agent
 * of an organization being deleted, removed with its delete chain's
 * cleanup (controller.ts `deleteAgent`) and without its refusal of a
 * plugin-managed agent: the plugin goes too.
 *
 * The chain's steps after its load, in its order: the agent's channels and
 * routines, its version archives, the row, its access, its search entry.
 */
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupGrantsStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newReleaseNamesStep } from "../../pipeline/steps/names.js";
import { newDeleteSearchIndexStep } from "../../pipeline/steps/index-search.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import { newCascadeDeleteChannelsStep } from "../channel/cascade.js";
import type { ChannelRuntime } from "../channel/channel-runtime.js";
import type { ClockProvider } from "../routine/clock.js";
import { newCascadeDeleteRoutinesStep } from "../routine/cascade.js";
import { newDeleteAgentVersionsStep } from "./versions.js";

export interface AgentPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composed channel runtime; undefined when no unit composes one. */
  readonly channelRuntime: ChannelRuntime | undefined;
  /** The routine clock the routines' artifacts are torn down through. */
  readonly routineClock: ClockProvider;
}

export function newAgentPurge(deps: AgentPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.agent,
    schema: AgentSchema,
    input: AgentCommandController.method.delete.input,
    steps: [
      newCascadeDeleteChannelsStep({
        store: deps.store,
        logger: deps.logger,
        authorizationLifecycle: deps.authorizationLifecycle,
        channelRuntime: deps.channelRuntime,
      }),
      newCascadeDeleteRoutinesStep({
        store: deps.store,
        logger: deps.logger,
        authorizationLifecycle: deps.authorizationLifecycle,
        clock: deps.routineClock,
      }),
      newDeleteAgentVersionsStep(deps.store, deps.logger),
      newDeleteResourceStep(deps.store),
      newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.agent),
      newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger),
      newDeleteSearchIndexStep(deps.store, deps.logger),
    ],
  });
}
