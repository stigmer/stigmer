/**
 * Shared workflow engine core — runs CNCF Serverless Workflow DSL
 * tasks inside the Temporal deterministic sandbox.
 *
 * Extracted from execute-serverless-workflow.ts so that both the
 * direct workflow ("stigmer/workflow/execute") and the hydration
 * wrapper ("stigmer/workflow/execute-from-execution") can share the
 * engine without code duplication.
 *
 * SANDBOX RULES: This file runs inside the Temporal deterministic V8
 * isolate. No Node.js built-ins (crypto, fs, net), no non-deterministic
 * operations, no side-effecting imports. Only @temporalio/workflow APIs,
 * type-only imports, and pure JS/TS logic.
 */

import { proxyLocalActivities, proxyActivities, log, workflowInfo, sleep } from "@temporalio/workflow";
import { CancelledFailure } from "@temporalio/workflow";
import { recordExecutionStartMetric, recordExecutionEndMetric } from "./metrics-sink.js";

import type { createEvaluateExpressionsActivities } from "../activities/evaluate-expressions.js";
import type { createCallHttpActivities } from "../activities/call-http.js";
import type { createCallGrpcActivities } from "../activities/call-grpc.js";
import type { createCallFunctionActivities } from "../activities/call-function.js";
import type { createRunCommandActivities } from "../activities/run-command.js";
import type { createWorkflowEventActivities } from "../activities/workflow-event-activities.js";
import { orchestrateAgentCall } from "./call-agent-orchestrator.js";
import { orchestrateListenTask } from "./listen-orchestrator.js";
import { orchestrateRunWorkflow } from "./run-orchestrator.js";
import { orchestrateHumanInput } from "./human-input-orchestrator.js";
import { executeDoTasks } from "../workflow-engine/do-executor.js";
import { createState } from "../workflow-engine/state.js";
import type {
  ExpressionEvaluator,
  HttpCallConfig,
  GrpcCallConfig,
  CallFunctionMetadata,
  CallAgentMetadata,
  AgentCallConfig,
  ListenExecutionConfig,
  RunCommandConfig,
  RunWorkflowExecutionConfig,
  HumanInputExecutionConfig,
  TaskExecutionContext,
  WorkflowEventDescriptor,
} from "../workflow-engine/types.js";

import type { ExecuteServerlessWorkflowInput } from "./execute-serverless-workflow.js";

// ─────────────────────────────────────────────────────────────────────────────
// Activity Proxies (module-level singletons — shared across all workflow
// invocations within the same worker)
// ─────────────────────────────────────────────────────────────────────────────

type EvalActivities = ReturnType<typeof createEvaluateExpressionsActivities>;
type HttpActivities = ReturnType<typeof createCallHttpActivities>;
type GrpcActivities = ReturnType<typeof createCallGrpcActivities>;
type FunctionActivities = ReturnType<typeof createCallFunctionActivities>;
type RunActivities = ReturnType<typeof createRunCommandActivities>;
type EventActivities = ReturnType<typeof createWorkflowEventActivities>;

const evalProxy = proxyLocalActivities<EvalActivities>({
  startToCloseTimeout: "10s",
});

const callProxy = proxyActivities<HttpActivities & GrpcActivities & FunctionActivities>({
  startToCloseTimeout: "5m",
  heartbeatTimeout: "30s",
  retry: {
    maximumAttempts: 5,
    initialInterval: "1s",
    backoffCoefficient: 2,
    maximumInterval: "1m",
  },
});

const runProxy = proxyActivities<RunActivities>({
  startToCloseTimeout: "5m",
  heartbeatTimeout: "30s",
  retry: {
    maximumAttempts: 3,
    initialInterval: "1s",
    backoffCoefficient: 2,
    maximumInterval: "30s",
  },
});

