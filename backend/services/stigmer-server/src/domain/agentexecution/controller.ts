/**
 * AgentExecution controller — ports pkg/domain/agentexecution/controller
 * (command + query sides): the deepest domain's request surface. One Go
 * controller implements both services; this module mirrors that with one
 * deps object and one registration function.
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character.
 * Proven by agentexecution.conformance.test.ts
 * (CONFORMANCE_TARGET=local) and __tests__/.
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
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import type { ResolvedGateSteps } from "../../extensions/gate-slots.js";
import { stepsForSlot } from "../../extensions/gate-slots.js";
import type {
  AgentExecutionResponseDecorator,
  AgentExecutionStatusObserver,
} from "../../extensions/status-hooks.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { internalError } from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
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
import {
  newCleanupIamPoliciesStep,
  newCreateAuthorizationTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { Store } from "../../store/interface.js";

import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import type { ModelCatalogProvider } from "../workflow/registry/model-catalog-provider.js";

import {
  getArtifactContent,
  getArtifactDownloadUrl,
  uploadAttachment,
} from "./artifacts.js";
import type {
  AgentLoaderProvider,
  ExecutionAgentInstanceCreatorProvider,
  SessionCreatorProvider,
} from "./create-steps.js";
import {
  newComposeDeclaredPreferencesStep,
  newComposeRecalledMemoriesStep,
  newCreateDefaultInstanceIfNeededStep,
  newCreateSessionIfNeededStep,
  newEnsureSessionOrAgentResolvedStep,
  newProcessAttachmentsStep,
  newResolveDefaultAgentStep,
  newSetInitialPhaseStep,
  newStartWorkflowStep,
} from "./create-steps.js";
import type { SandboxLane } from "../../sandbox/lane.js";
import { newEnsureSessionSandboxStep } from "../../sandbox/steps.js";
import type { ExecutionContextBuilderDeps } from "./create-execution-context-step.js";
import { newCreateExecutionContextStep } from "./create-execution-context-step.js";
import type { AgentExecutionTemporalConfig } from "./temporal/config.js";
import type { ExecutionEngineStateProvider } from "./engine.js";
import { newEnsureEngineAvailableStep } from "./engine.js";
import {
  cancelExecution,
  pauseExecution,
  recoverExecution,
  resumeExecution,
  terminateExecution,
} from "./lifecycle.js";
import { agentExecutionSearchExtractor } from "./search-extractor.js";
import type { StreamBroker } from "./stream-broker.js";
import { submitApproval } from "./submit-approval.js";
import { submitFileDecision } from "./submit-file-decision.js";
import { subscribeExecution } from "./subscribe.js";
import { updateStatus } from "./update-status.js";
import { newValidateServiceTierStep } from "./validate-service-tier.js";
import { newValidateThinkingModeStep } from "./validate-thinking-mode.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
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
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op (C2). */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /**
   * The shared broadcast fabric for subscribe streams. ONE instance spans
   * both routers (serving + in-process) — see stream-broker.ts; the
   * composition root owns it (Go: NewStreamBroker in the controller
   * constructor + GetStreamBroker for the Temporal activities).
   */
  readonly broker: StreamBroker;
  /**
   * The execution-engine seam (engine.ts): permanently disconnected until
   * #18's TemporalManager flips it. Consumed by the engine gate, the
   * lifecycle RPCs, the create/recover workflow starts, and the two HITL
   * signal steps.
   */
  readonly engineState: ExecutionEngineStateProvider;
  /**
   * The bundled+refreshed model registry (the composition root's single
   * instance, DD-004) — the #357/#772 tier and thinking-mode validators
   * read it at create.
   */
  readonly modelRegistry: ModelCatalogProvider;
  /** The shared artifact blob store (attachments + artifact reads). */
  readonly artifactStorage: ArtifactStorage;
  /**
   * The in-process edges the create pipeline consumes (lazy providers —
   * the routes↔clients cycle resolves at request time, DD-002).
   */
  readonly agentLoader: AgentLoaderProvider;
  readonly agentInstanceCreator: ExecutionAgentInstanceCreatorProvider;
  readonly sessionCreator: SessionCreatorProvider;
  /** The shared EC-builder deps (create's step 16 + recover's recreate). */
  readonly executionContextBuilder: ExecutionContextBuilderDeps;
  /**
   * The composed slot registrations (O4, blueprint 03 §3a) — this domain
   * splices the create, recover, and submit-approval slots.
   */
  readonly gateSteps: ResolvedGateSteps;
  /**
   * The composed status-transition hooks (O4, DD-006 §3) — consumed at
   * the five phase-transition persist sites (status-observers.ts).
   */
  readonly statusObservers: ReadonlyArray<AgentExecutionStatusObserver>;
  readonly responseDecorators: ReadonlyArray<AgentExecutionResponseDecorator>;
  /**
   * The sandbox lane (§6d, O6): disabled on the OSS default; the create
   * and recover chains ensure the session sandbox through it after their
   * workflow starts.
   */
  readonly sandboxLane: SandboxLane;
  /** Dispatch config — the sandbox ensure resolves target/queue through it. */
  readonly temporalConfig: AgentExecutionTemporalConfig;
}

