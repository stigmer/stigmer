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
  DoTaskDef,
  ForTaskDef,
  ForkTaskDef,
  TryTaskDef,
  ListenTaskDef,
  HumanInputTaskDef,
  WorkflowModel,
  WorkflowState,
  TaskExecutionContext,
  ExpressionEvaluator,
} from "./types.js";
import { isTermination, isExplicitTarget } from "./types.js";
import { createTaskBuilder, DO_TASK_KIND, FOR_TASK_KIND, FORK_TASK_KIND, TRY_TASK_KIND, LISTEN_TASK_KIND, HUMAN_INPUT_TASK_KIND } from "./task-factory.js";
import { extractFlowDirective } from "./tasks/switch.js";
import { executeForTask } from "./tasks/for.js";
import { executeForkTask } from "./tasks/fork.js";
import { executeTryTask } from "./tasks/try.js";
import { executeListenTask } from "./tasks/listen.js";
import { executeHumanInputTask } from "./tasks/human-input.js";

/**
 * Executes a `do` task list — the top-level entry point and the
 * recursive handler for nested `do` blocks.
 *
 * Accepts the full TaskExecutionContext for call task support.
 * The `evaluateExpressions` parameter is kept for backward
 * compatibility with `for.ts` — when `ctx` is omitted, a minimal
 * context is constructed from `evaluateExpressions` and `doc`.
 */
export async function executeDoTasks(
  tasks: TaskList,
  input: unknown,
  state: WorkflowState,
  doc: WorkflowModel,
  evaluateExpressions: ExpressionEvaluator,
  ctx?: TaskExecutionContext,
): Promise<unknown> {
  const effectiveCtx: TaskExecutionContext = ctx ?? buildMinimalContext(evaluateExpressions, doc);
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

    const shouldRun = await checkTaskCondition(entry, state, effectiveCtx);
    if (!shouldRun) {
      continue;
    }

    const effectiveInput = await resolveTaskInput(entry, input, state, effectiveCtx);
    const taskOutput = await runSingleTask(entry, effectiveInput, state, doc, effectiveCtx);

    const switchDirective = extractFlowDirective(taskOutput);
    if (switchDirective !== undefined) {
      if (isTermination(switchDirective)) break;
      if (isExplicitTarget(switchDirective)) {
        nextTargetName = switchDirective;
        continue;
      }
    }

    await processTaskOutput(entry, taskOutput, state, effectiveCtx);
    await processTaskExport(entry, taskOutput, state, effectiveCtx);

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

/**
 * Builds a minimal TaskExecutionContext when only evaluateExpressions
 * is available (backward compatibility for for.ts and tests).
 * Call callbacks throw if invoked — call tasks require the full ctx.
 */
function buildMinimalContext(
  evaluateExpressions: ExpressionEvaluator,
  doc: WorkflowModel,
): TaskExecutionContext {
  const notAvailable = (name: string) => () => {
    throw new Error(
      `${name} is not available in this execution context. ` +
      `Call tasks require the full TaskExecutionContext from the workflow function.`,
    );
  };

  return {
    evaluateExpressions,
    doc,
    sleep: notAvailable("sleep"),
    listen: notAvailable("listen"),
    runCommand: notAvailable("runCommand"),
    runWorkflow: notAvailable("runWorkflow"),
    awaitHumanInput: notAvailable("awaitHumanInput"),
    callHttp: notAvailable("callHttp"),
    callGrpc: notAvailable("callGrpc"),
    callFunction: notAvailable("callFunction"),
    callAgent: notAvailable("callAgent"),
  };
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
// Task Input Resolution
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolves a task's effective input. If `task.input.from` is defined,
 * evaluates the expression against the current state and uses the
 * result as the task input. Otherwise, the parent input passes through.
 *
 * Mirrors Go's pre-task input resolution in `evaluateTaskArguments`.
 */
async function resolveTaskInput(
  entry: TaskEntry,
  parentInput: unknown,
  state: WorkflowState,
  ctx: TaskExecutionContext,
): Promise<unknown> {
  const inputFrom = entry.task.input?.from;
  if (inputFrom === undefined) return parentInput;

  if (typeof inputFrom === "string") {
    const rawExpr = inputFrom.startsWith("${ ") && inputFrom.endsWith(" }")
      ? inputFrom.slice(3, -2)
      : inputFrom;

    const stateVars = state.getAsMap();
    const results = await ctx.evaluateExpressions(
      { __input__: rawExpr },
      parentInput,
      stateVars,
    );
    return results.__input__;
  }

  return inputFrom;
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
      ctx,
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
      ctx,
    );
  }

  if (taskDef.kind === FORK_TASK_KIND) {
    const forkTaskDef = taskDef as ForkTaskDef;
    return executeForkTask(
      forkTaskDef,
      input,
      state,
      doc,
      ctx.evaluateExpressions,
      ctx,
    );
  }

  if (taskDef.kind === TRY_TASK_KIND) {
    const tryTaskDef = taskDef as TryTaskDef;
    return executeTryTask(
      tryTaskDef,
      input,
      state,
      doc,
      ctx.evaluateExpressions,
      ctx,
    );
  }

  if (taskDef.kind === LISTEN_TASK_KIND) {
    const listenTaskDef = taskDef as ListenTaskDef;
    return executeListenTask(listenTaskDef, entry.key, state, ctx);
  }

  if (taskDef.kind === HUMAN_INPUT_TASK_KIND) {
    const humanInputDef = taskDef as HumanInputTaskDef;
    return executeHumanInputTask(humanInputDef, entry.key, state, ctx);
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
