/**
 * Temporal activity that hydrates a workflow execution from slim IDs
 * into the fully materialized input the CNCF workflow engine expects.
 *
 * Bridges the gap between the Java/Go orchestrators (which pass slim
 * orchestration coordinates via {@link HydrateInput}) and the TS
 * workflow engine (which expects a parsed {@link ExecuteServerlessWorkflowInput}).
 *
 * Hydration chain:
 *   1. Fetch WorkflowExecution → extract trigger_message and the pinned version
 *   2. Read the workflow's YAML at the version the run pinned (the live
 *      workflow only for a run saved before versioning, which pins none)
 *   3. Fetch ExecutionContext → flatten env data
 *   4. Parse YAML → WorkflowModel
 *   5. Assemble ExecuteServerlessWorkflowInput
 */

import { ApplicationFailure } from "@temporalio/activity";
import { StigmerClient } from "../client/stigmer-client.js";
import { loadWorkflowFromYaml } from "../workflow-engine/loader.js";
import { ValidationState } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import type { Config } from "../config.js";
import type { ExecuteServerlessWorkflowInput } from "../workflows/engine-core.js";

export interface HydrateInput {
  readonly execution_id: string;
  readonly workflow_id: string;
  readonly org_id: string;
}

export function createHydrateWorkflowActivities(config: Config) {
  const client = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    tokenRef: config.stigmerTokenRef,
    runnerTokenRef: config.stigmerRunnerTokenRef,
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
  const { execution_id, workflow_id, org_id } = input;
  if (!workflow_id) {
    throw ApplicationFailure.nonRetryable(
      `WorkflowExecution '${execution_id}' names no workflow — cannot resolve its workflow`,
      "MISSING_WORKFLOW_REFERENCE",
    );
  }

  // 1. Fetch WorkflowExecution for trigger_message and version hash
  const workflowExecution = await fetchWorkflowExecution(client, execution_id);
  const triggerMessage = workflowExecution.spec?.triggerMessage ?? "";
  const versionHash = workflowExecution.status?.workflowVersionHash;

  // 2. Fetch workflow YAML at the pinned version; the live workflow only when unpinned
  const yaml = await fetchWorkflowYaml(client, workflow_id, versionHash);

  // 3. Parse YAML into WorkflowModel
  const model = parseWorkflowYaml(yaml, workflow_id);

  // 4. Fetch ExecutionContext and flatten env
  const env = await fetchAndFlattenEnv(client, execution_id);

  // 5. Parse trigger_message as workflow_input
  const workflow_input = parseTriggerMessage(triggerMessage);

  return {
    model,
    workflow_input,
    env,
    metadata: {
      execution_id,
      workflow_id,
      org_id,
    },
  };
}

/** A gRPC NOT_FOUND in any of the shapes a ConnectError or a test double carries. */
function isNotFound(err: unknown): boolean {
  const code = (err as { code?: number | string })?.code;
  return code === 5 || code === "not_found" || code === "NOT_FOUND";
}

/** A version hash shortened for messages and logs: the first 12 hex characters. */
function truncateHash(hash: string): string {
  return hash.length > 12 ? hash.slice(0, 12) + "..." : hash;
}

async function fetchWorkflowExecution(
  client: StigmerClient,
  executionId: string,
) {
  try {
    return await client.getWorkflowExecution(executionId);
  } catch (err: unknown) {
    if (isNotFound(err)) {
      throw ApplicationFailure.nonRetryable(
        `WorkflowExecution '${executionId}' not found`,
        "WORKFLOW_EXECUTION_NOT_FOUND",
      );
    }
    throw err;
  }
}

/**
 * Fetches the CNCF YAML a run executes: the version it pinned at create.
 *
 * Only a run that pins no version (its workflow was saved before versioning)
 * reads the live workflow. A pinned run never does: a version the server
 * answers NOT_FOUND fails the run non-retryably, naming the version, and any
 * other error is rethrown for the activity's retry policy. Answering either
 * with the head would run steps the run did not start on.
 */
async function fetchWorkflowYaml(
  client: StigmerClient,
  workflowId: string,
  versionHash: string | undefined,
): Promise<string> {
  if (!versionHash) {
    return fetchAndValidateWorkflowYamlLive(client, workflowId);
  }

  let versionEntry;
  try {
    versionEntry = await client.getWorkflowVersion(workflowId, versionHash);
  } catch (err: unknown) {
    if (isNotFound(err)) {
      throw ApplicationFailure.nonRetryable(
        `Workflow '${workflowId}' version ${truncateHash(versionHash)} not found — ` +
        `the run is pinned to it and does not run another version`,
        "WORKFLOW_VERSION_NOT_FOUND",
      );
    }
    throw err;
  }

  if (!versionEntry.validatedYaml) {
    throw ApplicationFailure.nonRetryable(
      `Workflow '${workflowId}' version ${truncateHash(versionHash)} has no validated YAML`,
      "WORKFLOW_VERSION_YAML_EMPTY",
    );
  }
  console.log(
    `[hydrate] Resolved workflow YAML from pinned version: hash=${truncateHash(versionHash)}`,
  );
  return versionEntry.validatedYaml;
}

async function fetchAndValidateWorkflowYamlLive(
  client: StigmerClient,
  workflowId: string,
): Promise<string> {
  let workflow;
  try {
    workflow = await client.getWorkflow(workflowId);
  } catch (err: unknown) {
    if (isNotFound(err)) {
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
  // The runner acquires a token scoped to this workflow execution so the
  // server's decrypt gate binds the read: a desktop runner exchanges its
  // bootstrap credential (hard error on failure — the bootstrap
  // credential does not decrypt, so proceeding would hydrate redacted
  // placeholders), and an OSS runner asks the
  // credential-less best-effort exchange (oss#535 — the OSS server redacts
  // EC reads by default and mints execution-scoped tokens). No-op for cloud
  // sandbox runners, whose ambient credential is already scoped.
  const scopedToken = await client.acquireScopedRunnerToken({
    workflowExecutionId: executionId,
  });

  let execCtx;
  try {
    execCtx = await client.getExecutionContextByExecutionId(executionId, scopedToken);
  } catch (err: unknown) {
    // ConnectError uses numeric Code.NotFound (5); match the pattern
    // from shared/env-resolver.ts.
    if (isNotFound(err)) {
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
