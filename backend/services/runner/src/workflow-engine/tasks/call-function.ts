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

      const fnMeta = { workflowExecutionId: executionId };

      if (callType === "llm") {
        return this.executeLlmCall(resolved, state.env, fnMeta, ctx);
      }

      return ctx.callFunction(callType, resolved, state.env, fnMeta);
    };
  }

  /**
   * Executes a `call: llm` with schema-validation policy orchestration —
   * the llm twin of call-agent's output-contract loop (#686).
   *
   * With ON_INVALID_RETRY / ON_INVALID_FALLBACK the activity reports a
   * validation miss as a `parse_error` result instead of throwing; each
   * retry is its own activity invocation (visible in Temporal history)
   * re-prompting with the validation errors so the model can self-correct.
   * Exhausted retries (or immediate FALLBACK) branch to `fallback_task`
   * via the engine's flow directive; without one, the task fails — the
   * proto contract. ON_INVALID_FAIL (default) keeps the activity's
   * throwing path: one attempt, LLM_SCHEMA_VALIDATION on miss.
   */
  private async executeLlmCall(
    resolved: Record<string, unknown>,
    env: Record<string, unknown>,
    fnMeta: { workflowExecutionId?: string },
    ctx: Parameters<TaskExecutorFn>[2],
  ): Promise<unknown> {
    const hasSchema = !!resolved.response_schema;
    const onInvalid = (resolved.on_invalid as string | undefined) ?? "ON_INVALID_FAIL";
    const softHandling =
      hasSchema && (onInvalid === "ON_INVALID_RETRY" || onInvalid === "ON_INVALID_FALLBACK");

    // Proto: max_retries "Default: 1", meaningful only for ON_INVALID_RETRY.
    const maxRetries =
      onInvalid === "ON_INVALID_RETRY" ? (resolved.max_retries as number | undefined) ?? 1 : 0;

    let attempts = 0;
    let lastParseError = "";

    do {
      const attemptConfig =
        attempts === 0
          ? resolved
          : {
              ...resolved,
              prompt:
                `${resolved.prompt}\n\n[RETRY — Your previous response did not match ` +
                `the required output schema. Validation errors: ${lastParseError}. ` +
                `Please ensure your response strictly matches the JSON schema provided.]`,
            };

      const result = (await ctx.callFunction(
        "llm",
        attemptConfig,
        env,
        fnMeta,
      )) as LlmActivityResult;

      if (!softHandling || !result.parse_error) {
        return normalizeLlmOutput(result, hasSchema);
      }

      lastParseError = result.parse_error;
      attempts++;
    } while (onInvalid === "ON_INVALID_RETRY" && attempts <= maxRetries);

    if (typeof resolved.fallback_task === "string" && resolved.fallback_task !== "") {
      return {
        __flow_directive__: resolved.fallback_task,
        validation_errors: [lastParseError],
      };
    }

    throw new Error(
      `LLM output validation failed after ${attempts} attempt(s) ` +
      `for task '${this.taskName}': ${lastParseError}`,
    );
  }

  async shouldRun(): Promise<boolean> {
    return true;
  }
}
