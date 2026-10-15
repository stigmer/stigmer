/**
 * The evaluator kind's shared read, through its list index (list-index.ts
 * beside this file): an agent's evaluators, for getByAgent, the
 * one-per-agent rule, the agent-delete cascade and the judge planner. Every
 * row is re-checked against the agent it was asked for, whatever the index
 * returned. Undecodable rows are skipped and logged, as the score's reads
 * do (domain/score/queries.ts); a store fault is thrown as it came.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { ScoringRuleSchema } from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/api_pb";
import type { ScoringRule } from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import type { Store } from "../../store/interface.js";
import { scoringRuleListIndex } from "./list-index.js";

/** Every evaluator of one agent; the one-per-agent rule makes it at most one. */
export async function listAgentScoringRules(
  store: Store,
  logger: Logger,
  agentId: string,
): Promise<ScoringRule[]> {
  const rows = await store.queryResources(scoringRuleListIndex, {
    anyKey: [{ name: "agent", value: agentId }],
  });
  const evaluators: ScoringRule[] = [];
  for (const row of rows) {
    try {
      evaluators.push(fromBinary(ScoringRuleSchema, row.data));
    } catch (error) {
      logger.warn("skipped an evaluator row that does not decode", {
        evaluatorId: row.id,
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return evaluators.filter((evaluator) => evaluator.spec?.agentId === agentId);
}