/** Registers both agentexecution services on the router (routes stage). */
export function registerAgentExecutionServices(
  router: ConnectRouter,
  deps: AgentExecutionControllerDeps,
): void {
  const lifecycleDeps = {
    store: deps.store,
    logger: deps.logger,
    authorizer: deps.authorizer,
    broker: deps.broker,
    engineState: deps.engineState,
    executionContextBuilder: deps.executionContextBuilder,
    gateSteps: deps.gateSteps,
    statusObservers: deps.statusObservers,
    sandboxLane: deps.sandboxLane,
    temporalConfig: deps.temporalConfig,
  };
  const artifactDeps = {
    store: deps.store,
    logger: deps.logger,
    artifactStorage: deps.artifactStorage,
  };
  router.service(AgentExecutionCommandController, {
    create: (execution, ctx) => createExecution(deps, execution, ctx),
    update: (execution, ctx) => update(deps, execution, ctx),
    updateStatus: (input, ctx) =>
      updateStatus(deps, input, callerIdentityOf(ctx)),
    submitApproval: (input, ctx) =>
      submitApproval(deps, input, callerIdentityOf(ctx)),
    submitFileDecision: (input, ctx) =>
      submitFileDecision(deps, input, callerIdentityOf(ctx)),
    cancel: (input, ctx) =>
      cancelExecution(lifecycleDeps, input, callerIdentityOf(ctx)),
    terminate: (input, ctx) =>
      terminateExecution(lifecycleDeps, input, callerIdentityOf(ctx)),
    recover: (input, ctx) =>
      recoverExecution(lifecycleDeps, input, callerIdentityOf(ctx)),
    pause: (input, ctx) =>
      pauseExecution(lifecycleDeps, input, callerIdentityOf(ctx)),
    resume: (input, ctx) =>
      resumeExecution(lifecycleDeps, input, callerIdentityOf(ctx)),
    uploadAttachment: (req) => uploadAttachment(artifactDeps, req),
    delete: (id, ctx) => deleteExecution(deps, id, ctx),
  });
  router.service(AgentExecutionQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    list: (req, ctx) => list(deps, req, ctx),
    listBySession: (req, ctx) => listBySession(deps, req, ctx),
    subscribe: (id, ctx) => subscribeExecution(deps, id, ctx),
    getArtifactDownloadUrl: (req) => getArtifactDownloadUrl(artifactDeps, req),
    getArtifactContent: (req) => getArtifactContent(artifactDeps, req),
    getExecutionUsageReport: (req, ctx) =>
      getExecutionUsageReport(deps, req, callerIdentityOf(ctx)),
    getSessionUsageReport: (req, ctx) =>
      getSessionUsageReport(deps, req, callerIdentityOf(ctx)),
    getAgentUsageReport: (req, ctx) =>
      getAgentUsageReport(deps, req, callerIdentityOf(ctx)),
    getOrgUsageReport: (req, ctx) =>
      getOrgUsageReport(deps, req, callerIdentityOf(ctx)),
    getExecutionSummary: (req) => getExecutionSummary(deps, req),
  });
}

