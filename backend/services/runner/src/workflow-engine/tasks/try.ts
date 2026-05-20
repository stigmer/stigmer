/**
 * TryTask executor — runs a `try` task list and catches errors,
 * optionally filtering by type/status and binding the error into
 * state for jq expressions in the `catch.do` block.
 *
 * Mirrors Go's `TryTaskBuilder` in `task_builder_try.go` but
 * exceeds it: Go parses `catch.as` but never binds the error
 * into state, and does not implement `catch.errors.with` or
 * `catch.when` filtering. This implementation does both.
 *
 * Execution flow:
 *   1. Run try task list via executeDoTasks()
 *   2. On success → return result
 *   3. On error → normalize to WorkflowError
 *   4. Apply catch.errors.with filter → re-throw if no match
 *   5. Evaluate catch.when expression → re-throw if falsy
 *   6. Bind error to state.data[catch.as] via toJSON()
 *   7. Run catch.do task list (if specified)
 *   8. Return catch result (or undefined if no catch.do)
 *
 * Catch-level retry is deferred to Phase 5.1b.
 */

import type {
  TryTaskDef,
  WorkflowModel,
  WorkflowState,
  ExpressionEvaluator,
  TaskExecutionContext,
  TaskBuilder,
  TaskDef,
} from "../types.js";
import { WorkflowError } from "../errors.js";

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
 * Executes a `try` task — the error handling engine.
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

  try {
    const result = await executeDoTasks(
      taskDef.try,
      input,
      state,
      doc,
      evaluateExpressions,
      ctx,
    );
    return result;
  } catch (rawError: unknown) {
    const error = WorkflowError.fromUnknown(rawError);
    const catchConfig = taskDef.catch;

    if (!catchConfig) {
      throw error;
    }

    if (!WorkflowError.matches(error, catchConfig.errors)) {
      throw error;
    }

    if (catchConfig.when !== undefined) {
      const shouldCatch = await evaluateCatchWhen(
        catchConfig.when,
        error,
        state,
        evaluateExpressions,
      );
      if (!shouldCatch) {
        throw error;
      }
    }

    if (catchConfig.as) {
      state.addData({
        [catchConfig.as]: error.toJSON(),
      });
    }

    if (catchConfig.do) {
      const catchResult = await executeDoTasks(
        catchConfig.do,
        input,
        state,
        doc,
        evaluateExpressions,
        ctx,
      );
      return catchResult;
    }

    return undefined;
  }
}

/**
 * Evaluates the `catch.when` expression to decide whether to
 * enter the catch block. The error is available as `$error`
 * in the jq expression context.
 */
async function evaluateCatchWhen(
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
    { __catch_when__: rawExpr },
    null,
    stateVars,
  );

  const result = results.__catch_when__;
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
