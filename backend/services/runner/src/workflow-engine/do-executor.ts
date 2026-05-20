/**
 * DoTask executor — the core of the workflow engine. Iterates
 * through an ordered list of tasks, handling state flow, conditional
 * execution, output/export processing, and flow directives.
 *
 * This is the TypeScript equivalent of Go's `DoTaskBuilder.iterateTasks()`
 * in `task_builder_do.go`. The execution model is an interpreter over
 * an ordered task list with name-based jumps, not a graph walker.
 *
 * Flow control:
 * - `then: "continue"` → proceed to next task (default)
 * - `then: "end"` / `then: "exit"` → terminate
 * - `then: "<taskName>"` → jump to the named task
 * - Switch tasks return a `__flow_directive__` in their output
 */

import type {
  TaskList,
  TaskEntry,
  TaskDef,
  DoTaskDef,
  ForTaskDef,
  WorkflowModel,
  WorkflowState,
  TaskExecutionContext,
  ExpressionEvaluator,
} from "./types.js";
import { isTermination, isExplicitTarget, FLOW_CONTINUE } from "./types.js";
import { createTaskBuilder, DO_TASK_KIND, FOR_TASK_KIND } from "./task-factory.js";
import { extractFlowDirective } from "./tasks/switch.js";
import { executeForTask } from "./tasks/for.js";

/**
 * Executes a `do` task list — the top-level entry point and the
 * recursive handler for nested `do` blocks.
 *
 * @param tasks - Ordered list of named tasks to execute
 * @param input - The workflow or parent task input
 * @param state - Mutable workflow state
 * @param doc - The workflow document (for task builder context)
 * @param evaluateExpressions - Batch expression evaluator (local activity)
 * @returns The final state.output value
 */
export async function executeDoTasks(
  tasks: TaskList,
  input: unknown,
  state: WorkflowState,
  doc: WorkflowModel,
  evaluateExpressions: ExpressionEvaluator,
): Promise<unknown> {
  const ctx: TaskExecutionContext = { evaluateExpressions, doc };
  let nextTargetName: string | null = null;

  for (let i = 0; i < tasks.length; i++) {
    const entry = tasks[i];

    if (nextTargetName !== null) {
      if (entry.key === nextTargetName) {
        nextTargetName = null;
      } else {
        continue;
      }
    }

    state.addData({
      task: { name: entry.key },
    });

    const shouldRun = await checkTaskCondition(entry, state, ctx);
    if (!shouldRun) {
      continue;
    }

    const taskOutput = await runSingleTask(entry, input, state, doc, ctx);

    const switchDirective = extractFlowDirective(taskOutput);
    if (switchDirective !== undefined) {
      if (isTermination(switchDirective)) break;
      if (isExplicitTarget(switchDirective)) {
        nextTargetName = switchDirective;
        continue;
      }
    }

    await processTaskOutput(entry, taskOutput, state, ctx);
    await processTaskExport(entry, taskOutput, state, ctx);

    const staticDirective = entry.task.then;
    if (staticDirective !== undefined) {
      if (isTermination(staticDirective)) break;
      if (isExplicitTarget(staticDirective)) {
        nextTargetName = staticDirective;
        continue;
      }
    }
  }

  if (nextTargetName !== null) {
    throw new Error(`Flow directive target '${nextTargetName}' not found in task list`);
  }

  return state.output;
}

// ─────────────────────────────────────────────────────────────────────
// Task Condition Check
// ─────────────────────────────────────────────────────────────────────

async function checkTaskCondition(
  entry: TaskEntry,
  state: WorkflowState,
  ctx: TaskExecutionContext,
): Promise<boolean> {
  const ifExpr = entry.task.if;
  if (ifExpr === undefined) return true;

  const stateVars = state.getAsMap();
  const exprToEval = ifExpr.startsWith("${ ") && ifExpr.endsWith(" }")
    ? ifExpr.slice(3, -2)
    : ifExpr;

  const results = await ctx.evaluateExpressions(
    { __if__: exprToEval },
    null,
    stateVars,
  );

  const result = results.__if__;
  if (typeof result === "boolean") return result;
  if (typeof result === "string") {
    return result.toUpperCase() === "TRUE" || result === "1";
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Single Task Execution
// ─────────────────────────────────────────────────────────────────────

async function runSingleTask(
  entry: TaskEntry,
  input: unknown,
  state: WorkflowState,
  doc: WorkflowModel,
  ctx: TaskExecutionContext,
): Promise<unknown> {
  const taskDef = entry.task;

  if (taskDef.kind === DO_TASK_KIND) {
    const doTaskDef = taskDef as DoTaskDef;
    return executeDoTasks(
      doTaskDef.do,
      input,
      state,
      doc,
      ctx.evaluateExpressions,
    );
  }

  if (taskDef.kind === FOR_TASK_KIND) {
    const forTaskDef = taskDef as ForTaskDef;
    return executeForTask(
      forTaskDef,
      input,
      state,
      doc,
      ctx.evaluateExpressions,
    );
  }

  const builder = createTaskBuilder(entry.key, taskDef, doc);
  const executor = builder.build();
  const output = await executor(input, state, ctx);

  return output;
}

// ─────────────────────────────────────────────────────────────────────
// Output Processing
// ─────────────────────────────────────────────────────────────────────

/**
 * Processes a task's `output.as` transform. If defined, evaluates
 * the expression against the task output and updates state.output.
 * If not defined, state.output is set to the raw task output.
 */
async function processTaskOutput(
  entry: TaskEntry,
  taskOutput: unknown,
  state: WorkflowState,
  ctx: TaskExecutionContext,
): Promise<void> {
  if (entry.task.output?.as === undefined) {
    state.output = taskOutput;
    return;
  }

  const outputAs = entry.task.output.as;

  if (typeof outputAs === "string") {
    if (outputAs.startsWith("${ ") && outputAs.endsWith(" }")) {
      const stateVars = state.getAsMap();
      const results = await ctx.evaluateExpressions(
        { __output__: outputAs.slice(3, -2) },
        taskOutput,
        stateVars,
      );
      state.output = results.__output__;
    } else {
      state.output = taskOutput;
    }
  } else {
    state.output = taskOutput;
  }
}

/**
 * Processes a task's `export.as` transform. If defined, evaluates
 * the expression against the task output and merges the result
 * into state.context keyed by task name.
 */
async function processTaskExport(
  entry: TaskEntry,
  taskOutput: unknown,
  state: WorkflowState,
  ctx: TaskExecutionContext,
): Promise<void> {
  if (entry.task.export?.as === undefined) return;

  const exportAs = entry.task.export.as;
  let exportValue: unknown;

  if (typeof exportAs === "string") {
    if (exportAs.startsWith("${ ") && exportAs.endsWith(" }")) {
      const stateVars = state.getAsMap();
      const results = await ctx.evaluateExpressions(
        { __export__: exportAs.slice(3, -2) },
        taskOutput,
        stateVars,
      );
      exportValue = results.__export__;
    } else {
      exportValue = taskOutput;
    }
  } else {
    exportValue = taskOutput;
  }

  if (state.context === null) {
    state.context = {};
  }

  const contextMap = state.context as Record<string, unknown>;
  contextMap[entry.key] = exportValue;
  state.context = contextMap;
}
