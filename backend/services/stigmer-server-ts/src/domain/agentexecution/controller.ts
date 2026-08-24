/**
 * AgentExecution controller — ports pkg/domain/agentexecution/controller
 * (command + query sides): the deepest domain's request surface. One Go
 * controller implements both services; this module mirrors that with one
 * deps object and one registration function.
 *
 * Ported in phases within sub-project #17 (D4). This phase carries the
 * read/write surfaces without engine coupling: get/list/listBySession,
 * the update and delete pipelines, the four usage reports and the
 * dashboard summary. The create pipeline, updateStatus merge engine,
 * approval/file-review ledgers, subscribe stream, attachments, and
 * lifecycle RPCs land in the following phases of the same PR; ConnectRPC
 * answers Unimplemented for them until their phase.
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character.
 * Proven by agentexecution.conformance.test.ts
 * (CONFORMANCE_TARGET=local-ts) and __tests__/.
 *
 * Versus Stigmer Cloud, OSS excludes the Authorize, CreateIamPolicies,
 * Publish, PublishToRedis, and TransformResponse steps (no multi-tenant
 * auth, IAM/FGA, event publishing, or Redis here — subscribe streams ride
 * in-memory channels per ADR 011).
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import type {
  AgentExecutionId,
  AgentExecutionList,
  ListAgentExecutionsBySessionRequest,
  ListAgentExecutionsRequest,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";
import type { ApiResourceId } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { internalError } from "../../pipeline/errors.js";
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

import { agentExecutionSearchExtractor } from "./search-extractor.js";
import {
  EXECUTION_LIST_KEY,
  newApplyPhaseFilterStep,
  newBuildExecutionListResponseStep,
  newQueryAllExecutionsStep,
  newQueryExecutionsBySessionStep,
  newValidateListBySessionRequestStep,
  newValidateListRequestStep,
} from "./steps.js";
import {
  getAgentUsageReport,
  getExecutionSummary,
  getExecutionUsageReport,
  getOrgUsageReport,
  getSessionUsageReport,
} from "./usage.js";

export interface AgentExecutionControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
}

/** Registers both agentexecution services on the router (routes stage). */
export function registerAgentExecutionServices(
  router: ConnectRouter,
  deps: AgentExecutionControllerDeps,
): void {
  router.service(AgentExecutionCommandController, {
    update: (execution, ctx) => update(deps, execution, ctx),
    delete: (id, ctx) => deleteExecution(deps, id, ctx),
  });
  router.service(AgentExecutionQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    list: (req, ctx) => list(deps, req, ctx),
    listBySession: (req, ctx) => listBySession(deps, req, ctx),
    getExecutionUsageReport: (req) => getExecutionUsageReport(deps, req),
    getSessionUsageReport: (req) => getSessionUsageReport(deps, req),
    getAgentUsageReport: (req) => getAgentUsageReport(deps, req),
    getOrgUsageReport: (req) => getOrgUsageReport(deps, req),
    getExecutionSummary: (req) => getExecutionSummary(deps, req),
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
  deps: AgentExecutionControllerDeps,
  execution: AgentExecution,
  ctx: HandlerContext,
): Promise<AgentExecution> {
  const reqCtx = new RequestContext(
    AgentExecutionSchema,
    execution,
    kindOf(ctx),
  );
  await newPipeline<typeof AgentExecutionSchema>(
    "agent-execution-update",
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
        agentExecutionSearchExtractor,
        deps.logger,
      ),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Delete — delete.go buildDeletePipeline; returns the deleted execution
 * for the audit trail (gRPC convention).
 */
async function deleteExecution(
  deps: AgentExecutionControllerDeps,
  id: ApiResourceId,
  ctx: HandlerContext,
): Promise<AgentExecution> {
  const reqCtx = new RequestContext(
    AgentExecutionCommandController.method.delete.input,
    id,
    kindOf(ctx),
  );
  await newPipeline<typeof AgentExecutionCommandController.method.delete.input>(
    "agent-execution-delete",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, AgentExecutionSchema))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newDeleteSearchIndexStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted execution not found in context"),
      "deleted execution not found in context",
    );
  }
  return deleted as AgentExecution;
}

/** Get — get.go buildGetPipeline: ValidateProto → LoadTarget. */
async function get(
  deps: AgentExecutionControllerDeps,
  id: AgentExecutionId,
  ctx: HandlerContext,
): Promise<AgentExecution> {
  const reqCtx = new RequestContext(
    AgentExecutionQueryController.method.get.input,
    id,
    kindOf(ctx),
  );
  await newPipeline<typeof AgentExecutionQueryController.method.get.input>(
    "agent-execution-get",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, AgentExecutionSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as AgentExecution;
}

/**
 * List — list.go: full scan, optional phase filter, no sorting, no
 * pagination (total_pages placeholder 1); the request org field is a
 * deliberate no-op on this single-tenant edition.
 */
async function list(
  deps: AgentExecutionControllerDeps,
  req: ListAgentExecutionsRequest,
  ctx: HandlerContext,
): Promise<AgentExecutionList> {
  const reqCtx = new RequestContext(
    AgentExecutionQueryController.method.list.input,
    req,
    kindOf(ctx),
  );
  await newPipeline<typeof AgentExecutionQueryController.method.list.input>(
    "agent-execution-list",
    deps.logger,
  )
    .addStep(newValidateListRequestStep())
    .addStep(newQueryAllExecutionsStep(deps.store, deps.logger))
    .addStep(newApplyPhaseFilterStep(deps.logger))
    .addStep(newBuildExecutionListResponseStep())
    .build()
    .execute(reqCtx);
  return requireListResult(reqCtx.get(EXECUTION_LIST_KEY));
}

/** ListBySession — list_by_session.go: spec.session_id equality filter. */
async function listBySession(
  deps: AgentExecutionControllerDeps,
  req: ListAgentExecutionsBySessionRequest,
  ctx: HandlerContext,
): Promise<AgentExecutionList> {
  const reqCtx = new RequestContext(
    AgentExecutionQueryController.method.listBySession.input,
    req,
    kindOf(ctx),
  );
  await newPipeline<
    typeof AgentExecutionQueryController.method.listBySession.input
  >("agent-execution-list-by-session", deps.logger)
    .addStep(newValidateListBySessionRequestStep())
    .addStep(newQueryExecutionsBySessionStep(deps.store, deps.logger))
    .addStep(newBuildExecutionListResponseStep())
    .build()
    .execute(reqCtx);
  return requireListResult(reqCtx.get(EXECUTION_LIST_KEY));
}

function requireListResult(result: unknown): AgentExecutionList {
  if (result === undefined || Array.isArray(result)) {
    throw internalError(
      new Error("execution list not found in context"),
      "execution list not found in context",
    );
  }
  return result as AgentExecutionList;
}