const eventProxy = proxyLocalActivities<EventActivities>({
  startToCloseTimeout: "10s",
  retry: {
    maximumAttempts: 2,
    initialInterval: "500ms",
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Engine Core
// ─────────────────────────────────────────────────────────────────────────────

export interface RunWorkflowEngineOptions {
  readonly checkPause?: () => Promise<void>;
}

/**
 * Run the CNCF Serverless Workflow engine with a fully materialized input.
 *
 * Sets up activity proxies, builds the TaskExecutionContext, initializes
 * state with env and workflow_input, resolves input/output transforms,
 * executes all tasks via {@link executeDoTasks}, and returns the final
 * output.
 *
 * Called by both:
 * - `executeServerlessWorkflow` (direct invocation with pre-materialized input)
 * - `executeFromExecution` (wrapper that hydrates from slim IDs first)
 *
 * @param options.checkPause Optional pause yield point callback. When
 *   provided, the engine calls this between tasks and allows the
 *   workflow to block on a Temporal condition when paused.
 */
export async function runWorkflowEngine(
  input: ExecuteServerlessWorkflowInput,
  options?: RunWorkflowEngineOptions,
): Promise<unknown> {
  const { model, workflow_input, env, metadata } = input;
  const executionId = metadata?.execution_id ?? "";
  const executionStartMs = Date.now();

  log.info("Starting serverless workflow execution", {
    workflowName: model.document.name,
    dsl: model.document.dsl,
  });

  recordExecutionStartMetric(model.document.name);

  await eventProxy.ResetEventSequence();

  const emitEvents = async (events: WorkflowEventDescriptor[]): Promise<void> => {
    if (!executionId || events.length === 0) return;
    try {
      await eventProxy.EmitWorkflowEvents(executionId, events);
    } catch (err) {
      log.warn("Failed to emit workflow events (non-fatal)", {
        executionId,
        eventCount: events.length,
        error: String(err),
      });
    }
  };

  const nowIso = () => new Date().toISOString();

  await emitEvents([{
    type: "execution_started",
    occurredAt: nowIso(),
    totalTasks: model.do.length,
    workflowId: metadata?.workflow_id ?? "",
    workflowInstanceId: "",
  }]);

  const evaluateExpressions: ExpressionEvaluator = (exprs, jqInput, stateVars) =>
    evalProxy.EvaluateExpressions(exprs, jqInput, stateVars);

  const ctx: TaskExecutionContext = {
    evaluateExpressions,
    doc: model,
    checkPause: options?.checkPause,
    emitEvents,
    sleep: async (durationMs: number) => {
      try {
        await sleep(durationMs);
      } catch (err) {
        if (err instanceof CancelledFailure) return;
        throw err;
      }
    },
    listen: (config: ListenExecutionConfig) => orchestrateListenTask(config),
    runCommand: (config: RunCommandConfig) =>
      config.mode === "script"
        ? runProxy.RunScript(config)
        : runProxy.RunShell(config),
    runWorkflow: (config: RunWorkflowExecutionConfig) => orchestrateRunWorkflow(config),
    awaitHumanInput: (config: HumanInputExecutionConfig) => orchestrateHumanInput(config),
    callHttp: (config: HttpCallConfig, runtimeEnv: Record<string, unknown>) =>
      callProxy.CallHttp(config, runtimeEnv),
    callGrpc: (config: GrpcCallConfig, runtimeEnv: Record<string, unknown>) =>
      callProxy.CallGrpc(config, runtimeEnv),
    callFunction: (
      call: string,
      config: Record<string, unknown>,
      runtimeEnv: Record<string, unknown>,
      fnMeta: CallFunctionMetadata,
    ) =>
      callProxy.CallFunction(
        call,
        config,
        runtimeEnv,
        fnMeta.workflowExecutionId ?? executionId,
      ),
    callAgent: (
      config: AgentCallConfig,
      runtimeEnv: Record<string, unknown>,
      agentMeta: CallAgentMetadata,
    ) =>
      orchestrateAgentCall({
        config,
        runtimeEnv,
        parentWorkflowId: agentMeta.parentWorkflowId || workflowInfo().workflowId,
        taskName: agentMeta.taskName,
        workflowExecutionId: agentMeta.workflowExecutionId || executionId,
      }),
  };

  const state = createState();
  state.env = {
    ...env,
    __stigmer_execution_id: executionId,
    __stigmer_org_id: metadata?.org_id ?? "",
    __stigmer_workflow_id: metadata?.workflow_id ?? "",
    __stigmer_activity_task_queue: workflowInfo().taskQueue,
  };
  state.input = workflow_input;

  let effectiveInput = workflow_input;
  if (model.input?.from !== undefined) {
    effectiveInput = await resolveInputFrom(
      model.input.from,
      workflow_input,
      state,
      evaluateExpressions,
    );
    state.input = effectiveInput;
  }

  try {
    await executeDoTasks(
      model.do,
      effectiveInput,
      state,
      model,
      evaluateExpressions,
      ctx,
    );

    if (model.output?.as !== undefined) {
      state.output = await resolveOutputAs(
        model.output.as,
        state,
        evaluateExpressions,
      );
    }

    const durationMs = Date.now() - executionStartMs;
    recordExecutionEndMetric(model.document.name, true, durationMs);

    await emitEvents([{
      type: "execution_completed",
      occurredAt: nowIso(),
      durationMs,
      totalCostMicros: 0,
      totalTokens: 0,
    }]);

    log.info("Serverless workflow execution completed", {
      workflowName: model.document.name,
      durationMs,
    });

    return state.output;
  } catch (err) {
    const durationMs = Date.now() - executionStartMs;
    recordExecutionEndMetric(model.document.name, false, durationMs);

    await emitEvents([{
      type: "execution_failed",
      occurredAt: nowIso(),
      error: err instanceof Error ? err.message : String(err),
      failedTaskName: "",
      durationMs,
    }]);

    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Input/Output Resolution Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function resolveInputFrom(
  from: string | Record<string, unknown>,
  workflowInput: unknown,
  state: import("../workflow-engine/types.js").WorkflowState,
  evaluateExpressions: ExpressionEvaluator,
): Promise<unknown> {
  if (typeof from === "string") {
    const rawExpr = from.startsWith("${ ") && from.endsWith(" }")
      ? from.slice(3, -2)
      : from;

    const stateVars = state.getAsMap();
    const results = await evaluateExpressions(
      { __input__: rawExpr },
      workflowInput,
      stateVars,
    );
    return results.__input__;
  }

  return from;
}

async function resolveOutputAs(
  as: string | Record<string, unknown>,
  state: import("../workflow-engine/types.js").WorkflowState,
  evaluateExpressions: ExpressionEvaluator,
): Promise<unknown> {
  if (typeof as === "string") {
    if (as.startsWith("${ ") && as.endsWith(" }")) {
      const stateVars = state.getAsMap();
      const results = await evaluateExpressions(
        { __output__: as.slice(3, -2) },
        state.output,
        stateVars,
      );
      return results.__output__;
    }
    return state.output;
  }

  return state.output;
}
