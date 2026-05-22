/**
 * Temporal activity that hydrates a workflow execution from slim IDs
 * into the fully materialized input the CNCF workflow engine expects.
 *
 * Bridges the gap between the Java/Go orchestrators (which pass slim
 * orchestration coordinates via {@link HydrateInput}) and the TS
 * workflow engine (which expects a parsed {@link ExecuteServerlessWorkflowInput}).
 *
 * Hydration chain:
 *   1. Fetch WorkflowExecution → extract trigger_message
 *   2. Resolve Workflow → extract pre-validated YAML from status
 *   3. Fetch ExecutionContext → flatten env data
 *   4. Parse YAML → WorkflowModel
 *   5. Assemble ExecuteServerlessWorkflowInput
 */

import { ApplicationFailure } from "@temporalio/activity";
import { StigmerClient } from "../client/stigmer-client.js";
import { loadWorkflowFromYaml } from "../workflow-engine/loader.js";
import { ValidationState } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import type { Config } from "../config.js";
import type { ExecuteServerlessWorkflowInput } from "../workflows/execute-serverless-workflow.js";

export interface HydrateInput {
  readonly execution_id: string;
  readonly workflow_instance_id: string;
  readonly workflow_id: string;
  readonly org_id: string;
}

export function createHydrateWorkflowActivities(config: Config) {
  const client = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
    tokenRef: config.stigmerTokenRef,
  });

  return {
    HydrateWorkflowExecution: (input: HydrateInput): Promise<ExecuteServerlessWorkflowInput> =>
      hydrateWorkflowExecution(input, client),
  };
}

/**
 * Core hydration logic — exported separately for unit testing with
 * a mock client (same pattern as discover-mcp-server.ts).
 */
export async function hydrateWorkflowExecution(
  input: HydrateInput,
  client: StigmerClient,
): Promise<ExecuteServerlessWorkflowInput> {
  const { execution_id, workflow_instance_id, workflow_id, org_id } = input;

  // 1. Fetch WorkflowExecution for trigger_message
  const workflowExecution = await fetchWorkflowExecution(client, execution_id);
  const triggerMessage = workflowExecution.spec?.triggerMessage ?? "";

  // 2. Resolve workflow ID — prefer direct workflow_id, fall back to instance lookup
  const resolvedWorkflowId = await resolveWorkflowId(
    client, workflow_id, workflow_instance_id,
  );

  // 3. Fetch Workflow and extract pre-validated YAML
  const yaml = await fetchAndValidateWorkflowYaml(client, resolvedWorkflowId);

  // 4. Parse YAML into WorkflowModel
  const model = parseWorkflowYaml(yaml, resolvedWorkflowId);

  // 5. Fetch ExecutionContext and flatten env
  const env = await fetchAndFlattenEnv(client, execution_id);

  // 6. Parse trigger_message as workflow_input
  const workflow_input = parseTriggerMessage(triggerMessage);

  return {
    model,
    workflow_input,
    env,
    metadata: {
      execution_id,
      workflow_id: resolvedWorkflowId,
      workflow_instance_id,
      org_id,
    },
  };
}

async function fetchWorkflowExecution(
  client: StigmerClient,
  executionId: string,
) {
  try {
    return await client.getWorkflowExecution(executionId);
  } catch (err: unknown) {
    const code = (err as { code?: number | string })?.code;
    if (code === 5 || code === "not_found" || code === "NOT_FOUND") {
      throw ApplicationFailure.nonRetryable(
        `WorkflowExecution '${executionId}' not found`,
        "WORKFLOW_EXECUTION_NOT_FOUND",
      );
    }
    throw err;
  }
}

async function resolveWorkflowId(
  client: StigmerClient,
  workflowId: string,
  workflowInstanceId: string,
): Promise<string> {
  if (workflowId) return workflowId;

  if (!workflowInstanceId) {
    throw ApplicationFailure.nonRetryable(
      "Neither workflow_id nor workflow_instance_id provided — cannot resolve workflow",
      "MISSING_WORKFLOW_REFERENCE",
    );
  }

  try {
    const instance = await client.getWorkflowInstance(workflowInstanceId);
    const resolved = instance.spec?.workflowId;
    if (!resolved) {
      throw ApplicationFailure.nonRetryable(
        `WorkflowInstance '${workflowInstanceId}' has no workflow_id in spec`,
        "INVALID_WORKFLOW_INSTANCE",
      );
    }
    return resolved;
  } catch (err: unknown) {
    if (err instanceof ApplicationFailure) throw err;
    const code = (err as { code?: number | string })?.code;
    if (code === 5 || code === "not_found" || code === "NOT_FOUND") {
      throw ApplicationFailure.nonRetryable(
        `WorkflowInstance '${workflowInstanceId}' not found`,
        "WORKFLOW_INSTANCE_NOT_FOUND",
      );
    }
    throw err;
  }
}

