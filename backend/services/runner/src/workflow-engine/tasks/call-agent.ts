/**
 * CallAgent task builder — invokes a Stigmer agent from a workflow.
 *
 * Unlike call:llm (synchronous activity), call:agent uses Temporal
 * async completion: the activity creates an AgentExecution with a
 * callback token and returns pending. The platform completes the
 * activity when the agent finishes. While pending, the workflow
 * listens for `child_approval_required` signals for HITL propagation.
 *
 * This builder is sandbox-safe — it evaluates jq expressions and
 * delegates to `ctx.callAgent()`. The async completion and signal
 * logic live in the workflow-side orchestrator, not here.
 *
 * Mirrors Go's `CallAgentTaskBuilder` in `task_builder_call_agent.go`.
 */

import type {
  CallAgentTaskDef,
  TaskBuilder,
  TaskExecutorFn,
  AgentCallConfig,
  AgentCallResult,
} from "../types.js";
import { resolveConfigExpressions } from "../resolve.js";
import { validateAgentCallOutput } from "./call-agent-output.js";

/**
 * Enriches an AgentCallResult with __stigmer_* keys so that
 * extractCostFromOutput (in do-executor) can pick up cost/token data.
 */
function enrichResultWithCost(result: AgentCallResult): AgentCallResult {
  const usage = result.usage_summary;
  if (!usage) return result;

  return {
    ...result,
    __stigmer_cost_micros: Math.round((usage.estimated_cost_usd ?? 0) * 1_000_000),
    input_tokens: usage.total_tokens ?? 0,
    output_tokens: 0,
  } as AgentCallResult;
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

      const executionId =
        (state.data["__stigmer_execution_id"] as string | undefined) ?? "";

      const metadata = {
        parentWorkflowId:
          (state.data["__stigmer_parent_workflow_id"] as string | undefined) ?? "",
        taskName: this.taskName,
        workflowExecutionId: executionId,
      };

      const outputContract = withConfig.output;
      const maxRetries = outputContract?.max_retries ?? 2;
      let attempts = 0;
      let lastResult: AgentCallResult;

      do {
        const effectiveConfig =
          attempts === 0
            ? config
            : augmentMessageWithValidationError(config, lastResult!);

        lastResult = await ctx.callAgent(effectiveConfig, state.env, metadata);
        attempts++;

        if (!outputContract?.schema) {
          return enrichResultWithCost(lastResult);
        }

        const validation = validateAgentCallOutput(
          lastResult,
          outputContract.schema,
        );

        if (validation.valid) {
          return enrichResultWithCost(lastResult);
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
            original_output: lastResult,
          };
        }

        // ON_INVALID_RETRY: Before burning a full retry, try extracting
        // structured data from final_text if available (saves ~50-500x
        // cost vs full agent re-execution when the agent produced correct
        // data with formatting issues).
        if (
          onInvalid === "ON_INVALID_RETRY" &&
          lastResult.final_text &&
          !lastResult.structured &&
          ctx.extractStructuredOutput
        ) {
          const extracted = await ctx.extractStructuredOutput(
            lastResult.final_text,
            outputContract.schema,
          );
          if (extracted) {
            const enriched = enrichResultWithCost({
              ...lastResult,
              structured: extracted,
            });
            const revalidation = validateAgentCallOutput(enriched, outputContract.schema);
            if (revalidation.valid) {
              return enriched;
            }
          }
        }
      } while (attempts <= maxRetries);

      throw new Error(
        `Agent output validation failed after ${attempts} attempts ` +
        `for task '${this.taskName}'. Schema validation did not pass.`,
      );
    };
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
