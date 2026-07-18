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

/**
 * Detaches deferred-code fields from a call-function config before
 * expression resolution and returns a restorer that puts the originals
 * back afterwards.
 *
 * Some config fields carry jq CODE that the activity evaluates later
 * against its own input — not data to interpolate at config time:
 *
 * - `transform.expression` — evaluated by `transformAction` against the
 *   transform's `input`.
 * - `validate.rules[].expression` — evaluated by `validateAction` per
 *   rule against the validated data.
 *
 * Without the detach, a `${ }`-wrapped predicate is pre-evaluated here
 * against the WRONG input and its non-string RESULT is substituted back
 * into the config; the activity then tries to evaluate that result as jq
 * (the `expr.includes is not a function` crash class). All other fields
 * — including `rules[].message` and the llm/eval prompt fields — are
 * data and continue to interpolate normally. The original config object
 * is never mutated (shared across retries).
 */
function detachDeferredCode(
  callType: string,
  config: Record<string, unknown>,
): {
  readonly config: Record<string, unknown>;
  readonly restore: (resolved: Record<string, unknown>) => void;
} {
  if (callType === "transform" && "expression" in config) {
    const { expression, ...rest } = config;
    return {
      config: rest,
      restore: (resolved) => {
        resolved.expression = expression;
      },
    };
  }

  if (callType === "validate" && Array.isArray(config.rules)) {
    const originalRules = config.rules as readonly unknown[];
    const strippedRules = originalRules.map((rule) => {
      if (isPlainObject(rule) && "expression" in rule) {
        const { expression: _deferred, ...rest } = rule;
        return rest;
      }
      return rule;
    });
    return {
      config: { ...config, rules: strippedRules },
      restore: (resolved) => {
        const resolvedRules = resolved.rules;
        if (!Array.isArray(resolvedRules)) return;
        for (let i = 0; i < resolvedRules.length; i++) {
          const original = originalRules[i];
          const target = resolvedRules[i];
          if (
            isPlainObject(original) &&
            isPlainObject(target) &&
            "expression" in original
          ) {
            target.expression = original.expression;
          }
        }
      },
    };
  }

  return { config, restore: () => {} };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

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
      const callType = this.taskDef.call;

      // Deferred-code fields (transform/validate expressions) must reach
      // the activity as unresolved jq strings — see detachDeferredCode.
      const deferred = detachDeferredCode(
        callType,
        withConfig as Record<string, unknown>,
      );

      const resolved = await resolveConfigExpressions(
        deferred.config,
        input,
        state,
        ctx.evaluateExpressions,
      );
      deferred.restore(resolved);
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
