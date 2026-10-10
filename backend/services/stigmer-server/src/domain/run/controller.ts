/**
 * Run controller — ports pkg/domain/agentexecution/controller
 * (command + query sides): the deepest domain's request surface. One Go
 * controller implements both services; this module mirrors that with one
 * deps object and one registration function.
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character.
 * Proven by run.conformance.test.ts
 * (CONFORMANCE_TARGET=local) and __tests__/.
 *
 * Every chain opens with Authorize, and create also asks the run gate's
 * two questions (AuthorizeRunTarget on the conversation, AuthorizeRunAgent
 * on the agent the turn runs); create and delete run the shared
 * tuple-lifecycle steps against the composed lifecycle. The direct
 * handlers — subscribe and the two artifact reads — evaluate their
 * annotation through authorizeDirect; uploadAttachment is authorized at
 * the create its storage key feeds. list, listBySession and
 * getRunSummary narrow through the composed list read scope.
 * Subscribe streams ride the in-memory stream broker; there is
 * no Redis. Per-RPC posture: docs/authorization-coverage.md §16.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";
import type { RunConfig } from "@stigmer/protos/ai/stigmer/agentic/run/v1/invocation_pb";
import type {
  RunId,
  RunList,
  ListRunsBySessionRequest,
  ListRunsRequest,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { RunQueryController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/query_pb";
import type { ApiResourceId } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import type { AccountsByCaller } from "../identityaccount/resolve.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import type { ResolvedGateSteps } from "../../extensions/gate-slots.js";
import type { RunLanes } from "../../extensions/run-lanes.js";
import type { VisitorClassifier } from "../../extensions/visitor-classifier.js";
import { stepsForSlot } from "../../extensions/gate-slots.js";
import type {
  RunResponseDecorator,
  RunStatusObserver,
} from "../../extensions/status-hooks.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { internalError } from "../../pipeline/errors.js";
import type { KeyedSerializer } from "../../pipeline/keyed-serializer.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { newAuthorizeRunTargetStep } from "../../pipeline/steps/authorize-run-target.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import type { RunScoreCascade } from "../score/cascade.js";
import { newCascadeDeleteScoresStep } from "../score/cascade.js";
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
import {
  newNormalizeReferencesStep,
  newValidateReferencesStep,
} from "../../pipeline/steps/references.js";
import {
  newCleanupIamPoliciesStep,
  newCreateAuthorizationTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newRefuseBoundElsewhereStep } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import { newRunTargetReachableStep } from "../../pipeline/steps/run-target-reachable.js";
import type { CredentialBinding } from "../../extensions/credential-binding.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { Store } from "../../store/interface.js";

import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import type { ModelCatalogProvider } from "../../modelcatalog/model-catalog-provider.js";

import {
  getArtifactContent,
  getArtifactDownloadUrl,
  uploadAttachment,
} from "./artifacts.js";
import type { SessionCreatorProvider } from "./create-steps.js";
import {
  newComposeDeclaredPreferencesStep,
  newRefuseVisitorAppendedPromptStep,
  newComposeRecalledMemoriesStep,
  newCreateSessionIfNeededStep,
  newProcessAttachmentsStep,
  newSetInitialPhaseStep,
  newStartWorkflowStep,
} from "./create-steps.js";
import type { SandboxLane } from "../../sandbox/lane.js";
import { newEnsureSessionSandboxStep } from "../../sandbox/steps.js";
import type { RunValuePlannerDeps } from "./plan-run-values-step.js";
import {
  newPlanRunValuesStep,
  newStampRunCredentialsStep,
} from "./plan-run-values-step.js";
import { newResolveRunAgentStep } from "./resolve-run-agent.js";
import { newRequireApprovalAuthorityStep } from "./approval-authority.js";
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
import {
  agentExecutionRunAgent,
  agentExecutionRunTarget,
} from "./run-target.js";
import { agentExecutionSearchExtractor } from "./search-extractor.js";
import {
  newValidateSessionImmutabilityStep,
  newValidateSessionOrganizationStep,
} from "./session-binding.js";
import type { StreamBroker } from "./stream-broker.js";
import type { SessionEventBroker } from "../session/events/broker.js";
import { runCreateWriter, runRemover } from "../session/events/run-writes.js";
import { submitApproval } from "./submit-approval.js";
import { submitFileDecision } from "./submit-file-decision.js";
import { subscribeExecution } from "./subscribe.js";
import { updateStatus } from "./update-status.js";
import { newResolveRunConfigStep } from "./resolve-run-config.js";
import { newValidateServiceTierStep } from "./validate-service-tier.js";
import { newValidateThinkingModeStep } from "./validate-thinking-mode.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import {
  EXECUTION_LIST_KEY,
  newBuildExecutionListResponseStep,
  newQueryExecutionPageStep,
  newQueryExecutionsBySessionStep,
  newValidateListBySessionRequestStep,
  newValidateListRequestStep,
} from "./steps.js";
import {
  getAgentUsageReport,
  getRunSummary,
  getRunUsageReport,
  getOrgUsageReport,
  getSessionUsageReport,
} from "./usage.js";

export interface AgentExecutionControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The credential binding: a run's target must be readable from the run's organization (RunTargetReachable). */
  readonly credentialBinding: CredentialBinding;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composed summary read scope — undefined = the OSS full scan. */
  readonly listReadScope: ListReadScope | undefined;
  /**
   * The directory of the persons callers stand for (stigmer#1387) — the
   * composed identity-account port, bound under the require-authentication
   * posture; undefined = the single-operator posture (trusted-local),
   * where memory is the organization's switch alone and the subject the
   * empty-string sentinel.
   */
  readonly personAccounts: AccountsByCaller | undefined;
  /**
   * The composed visitor classifier (stigmer/stigmer#1401) —
   * ComposeDeclaredPreferences composes no organization standing context
   * onto a visitor's run; undefined = nobody is a visitor (open source).
   */
  readonly visitorClassifier: VisitorClassifier | undefined;
  /**
   * The composed run lanes (extensions/run-lanes.ts) — ResolveRunConfig
   * places an edition's visitors' turns on them; undefined = only the core
   * lanes (open source).
   */
  readonly runLanes: RunLanes | undefined;
  /**
   * The schedule lane's operator profile: the fire-time bounds every
   * scheduled turn is capped by (ScheduleTemporalConfig's execution
   * profile). Undefined = no schedule ceiling.
   */
  readonly scheduleRunProfile: RunConfig | undefined;
  /**
   * The shared broadcast fabric for subscribe streams. ONE instance spans
   * both routers (serving + in-process) — see stream-broker.ts; the
   * composition root owns it (Go: NewStreamBroker in the controller
   * constructor + GetStreamBroker for the Temporal activities).
   */
  readonly broker: StreamBroker;
  /**
   * The fan-out of each session's event log. Every run write that can
   * change whether a run is working appends its session's events in the
   * same transaction and publishes them here after the commit
   * (domain/session/events/run-writes.ts).
   */
  readonly sessionEventBroker: SessionEventBroker;
  /**
   * Recover's per-execution turn (pipeline/keyed-serializer.ts). ONE
   * instance spans both routers, as the broker does; the composition root
   * owns it, so a recover over either router waits for the other.
   */
  readonly recoverSerializer: KeyedSerializer;
  /**
   * The execution-engine seam (engine.ts): disconnected until the
   * TemporalManager flips it. Consumed by the engine gate, the
   * lifecycle RPCs, the create/recover workflow starts, and the two HITL
   * signal steps.
   */
  readonly engineState: ExecutionEngineStateProvider;
  /**
   * The bundled+refreshed model registry (the composition root's single
   * instance) — the #357/#772 tier and thinking-mode validators
   * read it at create.
   */
  readonly modelRegistry: ModelCatalogProvider;
  /** The shared artifact blob store (attachments + artifact reads). */
  readonly artifactStorage: ArtifactStorage;
  /**
   * The in-process edge the create pipeline consumes (a lazy provider —
   * the routes↔clients cycle resolves at request time).
   */
  readonly sessionCreator: SessionCreatorProvider;
  /** The shared value-planner deps (create's plan step + recover's re-plan). */
  readonly runValuePlanner: RunValuePlannerDeps;
  /**
   * The composed slot registrations — this domain
   * splices the create, recover, and submit-approval slots.
   */
  readonly gateSteps: ResolvedGateSteps;
  /**
   * The composed status-transition hooks — consumed at
   * the five phase-transition persist sites (status-observers.ts).
   */
  readonly statusObservers: ReadonlyArray<RunStatusObserver>;
  readonly responseDecorators: ReadonlyArray<RunResponseDecorator>;
  /** Removes a run's scores before its row (delete). */
  readonly runScores: RunScoreCascade;
  /**
   * The sandbox lane: disabled on the OSS default; the create
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
    recoverSerializer: deps.recoverSerializer,
    broker: deps.broker,
    sessionEventBroker: deps.sessionEventBroker,
    engineState: deps.engineState,
    runValuePlanner: deps.runValuePlanner,
    gateSteps: deps.gateSteps,
    statusObservers: deps.statusObservers,
    sandboxLane: deps.sandboxLane,
    temporalConfig: deps.temporalConfig,
    personAccounts: deps.personAccounts,
  };
  const artifactDeps = {
    store: deps.store,
    logger: deps.logger,
    artifactStorage: deps.artifactStorage,
    authorizer: deps.authorizer,
  };
  router.service(RunCommandController, {
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
  router.service(RunQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    list: (req, ctx) => list(deps, req, ctx),
    listBySession: (req, ctx) => listBySession(deps, req, ctx),
    subscribe: (id, ctx) => subscribeExecution(deps, id, ctx),
    getArtifactDownloadUrl: (req, ctx) =>
      getArtifactDownloadUrl(artifactDeps, req, callerIdentityOf(ctx)),
    getArtifactContent: (req, ctx) =>
      getArtifactContent(artifactDeps, req, callerIdentityOf(ctx)),
    getRunUsageReport: (req, ctx) =>
      getRunUsageReport(deps, req, callerIdentityOf(ctx)),
    getSessionUsageReport: (req, ctx) =>
      getSessionUsageReport(deps, req, callerIdentityOf(ctx)),
    getAgentUsageReport: (req, ctx) =>
      getAgentUsageReport(deps, req, callerIdentityOf(ctx)),
    getOrgUsageReport: (req, ctx) =>
      getOrgUsageReport(deps, req, callerIdentityOf(ctx)),
    getRunSummary: (req, ctx) =>
      getRunSummary(deps, req, callerIdentityOf(ctx)),
  });
}

/**
 * Create — create.go buildCreatePipeline: validation (proto → visibility)
 * → the run gate's first question (AuthorizeRunTarget: may the
 * caller add a turn to the session it names; a new conversation asks
 * nothing here, its session create asks can_create_session and the
 * agent's can_execute) → the session's organization (#1580,
 * session-binding.ts: a turn in a session belongs to that session's
 * organization, filled in when the request names none; the chain's one
 * read of the stored session, behind the run gate, so nothing about a
 * session is read or disclosed before the caller may add a turn to it,
 * #1280) → the standard build → the reserved-label guard → the reference
 * rule → ResolveRunAgent, which stamps the agent and version the turn runs
 * (the session's pin, or the new session's agent_ref) → the run gate's
 * second question (AuthorizeRunAgent: may the caller still run that
 * agent) → ResolveRunConfig (the settings the turn runs with, from the
 * turn, the agent version it runs and the lane's profile, and the lane's
 * approval mode; resolve-run-config.ts) → the tier (#357) and thinking-mode
 * (#772) validations of those resolved settings, on the engine the
 * conversation runs on → the engine gate (fail fast BEFORE the first side effect, so a
 * down engine orphans nothing) → the pre-side-effect gate slot (empty in
 * OSS) → the side-effecting steps (session bootstrap, which re-takes the
 * stamp from the session it creates; preference/memory snapshots; initial
 * phase; the source manifest of the run's values; attachment validation) →
 * Persist → IndexSearch → StartWorkflow (after persist; a start failure
 * marks the execution FAILED, recoverable via Recover).
 */
