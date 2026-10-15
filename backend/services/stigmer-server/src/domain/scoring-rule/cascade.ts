/**
 * CascadeDeleteScoringRules: an agent's delete removes its scoring rule before
 * the agent row goes, read through the scoring rule list index. Each
 * scoring rule's access goes with its row while the agent still links it to
 * its organization (the agent's other cascades do the same,
 * domain/agent/steps.ts). A scoring rule of a deleted agent would grade
 * nothing, since nothing can run the agent, but would keep its settings
 * and spend visible to nobody.
 *
 * Proven by temporal/grading/__tests__/judge-composed.test.ts, the faults in
 * __tests__/steps.test.ts, and the conformance cascade arm.
 */
import type { DescMessage } from "@bufbuild/protobuf";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { ScoringRule } from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/api_pb";
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
import { listAgentScoringRules } from "./queries.js";
import { releaseNamesOfDeleted } from "../../pipeline/steps/names.js";

export function newCascadeDeleteScoringRulesStep<Desc extends DescMessage>(
  store: Store,
  lifecycle: ResourceAuthorizationLifecycle | undefined,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "CascadeDeleteScoringRules",
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
      let scoringRules: ScoringRule[];
      try {
        scoringRules = await listAgentScoringRules(store, logger, agentId);
      } catch (error) {
        throw internalError(
          error,
          "failed to list the agent's scoring rule for cascade delete",
        );
      }
      for (const scoringRule of scoringRules) {
        const scoringRuleId = scoringRule.metadata?.id ?? "";
        try {
          await store.deleteResource(ApiResourceKind.scoring_rule, scoringRuleId);
        } catch (error) {
          if (!(error instanceof ResourceNotFoundError)) {
            throw internalError(
              error,
              `failed to cascade-delete scoring rule ${scoringRuleId} of agent ${agentId}`,
            );
          }
        }
        await releaseNamesOfDeleted(store, logger, ApiResourceKind.scoring_rule, scoringRule.metadata?.org ?? "", scoringRuleId);
        await cleanUpDeletedResource(lifecycle, logger, {
          kind: ApiResourceKind.scoring_rule,
          resourceId: scoringRuleId,
          orgId: scoringRule.metadata?.org ?? "",
          caller: ctx.callerIdentity,
        });
      }
    },
  };
}
