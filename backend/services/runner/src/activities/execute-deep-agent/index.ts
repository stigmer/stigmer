/**
 * ExecuteDeepAgent activity — stub implementation for Phase 1.
 *
 * This activity will be fully implemented in Phase 3 using the DeepAgents JS
 * framework + LangGraph JS. For now, it registers the correct activity name
 * and signature so the unified runner can boot with both activities, and the
 * Go/Java workflow can dispatch to it once the harness routing is updated.
 *
 * Signature matches ExecuteGraphton (Python): (executionId, threadId) → status.
 * The slim-payload pattern is preserved: input is just IDs, output is a slim
 * AgentExecutionStatus proto.
 */

import { create, toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { activityStarted, activityFinished } from "../../idle-watchdog.js";
import type { Config } from "../../config.js";
import { StigmerClient } from "../../client/stigmer-client.js";

export function createDeepAgentActivities(_config: Config) {
  const _client = new StigmerClient({
    endpoint: _config.stigmerBackendEndpoint,
    token: _config.stigmerToken,
  });

  return {
    ExecuteDeepAgent: async (executionId: string, _threadId: string): Promise<unknown> => {
      activityStarted();
      try {
        console.log(
          `[ExecuteDeepAgent] Stub invoked for execution ${executionId} — ` +
          `full implementation pending (Phase 3)`,
        );

        const status = create(AgentExecutionStatusSchema, {
          phase: ExecutionPhase.EXECUTION_FAILED,
          error: "ExecuteDeepAgent is not yet implemented. The unified runner " +
            "is in Phase 1 (scaffold). Deep agent execution will be available " +
            "after Phase 3 is complete.",
          messages: [
            create(AgentMessageSchema, {
              type: MessageType.MESSAGE_SYSTEM,
              content: "ExecuteDeepAgent activity is not yet implemented in the " +
                "unified runner. Please use the Python agent-runner (ExecuteGraphton) " +
                "until Phase 3 migration is complete.",
            }),
          ],
        });

        await _client.updateStatus(executionId, status);

        return toJson(AgentExecutionStatusSchema, status);
      } finally {
        activityFinished();
      }
    },
  };
}
