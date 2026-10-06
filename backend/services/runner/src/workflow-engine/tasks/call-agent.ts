/**
 * CallAgent task builder — invokes a Stigmer agent from a workflow.
 *
 * Unlike call:llm (synchronous activity), call:agent uses Temporal
 * async completion: the activity creates an AgentRun with a
 * callback token and returns pending. The platform completes the
 * activity when the agent finishes. While pending, the workflow
 * listens for `child_approval_required` signals for HITL propagation.
 *
 * This builder is sandbox-safe — it evaluates jq expressions and
 * delegates to `ctx.callAgent()`. The async completion and signal
 * logic live in the workflow-side orchestrator, not here. It hands
 * over only the task's name: the ids that link the child to this run
 * are the engine's own, never values from workflow data.
 */

import type {
  CallAgentTaskDef,
  TaskBuilder,
  TaskExecutorFn,
  TaskExecutionContext,
  AgentCallConfig,
  AgentCallOutput,
  AgentCallResult,
  AgentCallRunIdKey,
  CallAgentMetadata,
} from "../types.js";
import { AgentCallError } from "../types.js";
import { resolveConfigExpressions } from "../resolve.js";
import { validateAgentCallOutput } from "./call-agent-output.js";

/**
 * Temporal patch id for naming an agent_call step's child run
 * `agent_run_id` in its output. Wire bytes: a rename makes every history
 * that carries the marker replay down the old path. The engine checks it
 * once, at a run's start (`TaskExecutionContext.agentCallRunIdKey`).
 */
export const AGENT_CALL_RUN_ID_KEY_PATCH = "agent-call-output-agent-run-id";

/**
 * The step's output as a workflow reads it. The child run's id is
 * `agent_run_id`, the key workflow expressions read
 * (`${ .triage.agent_run_id }`); the engine's callback result names it
 * `agent_execution_id`, an engine key that runs in flight still carry, so
 * the step renames it here rather than at the callback. A run started
 * before the rename keeps `agent_execution_id` (`runIdKey`): its workflow's
 * expressions were written against it, and its history recorded it.
 *
 * Also adds the __stigmer_* keys so that extractCostFromOutput (in
 * do-executor) can pick up cost/token data. Agent usage_summary only
 * provides total_tokens (no input/output split): total_tokens maps to
 * input_tokens and output_tokens stays 0. The do-executor sets metadata
 * `token_attribution: "total_only"` so the frontend can avoid displaying a
 * misleading split.
 */
function toStepOutput(
  result: AgentCallResult,
  runIdKey: AgentCallRunIdKey = "agent_run_id",
): AgentCallOutput {
  const { agent_execution_id: agentRunId, ...rest } = result;
  const output: AgentCallOutput =
    agentRunId === undefined ? rest : { ...rest, [runIdKey]: agentRunId };
  const usage = result.usage_summary;
  if (!usage) return output;

  return {
    ...output,
    __stigmer_cost_micros: Math.round((usage.estimated_cost_usd ?? 0) * 1_000_000),
    input_tokens: usage.total_tokens ?? 0,
    output_tokens: 0,
  };
}

export class CallAgentTaskBuilder implements TaskBuilder {
  readonly taskName: string;
  readonly taskDef: CallAgentTaskDef;

  constructor(taskName: string, taskDef: CallAgentTaskDef) {
    this.taskName = taskName;
    this.taskDef = taskDef;
  }

