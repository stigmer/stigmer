/**
 * ForkTask executor — runs branches in parallel, collecting results
 * into a map keyed by branch name (non-compete) or returning the
 * first branch to complete (compete/race mode).
 *
 * Mirrors Go's `ForkTaskBuilder` in `task_builder_fork.go`. Key
 * behaviors replicated here:
 *
 * - Branches validated at execution time (>= 1 required)
 * - Parent state snapshot cloned once, then each branch clones from it
 * - Each branch gets isolated state (clone + clearOutput)
 * - Non-compete: Promise.all, output = { branchName: branchOutput }
 * - Compete: first settlement wins, output = winner's raw output
 * - Any non-cancellation error from any branch fails the fork
 * - Parent state is never mutated by branch execution
 *
 * Cancellation of losing branches in compete mode is intentionally
 * omitted to preserve kernel Temporal-agnosticism. Losing branches
 * run to completion but their results are discarded. Go's cancellation
 * via workflow.WithCancel also does not short-circuit in practice
 * (documented in TestWorkflowFork_CompeteCancellationTiming).
 */

import type {
  ForkTaskDef,
  DoTaskDef,
  WorkflowModel,
  WorkflowState,
  ExpressionEvaluator,
  TaskExecutionContext,
  TaskBuilder,
  TaskDef,
  TaskList,
} from "../types.js";

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

/**
 * Executes a `fork` task — the parallel execution engine.
 *
 * Called directly by the do-executor's `runSingleTask()` when it
 * encounters a task with `kind: "fork"`.
 */
export async function executeForkTask(
  taskDef: ForkTaskDef,
  input: unknown,
  state: WorkflowState,
  doc: WorkflowModel,
  evaluateExpressions: ExpressionEvaluator,
  ctx?: TaskExecutionContext,
): Promise<unknown> {
  const branches = taskDef.fork.branches;

  if (branches.length === 0) {
    throw new Error("Fork task requires at least one branch");
  }

  const executeDoTasks = await getExecuteDoTasks();
  const childSnapshot = state.clone();
  childSnapshot.clearOutput();

  if (taskDef.fork.compete) {
    return executeCompete(branches, input, childSnapshot, doc, evaluateExpressions, ctx, executeDoTasks);
  }

  return executeAllBranches(branches, input, childSnapshot, doc, evaluateExpressions, ctx, executeDoTasks);
}

// ─────────────────────────────────────────────────────────────────────
// Non-Compete: All Branches (Promise.all)
// ─────────────────────────────────────────────────────────────────────

/**
 * Runs all branches in parallel. Fails fast on the first error.
 * Returns a map of { branchName: branchOutput }.
 */
async function executeAllBranches(
  branches: TaskList,
  input: unknown,
  childSnapshot: WorkflowState,
  doc: WorkflowModel,
  evaluateExpressions: ExpressionEvaluator,
  ctx: TaskExecutionContext | undefined,
  executeDoTasks: typeof import("../do-executor.js").executeDoTasks,
): Promise<Record<string, unknown>> {
  const branchPromises = branches.map(async (branch) => {
    const branchState = childSnapshot.clone();
    branchState.clearOutput();

    const branchTasks = normalizeBranchTasks(branch.key, branch.task);

    await executeDoTasks(
      branchTasks,
      input,
      branchState,
      doc,
      evaluateExpressions,
      ctx,
    );

    return { name: branch.key, output: branchState.output };
  });

  const results = await Promise.all(branchPromises);

  const output: Record<string, unknown> = {};
  for (const result of results) {
    output[result.name] = result.output;
  }
  return output;
}

// ─────────────────────────────────────────────────────────────────────
// Compete: First Settlement Wins (Race)
// ─────────────────────────────────────────────────────────────────────

interface RaceResult {
  readonly output: unknown;
}

/**
 * Races all branches. The first branch to resolve determines the
 * fork output. The first branch to reject fails the fork.
 *
 * Losing branches continue running in the background but their
 * results are discarded. Rejections from losing branches are
 * silently caught to prevent unhandled promise rejection warnings.
 */
async function executeCompete(
  branches: TaskList,
  input: unknown,
  childSnapshot: WorkflowState,
  doc: WorkflowModel,
  evaluateExpressions: ExpressionEvaluator,
  ctx: TaskExecutionContext | undefined,
  executeDoTasks: typeof import("../do-executor.js").executeDoTasks,
): Promise<unknown> {
  const branchPromises = branches.map(async (branch): Promise<RaceResult> => {
    const branchState = childSnapshot.clone();
    branchState.clearOutput();

    const branchTasks = normalizeBranchTasks(branch.key, branch.task);

    await executeDoTasks(
      branchTasks,
      input,
      branchState,
      doc,
      evaluateExpressions,
      ctx,
    );

    return { output: branchState.output };
  });

  // Attach no-op catch handlers to all promises so that rejections
  // from losing branches don't surface as unhandled rejections.
  // The actual error propagation happens through the race winner.
  for (const p of branchPromises) {
    p.catch(() => {});
  }

  const winner = await Promise.race(branchPromises);
  return winner.output;
}

// ─────────────────────────────────────────────────────────────────────
// Branch Normalization
// ─────────────────────────────────────────────────────────────────────

/**
 * Normalizes a branch's task definition into a TaskList suitable
 * for executeDoTasks(). Branches parsed from YAML are typically
 * DoTaskDefs (the branch contains a `do:` block), but a single
 * leaf task is wrapped into a one-element task list.
 *
 * Mirrors Go's branch wrapping in ForkTaskBuilder.buildOrPostLoad().
 */
function normalizeBranchTasks(branchName: string, task: TaskDef): TaskList {
  if (task.kind === "do") {
    return (task as DoTaskDef).do;
  }
  return [{ key: branchName, task }];
}

// ─────────────────────────────────────────────────────────────────────
// Placeholder Builder (for task-factory.ts registration)
// ─────────────────────────────────────────────────────────────────────

/**
 * Placeholder builder for `fork` tasks. The actual execution is
 * handled by the do-executor via `executeForkTask()` — this builder
 * exists only to satisfy the TaskBuilder interface in the task factory.
 */
export class ForkTaskPlaceholderBuilder implements TaskBuilder {
  readonly taskName: string;
  readonly taskDef: TaskDef;

  constructor(taskName: string, taskDef: TaskDef) {
    this.taskName = taskName;
    this.taskDef = taskDef;
  }

  build() {
    return async () => {
      throw new Error(
        `ForkTaskPlaceholderBuilder.build() should never be called directly. ` +
        `The executor handles 'fork' tasks via executeForkTask().`,
      );
    };
  }

  async shouldRun() {
    return true;
  }
}
