/**
 * DeleteExecutionContext activity seam — ports
 * pkg/domain/executioncontext/temporal/activities/delete_execution_context.go.
 *
 * The ExecutionContext is an ephemeral resource containing the
 * fully-merged environment (environment_refs values overridden by
 * runtime_env, filtered to the blueprint's declared env keys), including
 * secrets. It must be cleaned up when the execution finishes so sensitive
 * data does not persist beyond the execution lifetime.
 *
 * A SEAM, deliberately unregistered: this module has no Temporal SDK
 * dependency — it is the plain store-direct function the agent-execution
 * and workflow-execution workers (D4 #18/#21) will register as a local
 * activity under DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME, shared by both
 * workflows exactly as in Go.
 *
 * Behavior (Go parity):
 *   - Idempotent: no-op if the ExecutionContext does not exist.
 *   - Best-effort: logs failures but never throws — cleanup failure must
 *     not affect the workflow outcome. A failed delete leaves the row in
 *     place with its secret values still encrypted at rest (oss#535);
 *     nothing retries it later, so the WARN is the operator's signal.
 *   - Security-aware: logs the variable count, never names or values.
 */
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../../boot/logger.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";

/** The activity name for worker registration — Go's constant, byte-pinned. */
export const DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME = "DeleteExecutionContext";

/**
 * Finds and deletes the ExecutionContext for the given execution ID
 * (an AgentExecution or WorkflowExecution id — the lookup uses the
 * spec.executionId field).
 */
export async function deleteExecutionContextForExecution(
  store: Store,
  logger: Logger,
  executionId: string,
): Promise<void> {
  logger.debug("Cleaning up ExecutionContext for execution", { executionId });

  let ec: ExecutionContext;
  try {
    ec = await store.findByField(
      ApiResourceKind.execution_context,
      "spec.executionId",
      executionId,
      ExecutionContextSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      logger.debug(
        "No ExecutionContext found for execution -- nothing to clean up",
        { executionId },
      );
      return;
    }
    logger.warn(
      "Failed to query ExecutionContext -- leaving cleanup to the operator",
      {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return;
  }

  const contextId = ec.metadata?.id ?? "";
  const dataCount = Object.keys(ec.spec?.data ?? {}).length;

  try {
    await store.deleteResource(ApiResourceKind.execution_context, contextId);
  } catch (error) {
    logger.warn(
      "Failed to delete ExecutionContext -- leaving cleanup to the operator",
      {
        executionId,
        contextId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return;
  }

  logger.info("Deleted ExecutionContext for execution", {
    executionId,
    contextId,
    variables: dataCount,
  });
}
