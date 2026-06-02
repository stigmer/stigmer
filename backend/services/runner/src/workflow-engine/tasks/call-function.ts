/**
 * CallFunction task builder — handles Stigmer extension call types:
 * `call: llm`, `call: agent`, `call: transform`, etc.
 *
 * The CNCF DSL uses `call: <string>` for custom function calls.
 * This builder evaluates expressions in the `with` config, then
 * delegates to the `ctx.callFunction` callback which routes to
 * the appropriate Temporal activity based on the `call` value.
 *
 * Mirrors Go's custom call function dispatch in `task_builder.go`.
 */

import type {
  CallFunctionTaskDef,
  TaskBuilder,
  TaskExecutorFn,
} from "../types.js";
import { resolveConfigExpressions } from "../resolve.js";

interface LlmActivityResult {
  readonly result: unknown;
  readonly model: string;
  readonly provider: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly parse_error?: string;
  readonly __stigmer_cost_micros?: number;
}

/**
 * Normalizes the raw LlmCallResult from the activity into the documented
 * task output contract: { text, structured, model, usage }.
 *
 * When response_schema is set, the parsed JSON goes into `.structured`.
 * When no schema is used, the raw text goes into `.text`.
 */
function normalizeLlmOutput(
  raw: LlmActivityResult,
  hasResponseSchema: boolean,
): Record<string, unknown> {
  return {
    text: hasResponseSchema ? undefined : raw.result,
    structured: hasResponseSchema ? raw.result : undefined,
    model: raw.model,
    usage: {
      input_tokens: raw.input_tokens,
      output_tokens: raw.output_tokens,
    },
    ...(raw.__stigmer_cost_micros !== undefined
      ? { __stigmer_cost_micros: raw.__stigmer_cost_micros }
      : {}),
  };
}

export class CallFunctionTaskBuilder implements TaskBuilder {
  readonly taskName: string;
  readonly taskDef: CallFunctionTaskDef;

  constructor(taskName: string, taskDef: CallFunctionTaskDef) {
    this.taskName = taskName;
    this.taskDef = taskDef;
  }

  build(): TaskExecutorFn {
    return async (input, state, ctx) => {
      const withConfig = this.taskDef.with ?? {};

      const resolved = await resolveConfigExpressions(
        withConfig as Record<string, unknown>,
        input,
        state,
        ctx.evaluateExpressions,
      );

      const callType = this.taskDef.call;
      if ((callType === "transform" || callType === "validate") &&
          !("input" in resolved) || resolved.input === undefined) {
        resolved.input = input;
      }

      const executionId =
        (state.env.__stigmer_execution_id as string | undefined) || undefined;

      const result = await ctx.callFunction(
        callType,
        resolved,
        state.env,
        {
          workflowExecutionId: executionId,
        },
      );

      if (callType === "llm") {
        return normalizeLlmOutput(
          result as LlmActivityResult,
          !!resolved.response_schema,
        );
      }

      return result;
    };
  }

  async shouldRun(): Promise<boolean> {
    return true;
  }
}
