/**
 * WorkflowExecution controller — ports pkg/domain/workflowexecution/
 * controller (command + query sides): the workflow-run record surface.
 * One Go controller implements both services; this module mirrors that
 * with one deps object and one registration function.
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character;
 * the list/summary/pending-approval reads are direct handlers, exactly as
 * Go writes them (no pipeline in list.go / list_by_workflow.go /
 * get_execution_summary.go / list_pending_approvals.go).
 *
 * Proven by workflowexecution.conformance.test.ts
 * (CONFORMANCE_TARGET=local-ts) and __tests__/.
 *
 * Versus Stigmer Cloud, OSS excludes the Authorize, Publish,
 * PublishToRedis, and TransformResponse steps (no multi-tenant auth,
 * event publishing, or Redis here — subscribe streams ride in-memory
 * channels per ADR 011).
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import { ExecutionSortField } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { WorkflowExecutionListSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import type {
  ListWorkflowExecutionsByWorkflowRequest,
  ListWorkflowExecutionsRequest,
  WorkflowExecutionId,
  WorkflowExecutionList,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { WorkflowExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/query_pb";
import type { ApiResourceId } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { create } from "@bufbuild/protobuf";

import type { Logger } from "../../boot/logger.js";
import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import {
  newDeleteSearchIndexStep,
  newIndexSearchStep,
} from "../../pipeline/steps/index-search.js";
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import { newNormalizeReferencesStep } from "../../pipeline/steps/references.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { Store } from "../../store/interface.js";

import type { WorkflowExecutionEngineStateProvider } from "./engine.js";
import {
  applyFilterCriteria,
  applyLegacyPhaseFilter,
  applySortField,
} from "./execution-filter.js";
import { getEventLog } from "./get-event-log.js";
import { getExecutionSummary } from "./get-execution-summary.js";
import { listPendingApprovals } from "./list-pending-approvals.js";
import { loadAllWorkflowExecutions } from "./queries.js";
import { workflowExecutionSearchExtractor } from "./search-extractor.js";
import type { StreamBroker } from "./stream-broker.js";
import { subscribeExecution } from "./subscribe.js";
import { subscribeEvents } from "./subscribe-events.js";
import { updateStatus } from "./update-status.js";

export interface WorkflowExecutionControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /**
   * The workflow-execution engine seam (engine.ts): permanently
   * disconnected until #21's TemporalManager flips it. Consumed by the
   * create gate, the lifecycle RPCs, sendSignal, and
   * submitWorkflowTaskApproval.
   */
  readonly engineState: WorkflowExecutionEngineStateProvider;
  /**
   * The shared broadcast fabric for subscribe streams. ONE instance spans
   * both routers (serving + in-process) — see stream-broker.ts; the
   * composition root owns it (Go: NewStreamBroker in the controller
   * constructor + GetStreamBroker for #21's Temporal activities).
   */
  readonly broker: StreamBroker;
}

