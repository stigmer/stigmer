/**
 * The agent eval kind's shared read: an agent's evals, newest first
 * (listByAgent, the agent-delete cascade), through the list index. Every
 * row is re-checked against the agent it was asked for, whatever the index
 * returned; undecodable rows are skipped and logged, as the plugin eval's
 * reads do (domain/plugin-eval/queries.ts); a store fault is thrown as it
 * came. An eval's tries are found as a plugin eval's are, by the label's
 * index key (domain/plugin-eval/queries.ts listTrySessionIds).
 */
import { fromBinary } from "@bufbuild/protobuf";

import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import type { Store } from "../../store/interface.js";
import { agentEvalListIndex } from "./list-index.js";

/** Every eval of one agent, newest first. */
export async function listAgentEvals(store: Store, logger: Logger, agentId: string): Promise<AgentEval[]> {
  const rows = await store.queryResources(agentEvalListIndex, {
    anyKey: [{ name: "agent", value: agentId }],
  });
  const evals: AgentEval[] = [];
  for (const row of rows) {
    try {
      evals.push(fromBinary(AgentEvalSchema, row.data));
    } catch (error) {
      logger.warn("skipped an agent eval row that does not decode", {
        evalId: row.id,
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return evals.filter((agentEval) => agentEval.spec?.agentId === agentId);
}
