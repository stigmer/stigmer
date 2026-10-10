/**
 * The create pipeline's domain steps — ports create.go,
 * compose_declared_preferences_step.go, and
 * compose_recalled_memories_step.go. The chain itself is assembled in
 * controller.ts, mirroring Go buildCreatePipeline order exactly.
 *
 * An execution names its conversation one of two ways (an existing
 * session_id, or a new session_spec whose agent_ref names its agent) or
 * not at all: the empty target is the built-in assistant
 * (run/v1/spec.proto), for which CreateSessionIfNeeded creates
 * a session with no agent and the runner resolves an agent-less blueprint.
 * Nothing here resolves a stored default agent into that shape.
 */
import { create } from "@bufbuild/protobuf";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentVersionEntry } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import {
  DeclaredPreferencesSchema,
  RecalledMemoriesSchema,
  RecalledMemoryFactSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionSpec } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { clone } from "@bufbuild/protobuf";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { isFirstPartyHumanOperator } from "../../extensions/identity.js";
import type { VisitorClassifier } from "../../extensions/visitor-classifier.js";
import {
  failedPreconditionError,
  goWrappedStatusError,
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import { ConnectError } from "@connectrpc/connect";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { AccountsByCaller } from "../identityaccount/resolve.js";
import { accountForCaller } from "../identityaccount/resolve.js";
import { listSubjectMemories } from "../memory/queries.js";

import type { RunStatusObserver } from "../../extensions/status-hooks.js";

import type { ExecutionEngineStateProvider } from "./engine.js";
import { EngineDispatchError } from "./engine.js";
import { ENGINE_UNAVAILABLE_MESSAGE } from "./constants.js";
import { stampRunAgent } from "./resolve-run-agent.js";
import {
  reResolveRunConfig,
  unattendedPinRefusal,
} from "./resolve-run-config.js";
import { serviceTierRefusal } from "./validate-service-tier.js";
import { thinkingModeRefusal } from "./validate-thinking-mode.js";
import type { ModelCatalogProvider } from "../../modelcatalog/model-catalog-provider.js";
import { notifyStatusObservers } from "./status-observers.js";
import { newSessionSpecOf, sessionIdOf } from "./target.js";
import { unavailableError } from "../../pipeline/errors.js";
import { isPluginEvalRun } from "../plugin-eval/plugin-eval-run.js";
import { isJudgeRun } from "../score/judge/judge-run.js";

type CreateDesc = typeof RunSchema;

// Context key for inter-step communication — Go's key string, verbatim.
export const CREATED_SESSION_ID_KEY = "created_session_id";

/**
 * The sentinel subject written on auto-created sessions. The
 * GenerateSessionSubject activity replaces it with an LLM-generated
 * title; display paths filter it (PENDING_SUBJECT in the TS SDK,
 * ResolvedSubject in the Go CLI).
 */
export const AUTO_CREATED_SESSION_SUBJECT = "Auto-created session";

// ---------------------------------------------------------------------------
// The in-process edges the create pipeline consumes (lazy providers: the
// routes↔clients cycle resolves at request time).
// ---------------------------------------------------------------------------

export interface AgentLoader {
  get(agentId: string): Promise<Agent>;
  /** One version of the agent, with its full spec (AgentQueryController.getVersion). */
  getVersion(agentId: string, versionHash: string): Promise<AgentVersionEntry>;
}
export type AgentLoaderProvider = () => AgentLoader;

export interface SessionCreator {
  /** As the ORIGINAL caller: the session's owner is its user. */
  createAsCaller(session: Session, caller: CallerIdentity): Promise<Session>;
}
export type SessionCreatorProvider = () => SessionCreator;

// ---------------------------------------------------------------------------
// EnsureEngineAvailable lives in engine.ts; re-exported by the
// controller for chain assembly.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CreateSessionIfNeeded — create.go createSessionIfNeededStep.
// ---------------------------------------------------------------------------

/**
 * Builds the spec for an auto-created session (Go
 * buildAutoCreateSessionSpec): a caller-provided spec (the one-call
 * bootstrap, stigmer/stigmer#249) is CLONED and forwarded so the session
 * carries its agent, workspace_entries, harness, execution_target, MCP
 * servers, and skills from a single create call; the subject sentinel
 * fills an empty subject. No spec at all is the built-in assistant.
 */
export function buildAutoCreateSessionSpec(
  callerSpec: SessionSpec | undefined,
): SessionSpec {
  const spec =
    callerSpec !== undefined
      ? clone(SessionSpecSchema, callerSpec)
      : create(SessionSpecSchema);
  if (spec.subject === "") {
    spec.subject = AUTO_CREATED_SESSION_SUBJECT;
  }
  return spec;
}

/**
 * Auto-creates the session when session_id is absent: forwards the
 * caller's session_spec (its agent_ref included; none is the built-in
 * assistant), owns the session under the CALLER's org (never the agent's —
 * an agent the organization's parent shares with its children stays usable), points
 * the execution at the created id in place of the embedded spec (the
 * Session resource is the single source of truth; the persisted execution
 * never carries a second copy that could drift), and re-takes the turn's
 * agent stamp from the created session: the session's own chain resolved
 * and gated the same reference, so the turn records exactly the version
 * its conversation runs (resolve-run-agent.ts). When that pin, or the
 * engine the session took, differs from what ResolveRunConfig read (an
 * author saved a version between the two resolutions), the settings are
 * resolved again over the session's version and judged by the same checks
 * before the turn is persisted (resolve-run-config.ts). A refusal there
 * leaves the session it created, empty, as a refusal by any later create
 * step does (the context build, the attachments): the session is the turn's
 * first side effect, and only an author's save landing between the two
 * resolutions reaches this arm.
 */
export function newCreateSessionIfNeededStep(deps: {
  logger: Logger;
  sessionCreator: SessionCreatorProvider;
  store: Store;
  modelRegistry: ModelCatalogProvider;
}): PipelineStep<CreateDesc> {
  return {
    name: "CreateSessionIfNeeded",
    async execute(ctx) {
      const execution = ctx.newState;
      let sessionId = sessionIdOf(execution.spec);

      if (sessionId !== "") {
        deps.logger.debug(
          "Session ID already provided, skipping auto-creation",
          {
            sessionId,
          },
        );
        return;
      }

      const callerSpec = newSessionSpecOf(execution.spec);
      deps.logger.info("Session ID not provided, auto-creating session", {
        hasSessionSpec: callerSpec !== undefined,
      });

      // 1. Build the session request: the caller's org from the
      // execution metadata (not the agent's org).
      let orgId = execution.metadata?.org ?? "";
      if (orgId === "") {
        orgId = ctx.input.metadata?.org ?? "";
      }
      const sessionRequest = create(SessionSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Session",
        metadata: {
          // Auto-generated name (Go's session-%d millisecond stamp).
          name: `session-${Date.now()}`,
          org: orgId,
        },
        spec: buildAutoCreateSessionSpec(callerSpec),
      });

      // 2. Create via in-process gRPC (single source of truth). Go wraps
      // with %w — the inner code survives to the wire (a session_spec
      // failing session validation answers InvalidArgument, not
      // Internal); goWrappedStatusError mirrors the #852 wire shape.
      let createdSession: Session;
      try {
        createdSession = await deps
          .sessionCreator()
          .createAsCaller(sessionRequest, ctx.callerIdentity);
      } catch (error) {
        if (error instanceof ConnectError) {
          throw goWrappedStatusError("failed to create session", error);
        }
        throw new Error(
          `failed to create session: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      sessionId = createdSession.metadata?.id ?? "";
      deps.logger.info("Successfully auto-created session", { sessionId });

      // 3. Point the execution at the created session in place of the
      // embedded spec (single source of truth — see the step doc), and
      // record the agent version that session pinned.
      execution.spec ??= create(RunSpecSchema);
      execution.spec.target = { case: "sessionId", value: sessionId };
      stampRunAgent(execution, {
        agentId: createdSession.status?.agentId ?? "",
        versionHash: createdSession.status?.agentVersionHash ?? "",
      });
      const placement = await reResolveRunConfig(
        ctx,
        deps.store,
        execution,
        createdSession,
      );
      if (placement !== undefined) {
        const refusal = [
          serviceTierRefusal(deps.modelRegistry, placement),
          thinkingModeRefusal(deps.modelRegistry, placement),
        ].find((text) => text !== "");
        if (refusal !== undefined) {
          throw invalidArgumentError(refusal);
        }
        const pinRefusal = unattendedPinRefusal(placement);
        if (pinRefusal !== "") {
          throw failedPreconditionError(pinRefusal);
        }
      }

      // 4. Track the created session for observability.
      ctx.set(CREATED_SESSION_ID_KEY, sessionId);
    },
  };
}

// ---------------------------------------------------------------------------
// ComposeDeclaredPreferences — compose_declared_preferences_step.go.
// ---------------------------------------------------------------------------

/**
 * Snapshots the declared standing context onto the execution's status
 * (stigmer/stigmer#293). SERVER-OWNED: stamped unconditionally,
 * overwriting anything the caller supplied. Two independent halves:
 *
 *   - org_context, the organization's, for every run but a VISITOR's
 *     (stigmer/stigmer#1401). Its admins wrote it for the organization's
 *     own work, so the organization's own lanes keep it — a person, a
 *     schedule, the platform's pipelines — and
 *     a caller the composed classifier names a visitor (the hosted
 *     edition's shared-agent guests and channel senders) never gets it;
 *     the organization is not even read. Open source composes no
 *     classifier and has no visitors. Not first-party-only like the
 *     person's half: that would strip it from every schedule run, and
 *     from the single operator, whose only standing
 *     context this is.
 *   - user_context, the run's person's own (stigmer#1397), composed only
 *     where callers are persons (`personAccounts`, the
 *     require-authentication posture) and only for a first-party human
 *     operator (runPersonOf), as the Java step did. The single-operator
 *     posture composes org_context alone: its one operator's context is
 *     the organization's.
 *
 * BEST-EFFORT: an execution must never fail to start because its
 * optional preferences could not load — genuine failures log at ERROR
 * (quiet degradation of a should-work path must stay visible) and degrade
 * that half to empty; a classifier that throws withholds the org half,
 * logged the same way (extensions/visitor-classifier.ts, fail-closed).
 * Snapshot-at-create is the point: preferences are mutable, executions
 * are immutable audit records.
 */
export function newComposeDeclaredPreferencesStep(
  store: Store,
  logger: Logger,
  personAccounts?: AccountsByCaller,
  visitorClassifier?: VisitorClassifier,
): PipelineStep<CreateDesc> {
  return {
    name: "ComposeDeclaredPreferences",
    async execute(ctx) {
      const execution = ctx.newState;
      execution.status ??= create(RunStatusSchema);
      // Claim the server-owned field first, before any load can fail.
      const declared = create(DeclaredPreferencesSchema);
      execution.status.declaredPreferences = declared;

      // A judge run grades another run's conversation and nothing else:
      // no organization's or person's standing context reaches it
      // (domain/score/judge/judge-run.ts).
      if (isJudgeRun(execution)) {
        logger.debug("Judge run, composing no standing context");
        return;
      }
      // A plugin eval's try measures the plugin, not who started the eval:
      // nothing personal loads, as in Claude Code's evals
      // (domain/plugin-eval/plugin-eval-run.ts).
      if (isPluginEvalRun(execution)) {
        logger.debug("Plugin eval run, composing no standing context");
        return;
      }

      // Verbatim: the server stamps content only;
      // blank-is-absent is the runner's read-side convention.
      if (isVisitor(visitorClassifier, ctx.callerIdentity, logger)) {
        logger.debug(
          "Caller is a visitor, composing no organization standing context",
          { identityId: ctx.callerIdentity.identityId },
        );
      } else {
        declared.orgContext = await loadOrgStandingContext(
          store,
          logger,
          orgIdOf(ctx),
        );
      }

      if (personAccounts === undefined) {
        return;
      }
      const person = await runPersonOf(
        personAccounts,
        ctx.callerIdentity,
        logger,
        "Failed to load the run's person for declared preferences - degrading user context to none (best-effort contract)",
      );
      declared.userContext = person?.spec?.preferences?.standingContext ?? "";
    },
  };
}

/**
 * Whether the composed classifier names `caller` a visitor: absent, nobody
 * is; a throw is one, logged at ERROR (the point's fail-closed contract).
 */
function isVisitor(
  classifier: VisitorClassifier | undefined,
  caller: CallerIdentity,
  logger: Logger,
): boolean {
  if (classifier === undefined) {
    return false;
  }
  try {
    return classifier.isVisitor(caller);
  } catch (error) {
    logger.error(
      "Visitor classifier failed - composing no organization standing context (fail-closed contract)",
      {
        identityId: caller.identityId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return true;
  }
}

/** The org a create addresses: the execution's metadata, else the input's. */
function orgIdOf(ctx: RequestContext<CreateDesc>): string {
  const orgId = ctx.newState.metadata?.org ?? "";
  return orgId !== "" ? orgId : (ctx.input.metadata?.org ?? "");
}

/** The organization's standing context, best-effort ("" on every degrade). */
async function loadOrgStandingContext(
  store: Store,
  logger: Logger,
  orgId: string,
): Promise<string> {
  if (orgId === "") {
    logger.debug(
      "No org on execution metadata, composing no declared preferences",
    );
    return "";
  }

  let org: Organization;
  try {
    org = await store.getResource(
      ApiResourceKind.organization,
      orgId,
      OrganizationSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      logger.debug(
        "Org not found in store, composing no declared preferences",
        {
          orgId,
        },
      );
      return "";
    }
    logger.error(
      "Failed to load org for declared preferences - degrading to none (best-effort contract)",
      {
        orgId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return "";
  }
  return org.spec?.preferences?.standingContext ?? "";
}

/**
 * The person a run is created by, where callers are persons
 * (stigmer#1387): the account a first-party human operator stands for
 * (extensions/identity.ts states who that is, once). `undefined` for every
 * other lane — runner, schedule, channel, guest, machine, a PlatformClient
 * token, anything server-composed — for a caller no account stands for,
 * and, best-effort, on a store fault (logged at ERROR with the caller's
 * copy: the compose steps degrade, they never fail a create).
 */
async function runPersonOf(
  personAccounts: AccountsByCaller,
  caller: CallerIdentity,
  logger: Logger,
  faultMessage: string,
): Promise<IdentityAccount | undefined> {
  if (!isFirstPartyHumanOperator(caller)) {
    return undefined;
  }
  try {
    return await accountForCaller(personAccounts, caller);
  } catch (error) {
    logger.error(faultMessage, {
      identityId: caller.identityId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// ComposeRecalledMemories — compose_recalled_memories_step.go.
// ---------------------------------------------------------------------------

/**
 * Snapshots the subject's CONFIRMED memories onto the execution's status
 * (stigmer/stigmer#293) — the recall half of the
 * memory loop, sibling of ComposeDeclaredPreferences in every invariant:
 * server-owned (enabled=false stamped on every ineligible/degraded path),
 * best-effort (degrading to DISABLED, never enabled-with-zero-facts, so a
 * broken recall never falsely offers the remember tool); confirmed-only
 * (the consent gate is meaningless otherwise); no compose-time truncation
 * (the runner's retriever selects at prompt build, recorded on
 * status.recalled_memories_report). Facts order oldest-first on
 * created_at — identical prompt order in every posture.
 *
 * WHOSE memories follows the posture (stigmer#1387, the Java step's
 * gates in its order): where callers are persons (`personAccounts`) the
 * run must be created by a first-party human operator (runPersonOf), the
 * organization's memory_enabled must be on, then that person's own — and
 * the snapshot is that person's confirmed facts in the organization. The
 * single-operator posture gates on the org flag alone with the
 * empty-string subject sentinel. The Organization is loaded independently
 * of the preferences step: step independence over one saved read.
 */
export function newComposeRecalledMemoriesStep(
  store: Store,
  logger: Logger,
  personAccounts?: AccountsByCaller,
): PipelineStep<CreateDesc> {
  return {
    name: "ComposeRecalledMemories",
    async execute(ctx) {
      const execution = ctx.newState;
      execution.status ??= create(RunStatusSchema);
      // Claim the server-owned field first.
      const recalled = create(RecalledMemoriesSchema);
      execution.status.recalledMemories = recalled;

      // A judge run recalls nothing, so no memory reaches the grade and no
      // remember tool is offered to the judge.
      if (isJudgeRun(execution)) {
        logger.debug("Judge run, composing no recalled memories");
        return;
      }
      // Nor does a plugin eval's try: an organization's memory must not
      // move its score.
      if (isPluginEvalRun(execution)) {
        logger.debug("Plugin eval run, composing no recalled memories");
        return;
      }

      const orgId = orgIdOf(ctx);
      if (orgId === "") {
        logger.debug(
          "No org on execution metadata, composing no recalled memories",
        );
        return;
      }
      // Only a person's own run recalls (the Java gate order: the caller
      // first, before any read).
      if (
        personAccounts !== undefined &&
        !isFirstPartyHumanOperator(ctx.callerIdentity)
      ) {
        return;
      }

      let org: Organization;
      try {
        org = await store.getResource(
          ApiResourceKind.organization,
          orgId,
          OrganizationSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          logger.debug(
            "Org not found in store, composing no recalled memories",
            { orgId },
          );
          return;
        }
        logger.error(
          "Failed to load org for recalled memories - degrading to disabled (best-effort contract)",
          {
            orgId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return;
      }

      if (!(org.spec?.preferences?.memoryEnabled ?? false)) {
        // Default-off is the design — a disabled snapshot is normal
        // operation, not degradation; no log.
        return;
      }

      // The subject whose facts are recalled: the run's person, whose own
      // switch must be on too, or the single-operator sentinel.
      let subject = "";
      if (personAccounts !== undefined) {
        const person = await runPersonOf(
          personAccounts,
          ctx.callerIdentity,
          logger,
          "Failed to load the run's person for recalled memories - degrading to disabled (best-effort contract)",
        );
        if (person?.spec?.preferences?.memoryEnabled !== true) {
          // A person who has not opted in is normal operation, not
          // degradation; no log.
          return;
        }
        subject = person.metadata?.id ?? "";
      }

      let facts;
      try {
        facts = await loadConfirmedFacts(store, orgId, subject);
      } catch (error) {
        // Enabled stays false: a broken recall must not offer the
        // remember tool (the enabled bit doubles as the tool signal).
        logger.error(
          "Failed to load memories for recall - degrading to disabled (best-effort contract)",
          {
            orgId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return;
      }

      recalled.enabled = true;
      recalled.facts = facts;
      logger.debug("Composed recalled memories snapshot", {
        orgId,
        factCount: facts.length,
      });
    },
  };
}

/**
 * Reads `subject`'s confirmed records in the org through the memory list
 * index (domain/memory/queries.ts), oldest-first — the run's person's
 * account id, or the single-operator "" sentinel. Facts carry only
 * memory_id + content (the id is the transparency link back to the
 * addressable record). Undecodable rows are skipped — one bad record must
 * not take recall down.
 */
async function loadConfirmedFacts(
  store: Store,
  orgId: string,
  subject: string,
) {
  const memories = (await listSubjectMemories(store, orgId, subject)).filter(
    (memory) =>
      memory.status?.lifecycleState ===
      MemoryLifecycleState.lifecycle_state_confirmed,
  );

  // Oldest-first on created_at (seconds then nanos; untimestamped rows
  // first) — mirrors the cloud repo's ORDER BY created_at ASC.
  memories.sort((a, b) => {
    const ta = a.status?.audit?.specAudit?.createdAt;
    const tb = b.status?.audit?.specAudit?.createdAt;
    if (ta === undefined || tb === undefined) {
      // Nil-first, symmetrically (Go: `return tj != nil` sorts an
      // untimestamped row before a timestamped one from EITHER side).
      if (ta === tb) {
        return 0;
      }
      return ta === undefined ? -1 : 1;
    }
    if (ta.seconds !== tb.seconds) {
      return ta.seconds < tb.seconds ? -1 : 1;
    }
    return ta.nanos - tb.nanos;
  });

  return memories.map((memory) =>
    create(RecalledMemoryFactSchema, {
      memoryId: memory.metadata?.id ?? "",
      content: memory.spec?.content ?? "",
    }),
  );
}

// ---------------------------------------------------------------------------
// SetInitialPhase — create.go setInitialPhaseStep.
// ---------------------------------------------------------------------------

/**
 * Sets the execution phase to PENDING so the frontend can show a thinking
 * indicator immediately, before the agent worker begins processing.
 */
export function newSetInitialPhaseStep(): PipelineStep<CreateDesc> {
  return {
    name: "SetInitialPhase",
    execute(ctx) {
      const execution = ctx.newState;
      execution.status ??= create(RunStatusSchema);
      execution.status.phase = RunPhase.RUN_PENDING;
    },
  };
}

// ---------------------------------------------------------------------------
// ProcessAttachments — create.go processAttachmentsStep.
// ---------------------------------------------------------------------------

/**
 * Validates every attachment carries a storage_key — all attachments must
 * be pre-uploaded via the uploadAttachment RPC.
 */
export function newProcessAttachmentsStep(
  logger: Logger,
): PipelineStep<CreateDesc> {
  return {
    name: "ProcessAttachments",
    execute(ctx) {
      const attachments = ctx.newState.spec?.attachments ?? [];
      if (attachments.length === 0) {
        return;
      }
      for (const attachment of attachments) {
        if (attachment.storageKey === "") {
          logger.error(
            "Attachment missing storage_key - all attachments must be pre-uploaded via uploadAttachment RPC",
            { filename: attachment.filename },
          );
          throw invalidArgumentError(
            `attachment '${attachment.filename}' missing storage_key: all attachments must be pre-uploaded via uploadAttachment RPC`,
          );
        }
      }
      logger.info("All attachments validated successfully", {
        attachmentCount: attachments.length,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// StartWorkflow — create.go startWorkflowStep (behind the engine seam).
// ---------------------------------------------------------------------------

/**
 * Starts the Temporal workflow AFTER the execution is persisted. Engine
 * availability was guaranteed by the EnsureEngineAvailable gate, so a
 * failure here is a live/transient error: a dispatch-resolution failure
 * maps to FailedPrecondition (Go's ResolveActivityTaskQueue boundary);
 * any other start failure marks the execution FAILED and persists it
 * (whole-resource save is intentional and exempt from the atomic
 * UpdateStatus path: this is the creation path marking a brand-new
 * execution whose workflow never started — no approval gate has ever
 * existed, so there is no event stream to preserve and no concurrent
 * appender to lose a write to), then answers Internal.
 */
export function newStartWorkflowStep(deps: {
  store: Store;
  logger: Logger;
  engineState: ExecutionEngineStateProvider;
  /** The failure arm's PENDING→FAILED stamp is a notified transition. */
  statusObservers: ReadonlyArray<RunStatusObserver>;
}): PipelineStep<CreateDesc> {
  return {
    name: "StartWorkflow",
    async execute(ctx) {
      const execution = ctx.newState;
      const executionId = execution.metadata?.id ?? "";

      const engine = deps.engineState();
      if (!engine.connected) {
        // Unreachable behind the gate; kept as the loud belt-and-braces
        // arm the gate's contract promises (a reconnect flap between the
        // gate and this step surfaces as the same pinned refusal).
        throw unavailableError(ENGINE_UNAVAILABLE_MESSAGE);
      }

      try {
        await engine.engine.startInvokeWorkflow({
          executionId,
          sessionId: sessionIdOf(execution.spec),
          agentId: execution.status?.agentId ?? "",
          autoApproveAll: execution.spec?.autoApproveAll ?? false,
        });
      } catch (error) {
        if (error instanceof EngineDispatchError) {
          deps.logger.warn("Activity dispatch failed", {
            executionId,
            error: error.message,
          });
          throw failedPreconditionError(error.message);
        }

        deps.logger.error(
          "Failed to start Temporal workflow - marking execution as FAILED",
          {
            executionId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        execution.status ??= create(RunStatusSchema);
        const oldPhase = execution.status.phase;
        execution.status.phase = RunPhase.RUN_FAILED;
        execution.status.error = `Failed to start Temporal workflow: ${error instanceof Error ? error.message : String(error)}`;

        try {
          await deps.store.saveResource(
            ctx.apiResourceKind,
            executionId,
            RunSchema,
            execution as Run,
          );
        } catch (updateError) {
          throw internalError(
            updateError,
            "failed to start workflow and failed to update status",
          );
        }
        // Notify site 3 of 5 (status-observers.ts): the PENDING→FAILED stamp
        // is a persisted terminal transition — notified before the
        // refusal surfaces.
        await notifyStatusObservers(
          deps,
          execution as Run,
          oldPhase,
          RunPhase.RUN_FAILED,
        );
        throw internalError(error, "failed to start workflow");
      }

      deps.logger.info("Temporal workflow started successfully", {
        executionId,
      });
    },
  };
}
