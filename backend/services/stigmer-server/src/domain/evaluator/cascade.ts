/**
 * CascadeDeleteEvaluators: an agent's delete removes its evaluator before
 * the agent row goes, read through the evaluator list index. Each
 * evaluator's access goes with its row while the agent still links it to
 * its organization (the agent's other cascades do the same,
 * domain/agent/steps.ts). An evaluator of a deleted agent would grade
 * nothing, since nothing can run the agent, but would keep its settings
 * and spend visible to nobody.
 *
 * Proven by __tests__/evaluator.test.ts and the conformance cascade arm.
 */
import type { DescMessage } from "@bufbuild/protobuf";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Evaluator } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { internalError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { cleanUpDeletedResource } from "../../pipeline/steps/authorization-tuples.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { listAgentEvaluators } from "./queries.js";

export function newCascadeDeleteEvaluatorsStep<Desc extends DescMessage>(
  store: Store,
  lifecycle: ResourceAuthorizationLifecycle | undefined,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "CascadeDeleteEvaluators",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const agent = ctx.get(EXISTING_RESOURCE_KEY) as Agent | undefined;
      if (agent === undefined) {
        throw internalError(
          new Error(
            "agent not found in context (LoadExistingForDelete must run first)",
          ),
          "agent not found in context (LoadExistingForDelete must run first)",
        );
      }
      const agentId = agent.metadata?.id ?? "";
      let evaluators: Evaluator[];
      try {
        evaluators = await listAgentEvaluators(store, logger, agentId);
      } catch (error) {
        throw internalError(
          error,
          "failed to list the agent's evaluator for cascade delete",
        );
      }
      for (const evaluator of evaluators) {
        const evaluatorId = evaluator.metadata?.id ?? "";
        try {
          await store.deleteResource(ApiResourceKind.evaluator, evaluatorId);
        } catch (error) {
          if (!(error instanceof ResourceNotFoundError)) {
            throw internalError(
              error,
              `failed to cascade-delete evaluator ${evaluatorId} of agent ${agentId}`,
            );
          }
        }
        await cleanUpDeletedResource(lifecycle, logger, {
          kind: ApiResourceKind.evaluator,
          resourceId: evaluatorId,
          orgId: evaluator.metadata?.org ?? "",
          caller: ctx.callerIdentity,
        });
      }
    },
  };
}
