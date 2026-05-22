/**
 * CallFunction Temporal activity — dispatcher for custom call types
 * (llm, agent, transform, validate, etc.).
 *
 * The CNCF DSL `call: <string>` maps to CallFunctionTaskDef. This
 * activity receives the `call` string and routes to the appropriate
 * handler. Currently supports:
 * - "llm" → callLlmAction
 * - "transform" → transformAction (JQ engine)
 * - "validate" → validateAction (JSON Schema + business rules)
 * - "agent" → placeholder (Phase 4b)
 *
 * Activity contract:
 *   Name:   "CallFunction"
 *   Input:  (call: string, config: Record<string, unknown>, runtimeEnv: Record<string, unknown>, executionId: string)
 *   Output: unknown
 */

import { ApplicationFailure } from "@temporalio/activity";
import { callLlmAction, type LlmCallConfig } from "./call-llm.js";
import { callEvalAction, type EvalConfig } from "./call-eval.js";
import { emitEventAction, type EmitEventConfig } from "./emit-event.js";
import { notificationAction, type NotificationConfig } from "./notification.js";
import { transformAction, type TransformConfig } from "./call-transform.js";
import { validateAction, type ValidateConfig } from "./call-validate.js";
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
    case "eval":
      return callEvalAction(resolved as unknown as EvalConfig, runtimeEnv, executionId);
    case "emit_event":
      return emitEventAction(resolved as unknown as EmitEventConfig, executionId, runtimeEnv);
    case "notification":
      return notificationAction(resolved as unknown as NotificationConfig, runtimeEnv);
    case "transform":
      return transformAction(resolved as unknown as TransformConfig, resolved.input);
    case "validate":
      return validateAction(resolved as unknown as ValidateConfig);
    case "agent":
      throw ApplicationFailure.nonRetryable(
        `call:agent is not yet implemented via call:function. Use the dedicated call:agent task kind.`,
        "CALL_AGENT_NOT_IMPLEMENTED",
      );
    default:
      throw ApplicationFailure.nonRetryable(
        `Unknown custom call function '${call}'. Supported: llm, eval, emit_event, notification, transform, validate.`,
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