  build(): TaskExecutorFn {
    return async (input, state, ctx) => {
      const withConfig = this.taskDef.with;

      const resolved = await resolveConfigExpressions(
        withConfig as unknown as Record<string, unknown>,
        input,
        state,
        ctx.evaluateExpressions,
      );

      const config = resolved as unknown as AgentCallConfig;

      // Only the task's own name travels from here. The child's `parent`
      // link (the workflow execution id, the workflow to signal and the
      // task token) comes from the runner's own run: the engine adds its
      // workflow id and execution id, the activity its own task token.
      // None of it is read from workflow data, which the workflow's own
      // tasks can write.
      const metadata = { taskName: this.taskName };

      const outputContract = withConfig.output;
      const maxRetries = outputContract?.max_retries ?? 2;
      let attempts = 0;
      let lastResult: AgentCallResult;

      do {
        const effectiveConfig =
          attempts === 0
            ? config
            : augmentMessageWithValidationError(config, lastResult!);

        lastResult = await this.executeAgentCall(
          effectiveConfig, state.env, metadata, ctx,
        );
        attempts++;

        if (!outputContract?.schema) {
          return toStepOutput(lastResult, ctx.agentCallRunIdKey);
        }

        const validation = validateAgentCallOutput(
          lastResult,
          outputContract.schema,
        );

        if (validation.valid) {
          return toStepOutput(lastResult, ctx.agentCallRunIdKey);
        }

        const onInvalid = outputContract.on_invalid ?? "ON_INVALID_FAIL";

        if (onInvalid === "ON_INVALID_FAIL") {
          throw new Error(
            `Agent output validation failed for task '${this.taskName}': ` +
            `${validation.errors.join("; ")}`,
          );
        }

        if (onInvalid === "ON_INVALID_FALLBACK") {
          return {
            __flow_directive__: outputContract.fallback_task ?? "continue",
            validation_errors: validation.errors,
            original_output: toStepOutput(lastResult, ctx.agentCallRunIdKey),
          };
        }
      } while (attempts <= maxRetries);

      throw new Error(
        `Agent output validation failed after ${attempts} attempts ` +
        `for task '${this.taskName}'. Schema validation did not pass.`,
      );
    };
  }

  /**
   * Executes a single agent call with event emission bracketing.
   *
   * Emits `agent_call_started` before dispatching and
   * `agent_call_completed` after completion (success or failure).
   * These events drive the waterfall timeline's nested sub-span bars.
   */
  private async executeAgentCall(
    config: AgentCallConfig,
    env: Record<string, unknown>,
    metadata: CallAgentMetadata,
    ctx: TaskExecutionContext,
  ): Promise<AgentCallResult> {
    const callStartMs = Date.now();
    const messageSummary = (config.message ?? "").slice(0, 200);

    if (ctx.emitEvents) {
      await ctx.emitEvents([{
        type: "agent_call_started",
        taskName: this.taskName,
        occurredAt: new Date().toISOString(),
        childExecutionId: "",
        agentSlug: config.agent ?? "",
        messageSummary,
      }]);
    }

    let result: AgentCallResult;
    try {
      result = await ctx.callAgent(config, env, metadata);
    } catch (err) {
      const errorChildExecId = err instanceof AgentCallError
        ? err.childExecutionId
        : "";
      if (ctx.emitEvents) {
        await ctx.emitEvents([{
          type: "agent_call_completed",
          taskName: this.taskName,
          occurredAt: new Date().toISOString(),
          childExecutionId: errorChildExecId,
          durationMs: Date.now() - callStartMs,
          tokensConsumed: 0,
          costMicros: 0,
          error: err instanceof Error ? err.message : String(err),
        }]);
      }
      throw err;
    }

    if (ctx.emitEvents) {
      const usage = result.usage_summary;
      await ctx.emitEvents([{
        type: "agent_call_completed",
        taskName: this.taskName,
        occurredAt: new Date().toISOString(),
        childExecutionId: result.agent_execution_id ?? "",
        durationMs: Date.now() - callStartMs,
        tokensConsumed: usage?.total_tokens ?? 0,
        costMicros: Math.round((usage?.estimated_cost_usd ?? 0) * 1_000_000),
        error: "",
      }]);
    }

    return result;
  }

  async shouldRun(): Promise<boolean> {
    return true;
  }
}

function augmentMessageWithValidationError(
  config: AgentCallConfig,
  previousResult: AgentCallResult,
): AgentCallConfig {
  const validationContext =
    `\n\n[RETRY — Your previous response did not match the required output schema. ` +
    `Previous response: ${JSON.stringify(previousResult.structured ?? previousResult.final_text)}. ` +
    `Please ensure your response strictly matches the JSON schema provided.]`;

  return {
    ...config,
    message: config.message + validationContext,
  };
}
