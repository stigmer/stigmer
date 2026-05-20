/**
 * Temporal workflow for executing CNCF Serverless Workflow definitions.
 *
 * Workflow type: "stigmer/workflow/execute"
 *
 * This workflow runs the workflow engine kernel inside the Temporal
 * deterministic sandbox. Expression evaluation (jq-wasm) is delegated
 * to a local activity since jq-wasm requires Node.js built-ins blocked
 * in the sandbox.
 *
 * External call tasks (call:http, call:grpc, call:function) are
 * delegated to regular Temporal activities via proxyActivities.
 * The kernel accesses these through opaque callbacks on the
 * TaskExecutionContext — it never imports Temporal APIs directly.
 *
 * Data pipeline: input.from → executeDoTasks → output.as
 *
 * SANDBOX RULES: This file runs inside the Temporal deterministic V8
 * isolate. No Node.js built-ins (crypto, fs, net), no non-deterministic
 * operations, no side-effecting imports. Only @temporalio/workflow APIs,
 * type-only imports, and pure JS/TS logic.
 */

import { proxyLocalActivities, proxyActivities, log, workflowInfo, sleep } from "@temporalio/workflow";
import { CancelledFailure } from "@temporalio/workflow";

import type { createEvaluateExpressionsActivities } from "../activities/evaluate-expressions.js";
import type { createCallHttpActivities } from "../activities/call-http.js";
import type { createCallGrpcActivities } from "../activities/call-grpc.js";
import type { createCallFunctionActivities } from "../activities/call-function.js";
import type { createRunCommandActivities } from "../activities/run-command.js";
import { orchestrateAgentCall } from "./call-agent-orchestrator.js";
import { orchestrateListenTask } from "./listen-orchestrator.js";
import { orchestrateRunWorkflow } from "./run-orchestrator.js";
import { orchestrateHumanInput } from "./human-input-orchestrator.js";
import { executeDoTasks } from "../workflow-engine/do-executor.js";
import { createState } from "../workflow-engine/state.js";
import type {
  ExpressionEvaluator,
  WorkflowModel,
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
} from "../workflow-engine/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Activity Proxies
// ─────────────────────────────────────────────────────────────────────────────

type EvalActivities = ReturnType<typeof createEvaluateExpressionsActivities>;
type HttpActivities = ReturnType<typeof createCallHttpActivities>;
type GrpcActivities = ReturnType<typeof createCallGrpcActivities>;
type FunctionActivities = ReturnType<typeof createCallFunctionActivities>;
type RunActivities = ReturnType<typeof createRunCommandActivities>;

const evalProxy = proxyLocalActivities<EvalActivities>({
  startToCloseTimeout: "10s",
});

const callProxy = proxyActivities<HttpActivities & GrpcActivities & FunctionActivities>({
  startToCloseTimeout: "5m",
  retry: {
    maximumAttempts: 5,
    initialInterval: "1s",
    backoffCoefficient: 2,
    maximumInterval: "1m",
  },
});

const runProxy = proxyActivities<RunActivities>({
  startToCloseTimeout: "5m",
  retry: {
    maximumAttempts: 3,
    initialInterval: "1s",
    backoffCoefficient: 2,
    maximumInterval: "30s",
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Input/Output Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecuteServerlessWorkflowInput {
  model: WorkflowModel;
  workflow_input: unknown;
  env: Record<string, unknown>;
  metadata?: ExecutionMetadata;
}

export interface ExecutionMetadata {
  execution_id?: string;
  workflow_id?: string;
  workflow_instance_id?: string;
  org_id?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Function
// ─────────────────────────────────────────────────────────────────────────────

export async function executeServerlessWorkflow(
  input: ExecuteServerlessWorkflowInput,
): Promise<unknown> {
  const { model, workflow_input, env, metadata } = input;

  log.info("Starting serverless workflow execution", {
    workflowName: model.document.name,
    dsl: model.document.dsl,
  });

  const evaluateExpressions: ExpressionEvaluator = (exprs, jqInput, stateVars) =>
    evalProxy.EvaluateExpressions(exprs, jqInput, stateVars);

  const ctx: TaskExecutionContext = {
    evaluateExpressions,
    doc: model,
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
        fnMeta.workflowExecutionId ?? metadata?.execution_id ?? "",
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
        workflowExecutionId: agentMeta.workflowExecutionId || metadata?.execution_id || "",
      }),
  };

  const state = createState();
  state.env = env;
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

  log.info("Serverless workflow execution completed", {
    workflowName: model.document.name,
  });

  return state.output;
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
