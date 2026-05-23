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
  CallFunctionTaskDef,
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
import { extractCostFromOutput } from "../budget/index.js";
import { truncatePayload } from "./task-status-accumulator.js";
import { extractRootErrorMessage, extractStructuredError } from "./error-utils.js";

/**
 * Returns the task kind string used for event emission. For call:function
 * tasks, appends the specific function name (e.g., "call:function:llm")
 * so the event system can map to the precise proto WorkflowTaskKind
 * (llm_call, eval, etc.) instead of the generic activity_call fallback.
 */
function eventTaskKind(entry: TaskEntry): string {
  if (entry.task.kind === "call:function") {
    const call = (entry.task as CallFunctionTaskDef).call;
    return `call:function:${call}`;
  }
  return entry.task.kind;
}

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
    if (effectiveCtx.checkPause) await effectiveCtx.checkPause();

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
      effectiveCtx.taskStatusAccumulator?.taskSkipped(entry.key, "condition evaluated to false");
      if (effectiveCtx.emitEvents) {
        await effectiveCtx.emitEvents([{
          type: "task_skipped",
          taskName: entry.key,
          occurredAt: new Date().toISOString(),
          taskKind: eventTaskKind(entry),
          reason: "condition evaluated to false",
        }]);
      }
      continue;
    }

    const kind = eventTaskKind(entry);
    effectiveCtx.taskStatusAccumulator?.taskStarted(entry.key, kind);
    if (effectiveCtx.emitEvents) {
      await effectiveCtx.emitEvents([{
        type: "task_started",
        taskName: entry.key,
        occurredAt: new Date().toISOString(),
        taskKind: kind,
        attemptNumber: 1,
      }]);
    }

    const taskStartMs = Date.now();
    let taskOutput: unknown;
    try {
      const effectiveInput = await resolveTaskInput(entry, input, state, effectiveCtx);
      effectiveCtx.taskStatusAccumulator?.taskStartedWithInput(entry.key, kind, truncatePayload(effectiveInput));
      taskOutput = await runSingleTask(entry, effectiveInput, state, doc, effectiveCtx);
    } catch (taskErr) {
      const errorMsg = extractRootErrorMessage(taskErr);
      const structuredError = extractStructuredError(taskErr);
      effectiveCtx.taskStatusAccumulator?.taskFailed(
        entry.key,
        errorMsg,
        structuredError ?? undefined,
      );
      if (effectiveCtx.emitEvents) {
        await effectiveCtx.emitEvents([{
          type: "task_failed",
          taskName: entry.key,
          occurredAt: new Date().toISOString(),
          taskKind: kind,
          error: errorMsg,
          attemptNumber: 1,
          willRetry: false,
          durationMs: Date.now() - taskStartMs,
        }]);
      }
      throw taskErr;
    }

    const taskDurationMs = Date.now() - taskStartMs;
    const costInfo = extractCostFromOutput(taskOutput);
    effectiveCtx.taskStatusAccumulator?.taskCompletedWithResult(
      entry.key, taskDurationMs, truncatePayload(taskOutput), costInfo,
    );
    if (effectiveCtx.emitEvents) {
      await effectiveCtx.emitEvents([{
        type: "task_completed",
        taskName: entry.key,
        occurredAt: new Date().toISOString(),
        taskKind: kind,
        durationMs: taskDurationMs,
        costMicros: costInfo.costMicros,
        tokensUsed: costInfo.inputTokens + costInfo.outputTokens,
      }]);
    }

    if (kind === "call:agent" && taskOutput && typeof taskOutput === "object") {
      const agentResult = taskOutput as Record<string, unknown>;
      const meta: Record<string, unknown> = {};
      if (agentResult.agent_execution_id) meta.agent_execution_id = agentResult.agent_execution_id;
      if (agentResult.usage_summary && typeof agentResult.usage_summary === "object") {
        const usage = agentResult.usage_summary as Record<string, unknown>;
        if (usage.tool_call_count) meta.tool_call_count = usage.tool_call_count;
      }
      if (Object.keys(meta).length > 0) {
        effectiveCtx.taskStatusAccumulator?.setTaskMetadata(entry.key, meta);
      }
    }

    await processTaskOutput(entry, taskOutput, state, effectiveCtx);
    await processTaskExport(entry, taskOutput, state, effectiveCtx);

    const switchDirective = extractFlowDirective(taskOutput);
    if (switchDirective !== undefined) {
      if (isTermination(switchDirective)) break;
      if (isExplicitTarget(switchDirective)) {
        nextTargetName = switchDirective;
        continue;
      }
    }

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
  if (inputFrom === undefined) return state.output !== undefined ? state.output : parentInput;

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
 * Strips the internal `__flow_directive__` key from task output before
 * storing it in state. The directive is a routing instruction consumed
 * by the executor loop — it should not leak into workflow state data.
 */
function stripFlowDirective(output: unknown): unknown {
  if (
    output !== null &&
    typeof output === "object" &&
    "__flow_directive__" in (output as Record<string, unknown>)
  ) {
    const { __flow_directive__: _, ...rest } = output as Record<string, unknown>;
    return Object.keys(rest).length > 0 ? rest : undefined;
  }
  return output;
}

/**
 * Processes a task's `output.as` transform. If defined, evaluates
 * the expression against the task output and updates state.output.
 * If not defined, state.output is set to the raw task output.
 *
 * The `__flow_directive__` key is stripped before storing — it is an
 * internal routing mechanism, not user-visible data.
 */
async function processTaskOutput(
  entry: TaskEntry,
  taskOutput: unknown,
  state: WorkflowState,
  ctx: TaskExecutionContext,
): Promise<void> {
  const cleanOutput = stripFlowDirective(taskOutput);

  if (entry.task.output?.as === undefined) {
    state.output = cleanOutput;
    return;
  }

  const outputAs = entry.task.output.as;

  if (typeof outputAs === "string") {
    if (outputAs.startsWith("${ ") && outputAs.endsWith(" }")) {
      const stateVars = state.getAsMap();
      const results = await ctx.evaluateExpressions(
        { __output__: outputAs.slice(3, -2) },
        cleanOutput,
        stateVars,
      );
      state.output = results.__output__;
    } else {
      state.output = cleanOutput;
    }
  } else {
    state.output = cleanOutput;
  }
}

/**
 * Processes a task's `export.as` transform. If defined, evaluates
 * the expression against the task output and merges the result
 * into state.context keyed by task name.
 *
 * Like processTaskOutput, the `__flow_directive__` key is stripped.
 */
async function processTaskExport(
  entry: TaskEntry,
  taskOutput: unknown,
  state: WorkflowState,
  ctx: TaskExecutionContext,
): Promise<void> {
  if (entry.task.export?.as === undefined) return;

  const cleanOutput = stripFlowDirective(taskOutput);
  const exportAs = entry.task.export.as;
  let exportValue: unknown;

  if (typeof exportAs === "string") {
    if (exportAs.startsWith("${ ") && exportAs.endsWith(" }")) {
      const stateVars = state.getAsMap();
      const results = await ctx.evaluateExpressions(
        { __export__: exportAs.slice(3, -2) },
        cleanOutput,
        stateVars,
      );
      exportValue = results.__export__;
    } else {
      exportValue = cleanOutput;
    }
  } else {
    exportValue = cleanOutput;
  }

  if (state.context === null) {
    state.context = {};
  }

  const contextMap = state.context as Record<string, unknown>;
  contextMap[entry.key] = exportValue;
  state.context = contextMap;
}
