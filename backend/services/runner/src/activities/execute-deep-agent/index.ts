/**
 * ExecuteDeepAgent activity — runs a Stigmer deep agent via LangGraph.
 *
 * Phase 3a scope: full setup pipeline + minimal streaming (captures the
 * final assistant message for UI visibility). Middleware, StatusBuilder,
 * and HITL interrupt/resume are added in Phases 3b/3c.
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
import { persistStatus, slimStatus, utcTimestamp } from "../../shared/status.js";
import type { Config } from "../../config.js";
import { StigmerClient } from "../../client/stigmer-client.js";
import { performSetup, type SetupResult } from "./setup.js";

export function createDeepAgentActivities(config: Config) {
  const client = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
  });

  return {
    ExecuteDeepAgent: async (executionId: string, threadId: string): Promise<unknown> => {
      activityStarted();
      let setup: SetupResult | null = null;

      try {
        console.log(`[ExecuteDeepAgent] Started for execution ${executionId}`);

        // Phase 1: Setup
        setup = await performSetup({ config, client, executionId, threadId });

        // Phase 2: Execute the agent
        const result = await executeAgent(setup);

        // Phase 3: Build final status from result
        const finalStatus = buildFinalStatus(result);

        // Phase 4: Persist status
        await persistStatus(client, executionId, finalStatus);

        console.log(
          `[ExecuteDeepAgent] Completed for execution ${executionId}: ` +
          `messages=${finalStatus.messages.length}`,
        );

        return slimStatus(finalStatus);

      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorType = err instanceof Error ? err.constructor.name : "UnknownError";

        console.error(
          `[ExecuteDeepAgent] Failed for execution ${executionId}: ` +
          `[${errorType}] ${errorMessage}`,
        );

        const failedStatus = create(AgentExecutionStatusSchema, {
          phase: ExecutionPhase.EXECUTION_FAILED,
          error: `Execution failed: [${errorType}] ${errorMessage}`,
          completedAt: utcTimestamp(),
          messages: [
            create(AgentMessageSchema, {
              type: MessageType.MESSAGE_SYSTEM,
              content: `Error: [${errorType}] ${errorMessage}`,
              timestamp: utcTimestamp(),
            }),
          ],
        });

        await persistStatus(client, executionId, failedStatus);
        return slimStatus(failedStatus);

      } finally {
        await cleanup(setup);
        activityFinished();
      }
    },
  };
}

/**
 * Stream the agent execution and extract the final messages.
 *
 * Phase 3a: uses invoke() for simplicity, capturing the final state.
 * Phase 3b will switch to streamEvents() with progressive status updates.
 */
async function executeAgent(setup: SetupResult): Promise<AgentResult> {
  const { agentGraph, langgraphConfig, langgraphInput } = setup;

  const result = await agentGraph.invoke(langgraphInput, langgraphConfig);

  const messages: ExtractedMessage[] = [];

  if (result.messages && Array.isArray(result.messages)) {
    for (const msg of result.messages) {
      const role = msg._getType?.() ?? msg.constructor?.name ?? "unknown";
      const content = extractContent(msg);

      if (role === "ai" || role === "AIMessage") {
        messages.push({ role: "assistant", content });
      } else if (role === "tool" || role === "ToolMessage") {
        messages.push({ role: "tool", content, toolName: msg.name });
      }
    }
  }

  return { messages };
}

interface AgentResult {
  messages: ExtractedMessage[];
}

interface ExtractedMessage {
  role: "assistant" | "tool";
  content: string;
  toolName?: string;
}

/**
 * Extract string content from a LangChain message, handling both
 * string content and content block arrays.
 */
function extractContent(msg: any): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("");
  }
  return "";
}

/**
 * Build the final AgentExecutionStatus from the agent result.
 *
 * Phase 3a: captures assistant messages only. Phase 3b adds tool calls,
 * sub-agent tracking, usage metrics, and progressive streaming status.
 */
function buildFinalStatus(result: AgentResult) {
  const assistantMessages = result.messages.filter(m => m.role === "assistant");
  const lastMessage = assistantMessages[assistantMessages.length - 1];

  return create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_COMPLETED,
    startedAt: utcTimestamp(),
    completedAt: utcTimestamp(),
    messages: lastMessage
      ? [
          create(AgentMessageSchema, {
            type: MessageType.MESSAGE_AI,
            content: lastMessage.content,
            timestamp: utcTimestamp(),
          }),
        ]
      : [],
  });
}

/**
 * Clean up resources from a setup that may be partially initialized.
 */
async function cleanup(setup: SetupResult | null): Promise<void> {
  if (!setup) return;

  if (setup.mcpConnection) {
    try {
      await setup.mcpConnection.client.close();
    } catch (err) {
      console.warn("[ExecuteDeepAgent] MCP connection cleanup failed:", err);
    }
  }
}
