/**
 * TryTask executor — runs a `try` task list and catches errors,
 * optionally filtering by type/status, retrying with configurable
 * backoff, and binding the error into state for jq expressions in
 * the `catch.do` block.
 *
 * Exceeds Go's `TryTaskBuilder` in `task_builder_try.go`: Go parses
 * `catch.as` but never binds the error into state, does not implement
 * `catch.errors.with` or `catch.when` filtering, and does not implement
 * catch-level retry. This implementation provides all of these.
 *
 * Execution flow:
 *   1. Run try task list via executeDoTasks()
 *   2. On success → return result
 *   3. On error → normalize to WorkflowError
 *   4. Apply catch.errors.with filter → re-throw if no match
 *   5. Evaluate catch.when expression → re-throw if falsy
 *   6. If catch.retry configured:
 *      a. Evaluate retry.when → skip retry if falsy
 *      b. Evaluate retry.exceptWhen → skip retry if truthy
 *      c. Check attempt/duration limits via computeRetryDelay()
 *      d. Sleep for computed delay
 *      e. Re-execute try task list
 *      f. On success → return result (skip catch.do)
 *      g. On failure → re-check filters, loop back to 6a
 *   7. Bind error to state.data[catch.as] via toJSON()
 *   8. Run catch.do task list (if specified)
 *   9. Return catch result (or undefined if no catch.do)
 */

import type {
  TryTaskDef,
  WorkflowModel,
  WorkflowState,
  ExpressionEvaluator,
  TaskExecutionContext,
  TaskBuilder,
  TaskDef,
  RetryConfig,
} from "../types.js";
import { WorkflowError } from "../errors.js";
import { computeRetryDelay } from "../retry.js";

/**
 * Lazy import of executeDoTasks to break the circular dependency:
 * do-executor.ts → tasks/try.ts → do-executor.ts.
 */
let _executeDoTasks: typeof import("../do-executor.js").executeDoTasks | null = null;

async function getExecuteDoTasks() {
  if (_executeDoTasks === null) {
    const mod = await import("../do-executor.js");
    _executeDoTasks = mod.executeDoTasks;
  }
  return _executeDoTasks;
}

/**
 * Executes a `try` task — the error handling and retry engine.
 *
 * Called directly by the do-executor's `runSingleTask()` when it
 * encounters a task with `kind: "try"`.
 */
