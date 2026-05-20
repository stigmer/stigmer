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
 * The kernel modules (do-executor, state, types, tasks/*) are sandbox-safe
 * — they have zero Node.js dependencies. Only expression.ts (jq-wasm)
 * is excluded and accessed via the local activity proxy.
 *
 * Data pipeline: input.from → executeDoTasks → output.as
 *
 * SANDBOX RULES: This file runs inside the Temporal deterministic V8
 * isolate. No Node.js built-ins (crypto, fs, net), no non-deterministic
 * operations, no side-effecting imports. Only @temporalio/workflow APIs,
 * type-only imports, and pure JS/TS logic.
 */

import { proxyLocalActivities, log } from "@temporalio/workflow";

import type { createEvaluateExpressionsActivities } from "../activities/evaluate-expressions.js";
import { executeDoTasks } from "../workflow-engine/do-executor.js";
import { createState } from "../workflow-engine/state.js";
import type { ExpressionEvaluator, WorkflowModel } from "../workflow-engine/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Activity Proxy
// ─────────────────────────────────────────────────────────────────────────────

type EvalActivities = ReturnType<typeof createEvaluateExpressionsActivities>;

const evalProxy = proxyLocalActivities<EvalActivities>({
  startToCloseTimeout: "10s",
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
  const { model, workflow_input, env } = input;

  log.info("Starting serverless workflow execution", {
    workflowName: model.document.name,
    dsl: model.document.dsl,
  });

  const evaluateExpressions: ExpressionEvaluator = (exprs, jqInput, stateVars) =>
    evalProxy.EvaluateExpressions(exprs, jqInput, stateVars);

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