async function fetchAndValidateWorkflowYaml(
  client: StigmerClient,
  workflowId: string,
): Promise<string> {
  let workflow;
  try {
    workflow = await client.getWorkflow(workflowId);
  } catch (err: unknown) {
    const code = (err as { code?: number | string })?.code;
    if (code === 5 || code === "not_found" || code === "NOT_FOUND") {
      throw ApplicationFailure.nonRetryable(
        `Workflow '${workflowId}' not found`,
        "WORKFLOW_NOT_FOUND",
      );
    }
    throw err;
  }

  const validation = workflow.status?.serverlessWorkflowValidation;
  if (!validation) {
    throw ApplicationFailure.nonRetryable(
      `Workflow '${workflowId}' has no serverless_workflow_validation in status — ` +
      `the workflow may not have been validated yet`,
      "MISSING_VALIDATION",
    );
  }

  switch (validation.state) {
    case ValidationState.VALID:
      break;
    case ValidationState.PENDING:
      throw ApplicationFailure.retryable(
        `Workflow '${workflowId}' validation is still in progress — retrying`,
        "VALIDATION_PENDING",
      );
    case ValidationState.INVALID:
      throw ApplicationFailure.nonRetryable(
        `Workflow '${workflowId}' validation failed: ${validation.errors.join("; ")}`,
        "VALIDATION_INVALID",
      );
    case ValidationState.FAILED:
      throw ApplicationFailure.nonRetryable(
        `Workflow '${workflowId}' validation encountered a system error — ` +
        `retry validation or contact support`,
        "VALIDATION_FAILED",
      );
    default:
      throw ApplicationFailure.nonRetryable(
        `Workflow '${workflowId}' has unexpected validation state: ${validation.state}`,
        "VALIDATION_UNKNOWN_STATE",
      );
  }

  const yaml = validation.yaml;
  if (!yaml) {
    throw ApplicationFailure.nonRetryable(
      `Workflow '${workflowId}' has VALID validation state but empty YAML — ` +
      `the workflow status may not be fully populated (known OSS gap: ` +
      `PopulateServerlessValidation step is not implemented in the Go server)`,
      "YAML_EMPTY",
    );
  }

  return yaml;
}

function parseWorkflowYaml(yaml: string, workflowId: string) {
  try {
    return loadWorkflowFromYaml(yaml);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw ApplicationFailure.nonRetryable(
      `Failed to parse CNCF Serverless Workflow YAML for workflow '${workflowId}': ${message}`,
      "YAML_PARSE_ERROR",
    );
  }
}

async function fetchAndFlattenEnv(
  client: StigmerClient,
  executionId: string,
): Promise<Record<string, unknown>> {
  let execCtx;
  try {
    execCtx = await client.getExecutionContextByExecutionId(executionId);
  } catch (err: unknown) {
    // ConnectError uses numeric Code.NotFound (5); match the pattern
    // from execute-cursor/env-resolver.ts.
    const code = (err as { code?: number | string })?.code;
    if (code === 5 || code === "not_found" || code === "NOT_FOUND") {
      console.log(
        `[hydrate] No ExecutionContext found for execution ${executionId} — ` +
        `proceeding with empty environment`,
      );
      return {};
    }
    throw err;
  }

  const env: Record<string, unknown> = {};
  const data = execCtx.spec?.data;
  if (data) {
    for (const [key, execValue] of Object.entries(data)) {
      env[key] = execValue.value;
    }
  }

  console.log(
    `[hydrate] Resolved environment: env_count=${Object.keys(env).length}`,
  );

  return env;
}

function parseTriggerMessage(triggerMessage: string): unknown {
  if (!triggerMessage) return null;
  try {
    return JSON.parse(triggerMessage);
  } catch {
    return null;
  }
}
