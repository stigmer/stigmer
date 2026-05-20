/**
 * ForTask executor — iterates over a collection, executing a nested
 * `do` block for each element. Returns an ordered array of per-iteration
 * results.
 *
 * Mirrors Go's `ForTaskBuilder` in `task_builder_for.go`. The key
 * behaviors replicated here:
 *
 * - Collection evaluated once up front via jq (null input, state vars)
 * - Per-iteration state cloned from parent snapshot (state.clone().clearOutput())
 * - Iteration variables bound into $data via addData()
 * - Body executed through recursive executeDoTasks()
 * - Optional `while` condition checked per iteration (after variable binding)
 * - Result is an ordered array of per-iteration outputs
 *
 * T17 parallelism (max_parallelism, batch_size, on_error) is deferred
 * to a future phase — sequential execution only.
 */

import type {
  ForTaskDef,
  WorkflowModel,
  WorkflowState,
  ExpressionEvaluator,
  TaskBuilder,
  TaskDef,
} from "../types.js";

/**
 * Lazy import of executeDoTasks to break the circular dependency:
 * do-executor.ts → tasks/for.ts → do-executor.ts.
 *
 * The function is resolved on first call and cached.
 */
let _executeDoTasks: typeof import("../do-executor.js").executeDoTasks | null = null;

async function getExecuteDoTasks() {
  if (_executeDoTasks === null) {
    const mod = await import("../do-executor.js");
    _executeDoTasks = mod.executeDoTasks;
  }
  return _executeDoTasks;
}

// ─────────────────────────────────────────────────────────────────────
// Core Execution
// ─────────────────────────────────────────────────────────────────────

interface IterItem {
  readonly key: unknown;
  readonly value: unknown;
}

/**
 * Executes a `for` task — the sequential iteration engine.
 *
 * Called directly by the do-executor's `runSingleTask()` when it
 * encounters a task with `kind: "for"`.
 */
export async function executeForTask(
  taskDef: ForTaskDef,
  input: unknown,
  state: WorkflowState,
  doc: WorkflowModel,
  evaluateExpressions: ExpressionEvaluator,
): Promise<unknown[]> {
  const executeDoTasks = await getExecuteDoTasks();

  const collection = await evaluateCollectionExpression(
    taskDef.for.in,
    state,
    evaluateExpressions,
  );

  const items = toIterableSlice(collection);
  const eachVar = taskDef.for.each ?? "item";
  const atVar = taskDef.for.at ?? "index";
  const results: unknown[] = [];

  for (const item of items) {
    const iterState = state.clone();
    iterState.clearOutput();

    iterState.addData({
      [eachVar]: item.value,
      [atVar]: item.key,
    });

    if (taskDef.while !== undefined) {
      const shouldContinue = await evaluateWhileCondition(
        taskDef.while,
        iterState,
        evaluateExpressions,
      );
      if (!shouldContinue) break;
    }

    await executeDoTasks(
      taskDef.do,
      input,
      iterState,
      doc,
      evaluateExpressions,
    );

    results.push(iterState.output);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────
// Collection Expression Evaluation
// ─────────────────────────────────────────────────────────────────────

/**
 * Evaluates the `for.in` expression to obtain the collection.
 * Expression is evaluated with null jq input and state variables,
 * matching Go's `EvaluateString(for.In, nil, state)`.
 */
async function evaluateCollectionExpression(
  expression: string,
  state: WorkflowState,
  evaluateExpressions: ExpressionEvaluator,
): Promise<unknown> {
  const rawExpr = expression.startsWith("${ ") && expression.endsWith(" }")
    ? expression.slice(3, -2)
    : expression;

  const stateVars = state.getAsMap();
  const results = await evaluateExpressions(
    { __collection__: rawExpr },
    null,
    stateVars,
  );

  return results.__collection__;
}

// ─────────────────────────────────────────────────────────────────────
// Collection Normalization
// ─────────────────────────────────────────────────────────────────────

/**
 * Normalizes the evaluated collection into an ordered list of
 * key/value pairs. Mirrors Go's `toIterableSlice()`.
 *
 * - Array → [{key: 0, value: el}, ...]
 * - Plain object → [{key: "k", value: v}, ...]
 * - Integer N → [{key: 0, value: 0}, ..., {key: N-1, value: N-1}]
 */
function toIterableSlice(data: unknown): IterItem[] {
  if (Array.isArray(data)) {
    return data.map((value, index) => ({ key: index, value }));
  }

  if (typeof data === "number" && Number.isInteger(data) && data >= 0) {
    return Array.from({ length: data }, (_, i) => ({ key: i, value: i }));
  }

  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    return Object.entries(data as Record<string, unknown>).map(
      ([key, value]) => ({ key, value }),
    );
  }

  const typeDesc = data === null ? "null" : typeof data;
  throw new Error(
    `for.in expression must evaluate to an array, object, or non-negative integer, ` +
    `got ${typeDesc}: ${JSON.stringify(data)}`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// While Condition
// ─────────────────────────────────────────────────────────────────────

/**
 * Evaluates the `while` condition against the current iteration state.
 * Returns true to continue, false to stop. Non-boolean results are
 * treated as false (matching Go's behavior).
 */
async function evaluateWhileCondition(
  expression: string,
  state: WorkflowState,
  evaluateExpressions: ExpressionEvaluator,
): Promise<boolean> {
  const rawExpr = expression.startsWith("${ ") && expression.endsWith(" }")
    ? expression.slice(3, -2)
    : expression;

  const stateVars = state.getAsMap();
  const results = await evaluateExpressions(
    { __while__: rawExpr },
    null,
    stateVars,
  );

  const result = results.__while__;
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
 * Placeholder builder for `for` tasks. The actual execution is handled
 * by the do-executor via `executeForTask()` — this builder exists only
 * to satisfy the TaskBuilder interface in the task factory.
 */
export class ForTaskPlaceholderBuilder implements TaskBuilder {
  readonly taskName: string;
  readonly taskDef: TaskDef;

  constructor(taskName: string, taskDef: TaskDef) {
    this.taskName = taskName;
    this.taskDef = taskDef;
  }

  build() {
    return async () => {
      throw new Error(
        `ForTaskPlaceholderBuilder.build() should never be called directly. ` +
        `The executor handles 'for' tasks via executeForTask().`,
      );
    };
  }

  async shouldRun() {
    return true;
  }
}

export const FOR_TASK_KIND = "for" as const;
