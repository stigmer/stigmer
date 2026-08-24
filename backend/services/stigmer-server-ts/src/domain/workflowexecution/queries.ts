/**
 * Shared full-scan load for the workflowexecution read surfaces (list,
 * listByWorkflow, getExecutionSummary, listPendingApprovals) — Go's
 * store.ListResources + proto.Unmarshal-continue loop, where malformed
 * rows are skipped rather than failing the read.
 */
import { fromBinary } from "@bufbuild/protobuf";

import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { internalError } from "../../pipeline/errors.js";
import type { Store } from "../../store/interface.js";

/**
 * Loads every workflow execution. The Internal message varies by caller in
 * Go (each handler wraps the same store error with its own text), so the
 * caller supplies it.
 */
export async function loadAllWorkflowExecutions(
  store: Store,
  logger: Logger,
  internalMessage: string,
): Promise<WorkflowExecution[]> {
  let rows: Uint8Array[];
  try {
    rows = await store.listResources(ApiResourceKind.workflow_execution);
  } catch (error) {
    throw internalError(error, internalMessage);
  }

  const executions: WorkflowExecution[] = [];
  for (const data of rows) {
    let execution: WorkflowExecution;
    try {
      execution = fromBinary(WorkflowExecutionSchema, data);
    } catch (error) {
      logger.warn("Failed to unmarshal workflow execution, skipping", {
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    executions.push(execution);
  }
  return executions;
}