/**
 * Create — create.go buildCreatePipeline, step-for-step: validation
 * (proto → visibility → tier #357 → thinking #772) → target resolution
 * (default agent → invariant guard) → the standard build → the engine
 * gate (fail fast BEFORE the first side effect, so a down engine orphans
 * nothing) → the pre-side-effect gate slot (O4; empty in OSS) → the
 * side-effecting steps (default instance, session bootstrap,
 * preference/memory snapshots, initial phase, the ExecutionContext with
 * merged env, attachment validation) → Persist → IndexSearch →
 * StartWorkflow (after persist; a start failure marks the execution
 * FAILED, recoverable via Recover).
 */
async function createExecution(
  deps: AgentExecutionControllerDeps,
  execution: AgentExecution,
  ctx: HandlerContext,
): Promise<AgentExecution> {
  const reqCtx = new RequestContext(
    AgentExecutionSchema,
    execution,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  const builder = newPipeline<typeof AgentExecutionSchema>(
    "agent-execution-create",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentExecutionCommandController.method.create,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newValidateServiceTierStep(deps.modelRegistry))
    .addStep(newValidateThinkingModeStep(deps.modelRegistry))
    .addStep(newResolveDefaultAgentStep(deps.store, deps.logger))
    .addStep(newEnsureSessionOrAgentResolvedStep(deps.logger))
    .addStep(newResolveSlugStep())
    .addStep(newBuildNewStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newEnsureEngineAvailableStep(deps.engineState));
  // The ratified pre-side-effect gate slot (blueprint 03 §3a; O4): after
  // every pure validation/resolution step, before the first side-effecting
  // step — a refusal orphans nothing. Empty in OSS.
  for (const step of stepsForSlot<typeof AgentExecutionSchema>(
    deps.gateSteps,
    "agent-execution-create:pre-side-effect-gate",
  )) {
    builder.addStep(step);
  }
  await builder
    .addStep(
      newCreateDefaultInstanceIfNeededStep({
        store: deps.store,
        logger: deps.logger,
        agentLoader: deps.agentLoader,
        agentInstanceCreator: deps.agentInstanceCreator,
      }),
    )
    .addStep(
      newCreateSessionIfNeededStep({
        logger: deps.logger,
        sessionCreator: deps.sessionCreator,
      }),
    )
    .addStep(newComposeDeclaredPreferencesStep(deps.store, deps.logger))
    .addStep(newComposeRecalledMemoriesStep(deps.store, deps.logger))
    .addStep(newSetInitialPhaseStep())
    .addStep(newCreateExecutionContextStep(deps.executionContextBuilder))
    .addStep(newProcessAttachmentsStep(deps.logger))
    .addStep(newPersistStep(deps.store))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .addStep(
      newIndexSearchStep(
        deps.store,
        agentExecutionSearchExtractor,
        deps.logger,
      ),
    )
    .addStep(
      newStartWorkflowStep({
        store: deps.store,
        logger: deps.logger,
        engineState: deps.engineState,
        statusObservers: deps.statusObservers,
      }),
    )
    // The session-lane sandbox ensure (§6d, O6): after StartWorkflow,
    // NON-critical — a provisioning failure pre-stamps status.error and
    // never fails the create (sandbox/steps.ts carries the posture's
    // full rationale). Skips instantly when no provisioner is composed.
    .addStep(
      newEnsureSessionSandboxStep({
        store: deps.store,
        logger: deps.logger,
        lane: deps.sandboxLane,
        temporalConfig: deps.temporalConfig,
      }),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
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
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentExecutionSchema>(
    "agent-execution-update",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentExecutionCommandController.method.update,
        deps.authorizer,
      ),
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
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentExecutionCommandController.method.delete.input>(
    "agent-execution-delete",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentExecutionCommandController.method.delete,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, AgentExecutionSchema))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    )
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
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentExecutionQueryController.method.get.input>(
    "agent-execution-get",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentExecutionQueryController.method.get,
        deps.authorizer,
      ),
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
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof AgentExecutionQueryController.method.list.input>(
    "agent-execution-list",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentExecutionQueryController.method.list,
        deps.authorizer,
      ),
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
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<
    typeof AgentExecutionQueryController.method.listBySession.input
  >("agent-execution-list-by-session", deps.logger)
    .addStep(
      newAuthorizeStep(
        AgentExecutionQueryController.method.listBySession,
        deps.authorizer,
      ),
    )
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
