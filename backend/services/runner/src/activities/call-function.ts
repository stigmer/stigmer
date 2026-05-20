/**
 * CallFunction Temporal activity — dispatcher for custom call types
 * (llm, agent, transform, validate, etc.).
 *
 * The CNCF DSL `call: <string>` maps to CallFunctionTaskDef. This
 * activity receives the `call` string and routes to the appropriate
 * handler. Currently supports:
 * - "llm" → callLlmAction
 * - "agent" → placeholder (Phase 4b)
 *
 * Activity contract:
 *   Name:   "CallFunction"
 *   Input:  (call: string, config: Record<string, unknown>, runtimeEnv: Record<string, unknown>, executionId: string)
 *   Output: unknown
 */

import { ApplicationFailure } from "@temporalio/activity";
import { callLlmAction, type LlmCallConfig } from "./call-llm.js";
import { resolveObjectPlaceholders } from "../workflow-engine/resolve.js";

export async function callFunctionAction(
  call: string,
  config: Record<string, unknown>,
  runtimeEnv: Record<string, unknown>,
  executionId: string,
): Promise<unknown> {
  const resolved = resolveObjectPlaceholders(config, runtimeEnv) as Record<string, unknown>;

  switch (call) {
    case "llm":
      return callLlmAction(resolved as unknown as LlmCallConfig, runtimeEnv, executionId);
    case "agent":
      throw ApplicationFailure.nonRetryable(
        `call:agent is not yet implemented in the TypeScript workflow runner. ` +
        `It will be added in Phase 4b.`,
        "CALL_AGENT_NOT_IMPLEMENTED",
      );
    default:
      throw ApplicationFailure.nonRetryable(
        `Unknown custom call function '${call}'. Supported: llm. Coming soon: agent.`,
        "UNKNOWN_CALL_FUNCTION",
      );
  }
}

export function createCallFunctionActivities() {
  return {
    CallFunction: async (
      call: string,
      config: Record<string, unknown>,
      runtimeEnv: Record<string, unknown>,
      executionId: string,
    ): Promise<unknown> => {
      return callFunctionAction(call, config, runtimeEnv, executionId);
    },
  };
}
