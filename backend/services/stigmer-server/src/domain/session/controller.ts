/**
 * Session controller — ports pkg/domain/session/controller (command +
 * query sides): the runtime conversation thread that runs against an
 * AgentInstance. Create resolves the platform default agent instance when
 * none is provided (the session-first UX, via the in-process agentinstance
 * CREATE edge); update enforces the harness and execution-target
 * immutability sentinels and maintains the server-owned
 * harness_state_id_history; delete blocks while executions are active and
 * cascades the session's agent executions; updateSubject is a field-level
 * read-modify-write.
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character.
 * Proven by session.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * __tests__/session.test.ts.
 *
 * Versus Stigmer Cloud, OSS excludes the Authorize, CreateIamPolicies, and
 * Publish steps (no multi-tenant auth, IAM/FGA, or event publishing here)
 * and the FGA-authorized list filtering.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type {
  ListSessionsByAgentInstanceRequest,
  ListSessionsByChannelRequest,
  ListSessionsRequest,
  SessionId,
  SessionList,
  UpdateSessionSubjectRequest,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { create } from "@bufbuild/protobuf";

import type { Logger } from "../../boot/logger.js";
import type { AgentExecutionTemporalConfig } from "../agentexecution/temporal/config.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import {
  newBuildNewStateStep,
  setAuditFieldsForUpdate,
} from "../../pipeline/steps/defaults.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
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
  SHOULD_CREATE_KEY,
  newLoadForApplyStep,
} from "../../pipeline/steps/load-for-apply.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import { newNormalizeReferencesStep } from "../../pipeline/steps/references.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { sessionSearchExtractor } from "./search-extractor.js";
import {
  LIST_RESULT_KEY,
  newCascadeDeleteAgentExecutionsStep,
  newFilterByAgentInstanceStep,
  newFilterByChannelStep,
  newListAllSessionsStep,
  newRecordHarnessStateHistoryStep,
  newRejectDeleteWithActiveExecutionsStep,
  newResolveDefaultAgentInstanceStep,
  newValidateExecutionTargetImmutabilityStep,
  newValidateHarnessImmutabilityStep,
} from "./steps.js";
import type { AgentInstanceCreatorProvider } from "./steps.js";

export interface SessionControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /**
   * The agent-execution temporal config — the update pipeline's
   * execution-target immutability step resolves UNSPECIFIED through the
   * same deployment default dispatch uses (oss#397).
   */
  readonly temporalConfig: AgentExecutionTemporalConfig;
  /**
   * The agentinstance in-process CREATE edge — a lazy provider because the
   * routes↔clients definition cycle resolves at request time (the ratified
   * DI story, DD-002).
   */
  readonly agentInstanceCreator: AgentInstanceCreatorProvider;
}