/** Registers both workflowexecution services on the router (routes stage). */
export function registerWorkflowExecutionServices(
  router: ConnectRouter,
  deps: WorkflowExecutionControllerDeps,
): void {
  router.service(WorkflowExecutionCommandController, {
    update: (execution, ctx) => update(deps, execution, ctx),
    updateStatus: (input) => updateStatus(deps, input),
    delete: (id, ctx) => deleteExecution(deps, id, ctx),
  });
  router.service(WorkflowExecutionQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    list: (req) => list(deps, req),
    listByWorkflow: (req) => listByWorkflow(deps, req),
    subscribe: (req, ctx) => subscribeExecution(deps, req, ctx),
    getEventLog: (req) => getEventLog(deps, req),
    subscribeEvents: (req, ctx) => subscribeEvents(deps, req, ctx),
    getExecutionSummary: (req) => getExecutionSummary(deps, req),
    listPendingApprovals: (req) => listPendingApprovals(deps, req),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Update — update.go buildUpdatePipeline: USER-initiated spec updates
 * (status updates from the runner use UpdateStatus instead). Standard
 * chain; BuildUpdateState clears status per the shared pattern.
 */
async function update(
  deps: WorkflowExecutionControllerDeps,
  execution: WorkflowExecution,
  ctx: HandlerContext,
): Promise<WorkflowExecution> {
  const reqCtx = new RequestContext(
    WorkflowExecutionSchema,
    execution,
    kindOf(ctx),
  );
  await newPipeline<typeof WorkflowExecutionSchema>(
    "workflowexecution-update",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newBuildUpdateStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newPersistStep(deps.store))
    .addStep(
      newIndexSearchStep(
        deps.store,
        workflowExecutionSearchExtractor,
        deps.logger,
      ),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Delete — delete.go buildDeletePipeline; returns the deleted execution
 * for the audit trail (gRPC convention). Executions and audit rows of the
 * parent workflow are untouched — only this record and its search-index
 * row go.
 */
async function deleteExecution(
  deps: WorkflowExecutionControllerDeps,
  id: ApiResourceId,
  ctx: HandlerContext,
): Promise<WorkflowExecution> {
  const reqCtx = new RequestContext(
    WorkflowExecutionCommandController.method.delete.input,
    id,
    kindOf(ctx),
  );
  await newPipeline<
    typeof WorkflowExecutionCommandController.method.delete.input
  >("workflowexecution-delete", deps.logger)
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(
      newLoadExistingForDeleteStep(deps.store, WorkflowExecutionSchema),
    )
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newDeleteSearchIndexStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted workflow execution not found in context"),
      "deleted workflow execution not found in context",
    );
  }
  return deleted as WorkflowExecution;
}

/** Get — get.go buildGetPipeline: ValidateProto → LoadTarget. */
async function get(
  deps: WorkflowExecutionControllerDeps,
  id: WorkflowExecutionId,
  ctx: HandlerContext,
): Promise<WorkflowExecution> {
  const reqCtx = new RequestContext(
    WorkflowExecutionQueryController.method.get.input,
    id,
    kindOf(ctx),
  );
  await newPipeline<typeof WorkflowExecutionQueryController.method.get.input>(
    "workflowexecution-get",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, WorkflowExecutionSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as WorkflowExecution;
}

/**
 * List — list.go: full scan, the legacy top-level phase filter (only when
 * filter.phases is absent), structured filter criteria (T13), and the
 * sort default started_at descending. No pagination (total_pages
 * placeholder 1); the request `org` field is a deliberate no-op on this
 * single-tenant edition.
 */
async function list(
  deps: WorkflowExecutionControllerDeps,
  req: ListWorkflowExecutionsRequest,
): Promise<WorkflowExecutionList> {
  let executions = await loadAllWorkflowExecutions(
    deps.store,
    deps.logger,
    "failed to list workflow executions",
  );

  if (req.filter === undefined || req.filter.phases.length === 0) {
    executions = applyLegacyPhaseFilter(executions, req.phase);
  }
  executions = applyFilterCriteria(executions, req.filter);

  let sortField = req.sortField;
  let ascending = req.sortAscending;
  if (sortField === ExecutionSortField.UNSPECIFIED) {
    sortField = ExecutionSortField.STARTED_AT;
    ascending = false;
  }
  applySortField(executions, sortField, ascending);

  return create(WorkflowExecutionListSchema, {
    entries: executions,
    totalPages: 1,
  });
}

/**
 * ListByWorkflow — list_by_workflow.go: the request field accepts either
 * a Workflow ID or a WorkflowInstance ID, so both spec fields are
 * matched. Same filter/sort tail as list; no pagination.
 */
async function listByWorkflow(
  deps: WorkflowExecutionControllerDeps,
  req: ListWorkflowExecutionsByWorkflowRequest,
): Promise<WorkflowExecutionList> {
  if (req.workflowId === "") {
    throw invalidArgumentError("workflow_id is required");
  }

  const all = await loadAllWorkflowExecutions(
    deps.store,
    deps.logger,
    "failed to list workflow executions",
  );
  let executions = all.filter(
    (execution) =>
      execution.spec?.workflowInstanceId === req.workflowId ||
      execution.spec?.workflowId === req.workflowId,
  );

  executions = applyFilterCriteria(executions, req.filter);

  let sortField = req.sortField;
  let ascending = req.sortAscending;
  if (sortField === ExecutionSortField.UNSPECIFIED) {
    sortField = ExecutionSortField.STARTED_AT;
    ascending = false;
  }
  applySortField(executions, sortField, ascending);

  return create(WorkflowExecutionListSchema, {
    entries: executions,
    totalPages: 1,
  });
}
