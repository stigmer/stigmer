/**
 * CascadeDeleteAgentEvals: an agent's delete removes its evals before the
 * agent row goes, each with its tries' conversations, read through the
 * eval list index; each eval's access goes with its row while the agent
 * still links it to its organization, as the agent's evaluator cascade
 * does (domain/evaluator/cascade.ts). An eval still pending or running
 * refuses the delete, naming cancel: its tries may hold an active run,
 * which a conversation's delete refuses. Runs before the agent's other
 * cascades, so a refusal removes nothing. An eval created during its
 * agent's delete meets an agent already gone at its own re-read and
 * removes itself (steps.ts EnsureEvaluatedAgentStillExists). A
 * composition that serves no evals passes no deps, and the step does
 * nothing.
 *
 * Proven by __tests__/agent-eval.test.ts (the agent's delete).
 */
import type { DescMessage } from "@bufbuild/protobuf";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { failedPreconditionError, internalError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { cleanUpDeletedResource } from "../../pipeline/steps/authorization-tuples.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import { isActivePluginEval } from "../plugin-eval/steps.js";
import { deletePluginEvalTries } from "../plugin-eval/tries.js";
import type { TrySessionDeleter } from "../plugin-eval/tries.js";
import { agentEvalActiveOnAgentDeleteMessage } from "./constants.js";
import { listAgentEvals } from "./queries.js";

export interface AgentEvalCascadeDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** Resolved at call time: the in-process clients are wired after the routes. */
  readonly sessions: () => TrySessionDeleter;
}

export function newCascadeDeleteAgentEvalsStep<Desc extends DescMessage>(
  deps: AgentEvalCascadeDeps | undefined,
): PipelineStep<Desc> {
  return {
    name: "CascadeDeleteAgentEvals",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (deps === undefined) {
        return;
      }
      const agent = ctx.get(EXISTING_RESOURCE_KEY) as Agent | undefined;
      if (agent === undefined) {
        throw internalError(
          new Error("agent not found in context (LoadExistingForDelete must run first)"),
          "agent not found in context (LoadExistingForDelete must run first)",
        );
      }
      const agentId = agent.metadata?.id ?? "";
      let evals: AgentEval[];
      try {
        evals = await listAgentEvals(deps.store, deps.logger, agentId);
      } catch (error) {
        throw internalError(error, "failed to list the agent's evals for cascade delete");
      }
      const active = evals.find(isActivePluginEval);
      if (active !== undefined) {
        throw failedPreconditionError(agentEvalActiveOnAgentDeleteMessage(active.metadata?.id ?? ""));
      }
      for (const agentEval of evals) {
        const evalId = agentEval.metadata?.id ?? "";
        await deletePluginEvalTries(deps.store, deps.sessions(), deps.logger, evalId);
        try {
          await deps.store.deleteResource(ApiResourceKind.agent_eval, evalId);
        } catch (error) {
          throw internalError(error, `failed to cascade-delete agent eval ${evalId} of agent ${agentId}`);
        }
        await cleanUpDeletedResource(deps.authorizationLifecycle, deps.logger, {
          kind: ApiResourceKind.agent_eval,
          resourceId: evalId,
          orgId: agentEval.metadata?.org ?? "",
          caller: ctx.callerIdentity,
        });
      }
    },
  };
}