/** Registers both session services on the router (routes stage). */
export function registerSessionServices(
  router: ConnectRouter,
  deps: SessionControllerDeps,
): void {
  router.service(SessionCommandController, {
    apply: (session, ctx) => apply(deps, session, ctx),
    create: (session, ctx) => createSession(deps, session, ctx),
    update: (session, ctx) => update(deps, session, ctx),
    updateSubject: (req) => updateSubject(deps, req),
    delete: (id, ctx) => deleteSession(deps, id, ctx),
  });
  router.service(SessionQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    list: (req, ctx) => list(deps, req, ctx),
    listByAgentInstance: (req, ctx) => listByAgentInstance(deps, req, ctx),
    listByChannel: (req, ctx) => listByChannel(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — chain per Go buildCreatePipeline. ResolveDefaultAgentInstance
 * runs BEFORE ValidateProto: when agent_instance_id is omitted, the
 * resolution fills it in before validation sees the spec.
 */
async function createSession(
  deps: SessionControllerDeps,
  session: Session,
  ctx: HandlerContext,
): Promise<Session> {
  const reqCtx = new RequestContext(SessionSchema, session, kindOf(ctx));
  await newPipeline<typeof SessionSchema>("session-create", deps.logger)
    .addStep(
      newResolveDefaultAgentInstanceStep(
        deps.store,
        deps.agentInstanceCreator,
        deps.logger,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newPersistStep(deps.store))
    .addStep(
      newIndexSearchStep(deps.store, sessionSearchExtractor, deps.logger),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Update — chain per Go buildUpdatePipeline: the immutability sentinels
 * run after LoadExisting, the server-owned history append after
 * BuildUpdateState (it mutates the merged state).
 */
async function update(
  deps: SessionControllerDeps,
  session: Session,
  ctx: HandlerContext,
): Promise<Session> {
  const reqCtx = new RequestContext(SessionSchema, session, kindOf(ctx));
  await newPipeline<typeof SessionSchema>("session-update", deps.logger)
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newValidateHarnessImmutabilityStep())
    .addStep(newValidateExecutionTargetImmutabilityStep(deps.temporalConfig))
    .addStep(newBuildUpdateStateStep())
    .addStep(newRecordHarnessStateHistoryStep())
    .addStep(newPersistStep(deps.store))
    .addStep(
      newIndexSearchStep(deps.store, sessionSearchExtractor, deps.logger),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Apply — kubectl-style create-or-update: a minimal probe pipeline decides
 * existence, then delegates to Create or Update with the ORIGINAL request
 * message (Go delegates `session`, not the pipeline's mutated clone).
 */
async function apply(
  deps: SessionControllerDeps,
  session: Session,
  ctx: HandlerContext,
): Promise<Session> {
  const reqCtx = new RequestContext(SessionSchema, session, kindOf(ctx));
  await newPipeline<typeof SessionSchema>("session-apply", deps.logger)
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadForApplyStep(deps.store))
    .build()
    .execute(reqCtx);

  const shouldCreate = reqCtx.get(SHOULD_CREATE_KEY);
  if (typeof shouldCreate !== "boolean") {
    throw internalError(
      new Error("apply pipeline did not set shouldCreate flag"),
      "apply operation failed to determine create vs update",
    );
  }
  return shouldCreate
    ? createSession(deps, session, ctx)
    : update(deps, session, ctx);
}

/**
 * Delete — blocks while any execution in the session is active, then
 * cascades the session's agent executions before the session row
 * (children before parent, so a mid-failure retry converges). Returns the
 * deleted session (the audit-trail convention).
 */
async function deleteSession(
  deps: SessionControllerDeps,
  sessionId: SessionId,
  ctx: HandlerContext,
): Promise<Session> {
  const reqCtx = new RequestContext(
    SessionCommandController.method.delete.input,
    sessionId,
    kindOf(ctx),
  );
  await newPipeline<typeof SessionCommandController.method.delete.input>(
    "session-delete",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, SessionSchema))
    .addStep(newRejectDeleteWithActiveExecutionsStep(deps.store, deps.logger))
    .addStep(newCascadeDeleteAgentExecutionsStep(deps.store, deps.logger))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newDeleteSearchIndexStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted session not found in context"),
      "deleted session not found in context",
    );
  }
  return deleted as Session;
}

/**
 * UpdateSubject — update_subject.go: a field-level read-modify-write, NO
 * pipeline. The server loads the current session, modifies only the
 * subject field, stamps the SPEC audit slot (a definition change, unlike
 * the visibility RPCs' status slot), persists, and refreshes the search
 * index best-effort. Because the read-modify-write happens entirely on
 * the server, concurrent callers (e.g., GenerateSessionSubject and
 * sandbox_manager) cannot overwrite each other's unrelated fields.
 */
async function updateSubject(
  deps: SessionControllerDeps,
  req: UpdateSessionSubjectRequest,
): Promise<Session> {
  // Field validation is guaranteed at the transport boundary by the
  // protovalidate interceptor; this guard covers the direct-call path
  // (unit tests) with the same InvalidArgument contract.
  if (req.id === "") {
    throw invalidArgumentError("id is required");
  }

  const kind = ApiResourceKind.session;

  let session: Session;
  try {
    session = await deps.store.getResource(kind, req.id, SessionSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError("session", req.id);
    }
    throw internalError(error, "failed to load session");
  }

  if (session.spec === undefined) {
    session.spec = create(SessionSpecSchema, {});
  }
  session.spec.subject = req.subject;

  setAuditFieldsForUpdate(SessionSchema, session, "spec_audit");

  try {
    await deps.store.saveResource(kind, req.id, SessionSchema, session);
  } catch (error) {
    throw internalError(error, "failed to persist session");
  }

  await indexSessionSearch(deps, kind, session);

  return session;
}

/**
 * Refreshes the FTS5 search index for a session. Best-effort: logs on
 * failure but does not propagate (Go indexSessionSearch — an undefined
 * entry returns silently, without the shared step's warn).
 */
async function indexSessionSearch(
  deps: SessionControllerDeps,
  kind: ApiResourceKind,
  session: Session,
): Promise<void> {
  const entry = sessionSearchExtractor.getSearchIndexEntry(session);
  if (entry === undefined) {
    return;
  }
  try {
    await deps.store.upsertSearchIndex(kind, session.metadata?.id ?? "", entry);
  } catch (error) {
    deps.logger.warn(
      "UpdateSubject: failed to update search index (best-effort)",
      {
        id: session.metadata?.id ?? "",
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/** Get — LoadTarget by id (Go's chain has no ExtractResourceId here). */
async function get(
  deps: SessionControllerDeps,
  id: SessionId,
  ctx: HandlerContext,
): Promise<Session> {
  const reqCtx = new RequestContext(
    SessionQueryController.method.get.input,
    id,
    kindOf(ctx),
  );
  await newPipeline<typeof SessionQueryController.method.get.input>(
    "session-get",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, SessionSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Session;
}

/** List — all sessions, newest first. */
async function list(
  deps: SessionControllerDeps,
  req: ListSessionsRequest,
  ctx: HandlerContext,
): Promise<SessionList> {
  const reqCtx = new RequestContext(
    SessionQueryController.method.list.input,
    req,
    kindOf(ctx),
  );
  await newPipeline<typeof SessionQueryController.method.list.input>(
    "session-list",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newListAllSessionsStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);
  return requireListResult(reqCtx.get(LIST_RESULT_KEY));
}

/** ListByAgentInstance — spec.agent_instance_id equality filter. */
async function listByAgentInstance(
  deps: SessionControllerDeps,
  req: ListSessionsByAgentInstanceRequest,
  ctx: HandlerContext,
): Promise<SessionList> {
  const reqCtx = new RequestContext(
    SessionQueryController.method.listByAgentInstance.input,
    req,
    kindOf(ctx),
  );
  await newPipeline<
    typeof SessionQueryController.method.listByAgentInstance.input
  >("session-list-by-agent-instance", deps.logger)
    .addStep(newValidateProtoStep())
    .addStep(newFilterByAgentInstanceStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);
  return requireListResult(reqCtx.get(LIST_RESULT_KEY));
}

/** ListByChannel — stigmer.ai/channel-id label filter (contract parity). */
async function listByChannel(
  deps: SessionControllerDeps,
  req: ListSessionsByChannelRequest,
  ctx: HandlerContext,
): Promise<SessionList> {
  const reqCtx = new RequestContext(
    SessionQueryController.method.listByChannel.input,
    req,
    kindOf(ctx),
  );
  await newPipeline<typeof SessionQueryController.method.listByChannel.input>(
    "session-list-by-channel",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newFilterByChannelStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);
  return requireListResult(reqCtx.get(LIST_RESULT_KEY));
}

function requireListResult(result: unknown): SessionList {
  if (result === undefined) {
    throw internalError(
      new Error("session list not found in context"),
      "session list not found in context",
    );
  }
  return result as SessionList;
}