async function createExecution(
  deps: AgentExecutionControllerDeps,
  execution: Run,
  ctx: HandlerContext,
): Promise<Run> {
  const reqCtx = new RequestContext(
    RunSchema,
    execution,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  const builder = newPipeline<typeof RunSchema>(
    "agent-execution-create",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        RunCommandController.method.create,
        deps.authorizer,
      ),
    )
    .addStep(newRefuseBoundElsewhereStep())
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(
      newAuthorizeRunTargetStep(deps.authorizer, agentExecutionRunTarget),
    )
    .addStep(newRequireApprovalAuthorityStep(deps.authorizer))
    .addStep(newValidateSessionOrganizationStep(deps.store))
    .addStep(newResolveSlugStep())
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newNormalizeReferencesStep())
    .addStep(newValidateReferencesStep(deps.store, deps.authorizer))
    .addStep(newResolveRunAgentStep(deps.store, deps.logger, deps.authorizer))
    .addStep(
      newAuthorizeRunTargetStep(
        deps.authorizer,
        agentExecutionRunAgent,
        "AuthorizeRunAgent",
      ),
    )
    .addStep(
      newResolveRunConfigStep({
        store: deps.store,
        runLanes: deps.runLanes,
        scheduleProfile: deps.scheduleRunProfile,
      }),
    )
    .addStep(newValidateServiceTierStep(deps.modelRegistry))
    .addStep(newValidateThinkingModeStep(deps.modelRegistry))
    .addStep(
      newRefuseVisitorAppendedPromptStep(deps.logger, deps.visitorClassifier),
    )
    .addStep(
      newRunTargetReachableStep(deps.credentialBinding, agentExecutionRunAgent),
    )
    .addStep(newEnsureEngineAvailableStep(deps.engineState));
  // The pre-side-effect gate slot: after
  // every pure validation/resolution step, before the first side-effecting
  // step — a refusal orphans nothing. Empty in OSS.
  for (const step of stepsForSlot<typeof RunSchema>(
    deps.gateSteps,
    "agent-execution-create:pre-side-effect-gate",
  )) {
    builder.addStep(step);
  }
  await builder
    .addStep(
      newCreateSessionIfNeededStep({
        logger: deps.logger,
        sessionCreator: deps.sessionCreator,
        store: deps.store,
        modelRegistry: deps.modelRegistry,
      }),
    )
    .addStep(
      newComposeDeclaredPreferencesStep(
        deps.store,
        deps.logger,
        deps.personAccounts,
        deps.visitorClassifier,
      ),
    )
    .addStep(
      newComposeRecalledMemoriesStep(
        deps.store,
        deps.logger,
        deps.personAccounts,
      ),
    )
    .addStep(newSetInitialPhaseStep())
    .addStep(newStampRunCredentialsStep())
    .addStep(newPlanRunValuesStep(deps.runValuePlanner))
    .addStep(newProcessAttachmentsStep(deps.logger))
    // The run commits with its user message and, when it starts its
    // session's work, the session's running status.
    .addStep(newPersistStep(deps.store, runCreateWriter(deps)))
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
        sessionEventBroker: deps.sessionEventBroker,
      }),
    )
    // The session-lane sandbox ensure: after StartWorkflow,
    // NON-critical — a provisioning failure pre-stamps status.error and
    // never fails the create (sandbox/steps.ts carries the posture's
    // full rationale). Skips instantly when no provisioner is composed.
    .addStep(
      newEnsureSessionSandboxStep({
        store: deps.store,
        logger: deps.logger,
        lane: deps.sandboxLane,
        temporalConfig: deps.temporalConfig,
        accounts: deps.personAccounts,
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
 * chain; BuildUpdateState clears status per the shared pattern,
 * GuardReservedLabels refuses a `stigmer.ai/*` label the caller
 * introduces or changes (a run's schedule label names whose vaults a
 * person-less run uses), and ValidateSessionImmutability keeps the
 * execution in its session (session-binding.ts).
 */
async function update(
  deps: AgentExecutionControllerDeps,
  execution: Run,
  ctx: HandlerContext,
): Promise<Run> {
  const reqCtx = new RequestContext(
    RunSchema,
    execution,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof RunSchema>(
    "agent-execution-update",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        RunCommandController.method.update,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep({ update: true }))
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newBuildUpdateStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newValidateSessionImmutabilityStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newValidateReferencesStep(deps.store, deps.authorizer))
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
 * for the audit trail (gRPC convention). The run's scores go first,
 * through their own delete chain, while the run still links them to the
 * organization (domain/score/cascade.ts).
 */
async function deleteExecution(
  deps: AgentExecutionControllerDeps,
  id: ApiResourceId,
  ctx: HandlerContext,
): Promise<Run> {
  const reqCtx = new RequestContext(
    RunCommandController.method.delete.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof RunCommandController.method.delete.input>(
    "agent-execution-delete",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        RunCommandController.method.delete,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, RunSchema))
    .addStep(newCascadeDeleteScoresStep(deps.runScores))
    // The run's own events go with it, and a working run's removal ends
    // its session's turn when nothing else in the session works.
    .addStep(newDeleteResourceStep(deps.store, runRemover(deps)))
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
  return deleted as Run;
}

/** Get — get.go buildGetPipeline: ValidateProto → LoadTarget. */
async function get(
  deps: AgentExecutionControllerDeps,
  id: RunId,
  ctx: HandlerContext,
): Promise<Run> {
  const reqCtx = new RequestContext(
    RunQueryController.method.get.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof RunQueryController.method.get.input>(
    "agent-execution-get",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        RunQueryController.method.get,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, RunSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Run;
}

/**
 * List — list.go: one page of the request's org (or every org), newest
 * first, the optional phase filter and the read scope per batch
 * (steps.ts, QueryExecutionPage).
 */
async function list(
  deps: AgentExecutionControllerDeps,
  req: ListRunsRequest,
  ctx: HandlerContext,
): Promise<RunList> {
  const reqCtx = new RequestContext(
    RunQueryController.method.list.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof RunQueryController.method.list.input>(
    "agent-execution-list",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        RunQueryController.method.list,
        deps.authorizer,
      ),
    )
    .addStep(newValidateListRequestStep())
    .addStep(
      newQueryExecutionPageStep(deps.store, deps.logger, deps.listReadScope),
    )
    .addStep(newBuildExecutionListResponseStep())
    .build()
    .execute(reqCtx);
  return requireListResult(reqCtx.get(EXECUTION_LIST_KEY));
}

/** ListBySession — list_by_session.go: the session's executions, whole, newest first. */
async function listBySession(
  deps: AgentExecutionControllerDeps,
  req: ListRunsBySessionRequest,
  ctx: HandlerContext,
): Promise<RunList> {
  const reqCtx = new RequestContext(
    RunQueryController.method.listBySession.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<
    typeof RunQueryController.method.listBySession.input
  >("agent-execution-list-by-session", deps.logger)
    .addStep(
      newAuthorizeStep(
        RunQueryController.method.listBySession,
        deps.authorizer,
      ),
    )
    .addStep(newValidateListBySessionRequestStep())
    .addStep(
      newQueryExecutionsBySessionStep(
        deps.store,
        deps.logger,
        deps.listReadScope,
      ),
    )
    .addStep(newBuildExecutionListResponseStep())
    .build()
    .execute(reqCtx);
  return requireListResult(reqCtx.get(EXECUTION_LIST_KEY));
}

function requireListResult(result: unknown): RunList {
  if (result === undefined || Array.isArray(result)) {
    throw internalError(
      new Error("execution list not found in context"),
      "execution list not found in context",
    );
  }
  return result as RunList;
}