export async function executeTryTask(
  taskDef: TryTaskDef,
  input: unknown,
  state: WorkflowState,
  doc: WorkflowModel,
  evaluateExpressions: ExpressionEvaluator,
  ctx?: TaskExecutionContext,
): Promise<unknown> {
  const executeDoTasks = await getExecuteDoTasks();
  const catchConfig = taskDef.catch;

  const retryAttemptLimit = catchConfig?.retry?.limit?.attempt?.count;
  const tryCtx = ctx && catchConfig?.retry
    ? { ...ctx, retryContext: { maxAttempts: retryAttemptLimit != null ? retryAttemptLimit + 1 : Infinity } }
    : ctx;

  const executeTryBlock = () =>
    executeDoTasks(taskDef.try, input, state, doc, evaluateExpressions, tryCtx);

  try {
    return await executeTryBlock();
  } catch (rawError: unknown) {
    let error = WorkflowError.fromUnknown(rawError);

    if (!catchConfig) throw error;
    if (!WorkflowError.matches(error, catchConfig.errors)) throw error;

    if (catchConfig.when !== undefined) {
      if (!await evaluateCondition(catchConfig.when, error, state, evaluateExpressions)) {
        throw error;
      }
    }

    if (catchConfig.retry) {
      const retryResult = await executeRetryLoop(
        catchConfig.retry,
        error,
        executeTryBlock,
        state,
        evaluateExpressions,
        catchConfig.errors,
        catchConfig.when,
        ctx,
      );

      if (retryResult.succeeded) return retryResult.value;
      error = retryResult.lastError;
    }

    if (catchConfig.as) {
      state.addData({ [catchConfig.as]: error.toJSON() });
    }

    if (catchConfig.do) {
      return await executeDoTasks(
        catchConfig.do, input, state, doc, evaluateExpressions, ctx,
      );
    }

    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Retry Loop
// ─────────────────────────────────────────────────────────────────────

interface RetryResult {
  readonly succeeded: boolean;
  readonly value?: unknown;
  readonly lastError: WorkflowError;
}

async function executeRetryLoop(
  retryConfig: RetryConfig,
  initialError: WorkflowError,
  executeTryBlock: () => Promise<unknown>,
  state: WorkflowState,
  evaluateExpressions: ExpressionEvaluator,
  errorFilter: TryTaskDef["catch"]["errors"],
  catchWhen: string | undefined,
  ctx?: TaskExecutionContext,
): Promise<RetryResult> {
  let lastError = initialError;
  let attempt = 0;
  let elapsedMs = 0;

  while (true) {
    if (retryConfig.when !== undefined) {
      if (!await evaluateCondition(retryConfig.when, lastError, state, evaluateExpressions)) {
        break;
      }
    }

    if (retryConfig.exceptWhen !== undefined) {
      if (await evaluateCondition(retryConfig.exceptWhen, lastError, state, evaluateExpressions)) {
        break;
      }
    }

    if (ctx?.checkPause) await ctx.checkPause();

    attempt++;
    const delay = computeRetryDelay(attempt, retryConfig, elapsedMs);
    if (delay === null) break;

    if (ctx?.emitEvents) {
      await ctx.emitEvents([{
        type: "task_retrying",
        occurredAt: new Date().toISOString(),
        failedAttempt: attempt - 1,
        nextAttempt: attempt,
        delayMs: delay,
      }]);
    }

    if (delay > 0 && ctx) {
      await ctx.sleep(delay);
    }
    elapsedMs += delay;

    try {
      const result = await executeTryBlock();
      return { succeeded: true, value: result, lastError };
    } catch (rawError: unknown) {
      lastError = WorkflowError.fromUnknown(rawError);

      if (!WorkflowError.matches(lastError, errorFilter)) {
        throw lastError;
      }

      if (catchWhen !== undefined) {
        if (!await evaluateCondition(catchWhen, lastError, state, evaluateExpressions)) {
          throw lastError;
        }
      }
    }
  }

  return { succeeded: false, lastError };
}

// ─────────────────────────────────────────────────────────────────────
// Expression Evaluation Helper
// ─────────────────────────────────────────────────────────────────────

/**
 * Evaluates a boolean condition expression with the error available
 * as `$error` in the jq expression context. Used by catch.when,
 * retry.when, and retry.exceptWhen.
 */
async function evaluateCondition(
  expression: string,
  error: WorkflowError,
  state: WorkflowState,
  evaluateExpressions: ExpressionEvaluator,
): Promise<boolean> {
  const rawExpr = expression.startsWith("${ ") && expression.endsWith(" }")
    ? expression.slice(3, -2)
    : expression;

  const stateVars = {
    ...state.getAsMap(),
    $error: error.toJSON(),
  };

  const results = await evaluateExpressions(
    { __condition__: rawExpr },
    null,
    stateVars,
  );

  const result = results.__condition__;
  if (typeof result === "boolean") return result;
  if (typeof result === "string") {
    return result.toUpperCase() === "TRUE" || result === "1";
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Placeholder Builder (for task-factory.ts registration)
// ─────────────────────────────────────────────────────────────────────

/**
 * Placeholder builder for `try` tasks. The actual execution is
 * handled by the do-executor via `executeTryTask()` — this builder
 * exists only to satisfy the TaskBuilder interface in the task factory.
 */
export class TryTaskPlaceholderBuilder implements TaskBuilder {
  readonly taskName: string;
  readonly taskDef: TaskDef;

  constructor(taskName: string, taskDef: TaskDef) {
    this.taskName = taskName;
    this.taskDef = taskDef;
  }

  build() {
    return async () => {
      throw new Error(
        `TryTaskPlaceholderBuilder.build() should never be called directly. ` +
        `The executor handles 'try' tasks via executeTryTask().`,
      );
    };
  }

  async shouldRun() {
    return true;
  }
}
