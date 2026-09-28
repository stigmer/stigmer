/**
 * The create pipeline's domain steps — ports create.go,
 * compose_declared_preferences_step.go, and
 * compose_recalled_memories_step.go. The chain itself is assembled in
 * controller.ts, mirroring Go buildCreatePipeline order exactly.
 *
 * An execution names its target one of three ways (session_id, agent_id,
 * session_spec.agent_instance_id) or not at all: the all-empty shape is the
 * built-in assistant (agentexecution/v1/spec.proto), for which
 * CreateSessionIfNeeded creates a session with no agent and the runner
 * resolves an agent-less blueprint. Nothing here resolves a stored default
 * agent into that shape.
 */
import { create, fromBinary } from "@bufbuild/protobuf";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/status_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import {
  DeclaredPreferencesSchema,
  RecalledMemoriesSchema,
  RecalledMemoryFactSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";
import type { Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
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
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { notifyDefaultInstanceLinked } from "../../pipeline/steps/authorization-tuples.js";
import {
  failedPreconditionError,
  goWrappedStatusError,
  internalError,
  invalidArgumentError,
  notFoundError,
  rethrownStatusError,
} from "../../pipeline/errors.js";
import { ConnectError } from "@connectrpc/connect";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { buildDefaultInstanceRequest } from "../agentinstance/defaultinstance.js";
import type { AccountsByCaller } from "../identityaccount/resolve.js";
import { accountForCaller } from "../identityaccount/resolve.js";

import type { AgentExecutionStatusObserver } from "../../extensions/status-hooks.js";

import type { ExecutionEngineStateProvider } from "./engine.js";
import { EngineDispatchError } from "./engine.js";
import { ENGINE_UNAVAILABLE_MESSAGE } from "./constants.js";
import { notifyStatusObservers } from "./status-observers.js";
import { unavailableError } from "../../pipeline/errors.js";

type CreateDesc = typeof AgentExecutionSchema;

// Context keys for inter-step communication — Go's key strings, verbatim.
export const DEFAULT_INSTANCE_ID_KEY = "default_instance_id";
export const CREATED_SESSION_ID_KEY = "created_session_id";

/**
 * The sentinel subject written on auto-created sessions. The
 * GenerateSessionSubject activity replaces it with an LLM-generated
 * title; display paths filter it (PENDING_SUBJECT in the TS SDK,
 * ResolvedSubject in the Go CLI).
 */
export const AUTO_CREATED_SESSION_SUBJECT = "Auto-created session";

// ---------------------------------------------------------------------------
// The in-process edges the create pipeline consumes (lazy providers per
// the ratified DI story — the routes↔clients cycle resolves at request
// time, DD-002).
// ---------------------------------------------------------------------------

export interface AgentLoader {
  get(agentId: string): Promise<Agent>;
}
export type AgentLoaderProvider = () => AgentLoader;

export interface SessionCreator {
  /** As the ORIGINAL caller (ruling R5): the session's owner is its user. */
  createAsCaller(session: Session, caller: CallerIdentity): Promise<Session>;
}
export type SessionCreatorProvider = () => SessionCreator;

// ---------------------------------------------------------------------------
// EnsureEngineAvailable lives in engine.ts (Phase 1); re-exported by the
// controller for chain assembly.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CreateDefaultInstanceIfNeeded — create.go createDefaultInstanceIfNeededStep.
// ---------------------------------------------------------------------------

/**
 * The narrow agentinstance CREATE edge — as the ORIGINAL caller since C2
 * Stage 3 (ruling R5, the Java createAsCaller posture): real owner
 * attribution for the created instance under an enforcing Authorizer.
 */
export interface ExecutionAgentInstanceCreator {
  createAsCaller(
    instance: AgentInstance,
    caller: CallerIdentity,
  ): Promise<AgentInstance>;
}
export type ExecutionAgentInstanceCreatorProvider =
  () => ExecutionAgentInstanceCreator;

/**
 * Ensures the referenced agent has a default instance: skips when a
 * session or explicit session_spec instance names the target, and when no
 * agent is named at all (the built-in assistant: there is no agent whose
 * instance could be created); otherwise loads the agent via the in-process
 * client, creates the default instance when the status lacks one, saves
 * the agent status DIRECTLY to the store (matching Go/Java: repo save, not
 * the Update pipeline), and stores the instance id in the context for the
 * next step.
 */
export function newCreateDefaultInstanceIfNeededStep(deps: {
  store: Store;
  logger: Logger;
  agentLoader: AgentLoaderProvider;
  agentInstanceCreator: ExecutionAgentInstanceCreatorProvider;
  authorizationLifecycle?: ResourceAuthorizationLifecycle;
}): PipelineStep<CreateDesc> {
  return {
    name: "CreateDefaultInstanceIfNeeded",
    async execute(ctx) {
      const execution = ctx.newState;
      const sessionId = execution.spec?.sessionId ?? "";
      const agentId = execution.spec?.agentId ?? "";

      if (sessionId !== "") {
        deps.logger.debug(
          "Session ID already provided, skipping default instance check",
          { sessionId },
        );
        return;
      }
      // An explicit session_spec instance fully specifies the target — no
      // agent load or default-instance creation needed.
      const specInstanceId = execution.spec?.sessionSpec?.agentInstanceId ?? "";
      if (specInstanceId !== "") {
        deps.logger.debug(
          "session_spec carries an explicit agent instance, skipping default instance check",
          { agentInstanceId: specInstanceId },
        );
        return;
      }
      // No agent named: the built-in assistant runs in a session with no
      // instance, so there is nothing to load or create here.
      if (agentId === "") {
        deps.logger.debug(
          "No agent named, the built-in assistant runs; skipping default instance check",
        );
        return;
      }

      // 1. Load agent via in-process gRPC (single source of truth). Go
      // returns the client error AS-IS here (create.go: "already a gRPC
      // error from the client") — rethrownStatusError preserves that wire
      // shape while shedding the in-process response metadata a raw
      // rethrow would corrupt the outer trailers with.
      let agent: Agent;
      try {
        agent = await deps.agentLoader().get(agentId);
      } catch (error) {
        if (error instanceof ConnectError) {
          throw rethrownStatusError(error);
        }
        throw error;
      }

      const defaultInstanceId = agent.status?.defaultInstanceId ?? "";
      if (defaultInstanceId !== "") {
        deps.logger.debug("Agent already has default instance", {
          defaultInstanceId,
          agentId,
        });
        ctx.set(DEFAULT_INSTANCE_ID_KEY, defaultInstanceId);
        return;
      }

      // 2. Default instance missing — create it via the in-process edge
      // (system credentials = the process-global operator identity). The
      // request builder reads the agent's SLUG at its single source
      // (defaultinstance.ts, stigmer/stigmer#355).
      deps.logger.info("Agent missing default instance, creating one", {
        agentId,
      });
      const metadata = agent.metadata;
      if (metadata === undefined) {
        throw internalError(
          new Error(`agent ${agentId} has no metadata`),
          "internal server error",
        );
      }
      // Go create.go wraps the downstream error with %w and the pipeline's
      // errors.As branch keeps the inner CODE with the wrapped text on the
      // wire (the #852 leak, mirrored via goWrappedStatusError, exactly as
      // the agent domain's apply-default-instance arm). Unstatused
      // failures fall to the pipeline's Internal fallback.
      let createdId: string;
      try {
        const created = await deps
          .agentInstanceCreator()
          .createAsCaller(
            buildDefaultInstanceRequest(metadata),
            ctx.callerIdentity,
          );
        createdId = created.metadata?.id ?? "";
      } catch (error) {
        if (error instanceof ConnectError) {
          throw goWrappedStatusError(
            "failed to create default instance",
            error,
          );
        }
        throw new Error(
          `failed to create default instance: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // 3. Update agent status with default_instance_id — direct store
      // save (matching Java agentRepo.save), bypassing the Update
      // pipeline; the AGENT kind is explicit since the pipeline's kind is
      // agent_execution. A store failure is a plain (non-status) error in
      // Go, so both editions land on the pipeline's Internal fallback
      // ("internal server error" — the #478 sanitization posture).
      const status = (agent.status ??= create(AgentStatusSchema));
      status.defaultInstanceId = createdId;
      try {
        await deps.store.saveResource(
          ApiResourceKind.agent,
          agentId,
          AgentSchema,
          agent,
        );
      } catch (error) {
        throw new Error(
          `failed to update agent with default instance: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // The default_of invariant rides the pointer persist (C2 Stage 3).
      await notifyDefaultInstanceLinked(deps.authorizationLifecycle, {
        instanceKind: ApiResourceKind.agent_instance,
        instanceId: createdId,
        blueprintKind: ApiResourceKind.agent,
        blueprintId: agentId,
      });

      ctx.set(DEFAULT_INSTANCE_ID_KEY, createdId);
      deps.logger.info("Successfully ensured default instance exists", {
        instanceId: createdId,
        agentId,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// CreateSessionIfNeeded — create.go createSessionIfNeededStep.
// ---------------------------------------------------------------------------

/**
 * Builds the spec for an auto-created session (Go
 * buildAutoCreateSessionSpec): a caller-provided spec (the one-call
 * bootstrap, stigmer/stigmer#249) is CLONED and forwarded so the session
 * carries workspace_entries, harness, execution_target, MCP servers, and
 * skills from a single create call; defaults fill in the instance (when
 * the spec names none and an agent's default instance was resolved; an
 * empty id here and there is the built-in assistant) and the subject
 * sentinel (when empty).
 */
export function buildAutoCreateSessionSpec(
  callerSpec: SessionSpec | undefined,
  defaultInstanceId: string,
): SessionSpec {
  const spec =
    callerSpec !== undefined
      ? clone(SessionSpecSchema, callerSpec)
      : create(SessionSpecSchema);
  if (spec.agentInstanceId === "") {
    spec.agentInstanceId = defaultInstanceId;
  }
  if (spec.subject === "") {
    spec.subject = AUTO_CREATED_SESSION_SUBJECT;
  }
  return spec;
}

/**
 * Auto-creates the session when session_id is absent: forwards the
 * caller's session_spec, fills the instance from the previous step's
 * context key when an agent was named, leaves it empty for the built-in
 * assistant, owns the session under the CALLER's org (never the agent's —
 * cross-org agents stay usable), updates the execution with the created
 * id, and CLEARS session_spec (the Session resource is the single source
 * of truth; the persisted execution never carries a second copy that
 * could drift).
 */
export function newCreateSessionIfNeededStep(deps: {
  logger: Logger;
  sessionCreator: SessionCreatorProvider;
}): PipelineStep<CreateDesc> {
  return {
    name: "CreateSessionIfNeeded",
    async execute(ctx) {
      const execution = ctx.newState;
      let sessionId = execution.spec?.sessionId ?? "";
      const agentId = execution.spec?.agentId ?? "";

      if (sessionId !== "") {
        deps.logger.debug(
          "Session ID already provided, skipping auto-creation",
          {
            sessionId,
          },
        );
        return;
      }

      const callerSpec = execution.spec?.sessionSpec;
      deps.logger.info("Session ID not provided, auto-creating session", {
        agentId,
        hasSessionSpec: callerSpec !== undefined,
      });

      // 1. Resolve the instance when the caller's spec does not name one
      // and an agent was named: the previous step put the agent's default
      // instance under the context key exactly then. With no agent the
      // session is created with no instance — the built-in assistant.
      let defaultInstanceId = "";
      if ((callerSpec?.agentInstanceId ?? "") === "" && agentId !== "") {
        const resolved = ctx.get(DEFAULT_INSTANCE_ID_KEY);
        if (typeof resolved !== "string" || resolved === "") {
          deps.logger.error("DEFAULT_INSTANCE_ID not found in context", {
            agentId,
          });
          throw internalError(
            new Error("default instance ID not found in context"),
            "internal server error",
          );
        }
        defaultInstanceId = resolved;
      }

      // 2.–3. Build the session request: the caller's org from the
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
        spec: buildAutoCreateSessionSpec(callerSpec, defaultInstanceId),
      });

      // 4. Create via in-process gRPC (single source of truth). Go wraps
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
      deps.logger.info("Successfully auto-created session", {
        sessionId,
        agentId,
      });

      // 5. Update the execution and clear the embedded spec (single
      // source of truth — see the step doc).
      execution.spec ??= create(AgentExecutionSpecSchema);
      execution.spec.sessionId = sessionId;
      execution.spec.sessionSpec = undefined;

      // 6. Track the created session for observability.
      ctx.set(CREATED_SESSION_ID_KEY, sessionId);
    },
  };
}

// ---------------------------------------------------------------------------
// ComposeDeclaredPreferences — compose_declared_preferences_step.go.
// ---------------------------------------------------------------------------

/**
 * Snapshots the declared standing context onto the execution spec
 * (DD-002, stigmer/stigmer#293). SERVER-OWNED: stamped unconditionally,
 * overwriting anything the caller supplied. Two independent halves:
 * org_context, the organization's, for every run; and user_context, the
 * run's person's own (stigmer#1397) — composed only where callers are
 * persons (`personAccounts`, the require-authentication posture) and only
 * for a first-party human operator (runPersonOf), as the Java step did.
 * The single-operator posture composes org_context alone: its one
 * operator's context is the organization's. The org half deliberately
 * keeps running for every lane (schedule and channel runs carry the
 * organization's instructions today); only the person's half is about a
 * person. BEST-EFFORT: an execution must never fail to start because its
 * optional preferences could not load — genuine failures log at ERROR
 * (quiet degradation of a should-work path must stay visible) and degrade
 * that half to empty. Snapshot-at-create is the point: preferences are
 * mutable, executions are immutable audit records.
 */
export function newComposeDeclaredPreferencesStep(
  store: Store,
  logger: Logger,
  personAccounts?: AccountsByCaller,
): PipelineStep<CreateDesc> {
  return {
    name: "ComposeDeclaredPreferences",
    async execute(ctx) {
      const execution = ctx.newState;
      execution.spec ??= create(AgentExecutionSpecSchema);
      // Claim the server-owned field first, before any load can fail.
      execution.spec.declaredPreferences = create(DeclaredPreferencesSchema);

      // Verbatim per DD-002 D2: the server stamps content only;
      // blank-is-absent is the runner's read-side convention.
      execution.spec.declaredPreferences.orgContext =
        await loadOrgStandingContext(store, logger, orgIdOf(ctx));

      if (personAccounts === undefined) {
        return;
      }
      const person = await runPersonOf(
        personAccounts,
        ctx.callerIdentity,
        logger,
        "Failed to load the run's person for declared preferences - degrading user context to none (best-effort contract)",
      );
      execution.spec.declaredPreferences.userContext =
        person?.spec?.preferences?.standingContext ?? "";
    },
  };
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
 * Snapshots the subject's CONFIRMED memories onto the execution spec
 * (DD-006, stigmer/stigmer#293 Phase 2 Stage 2) — the recall half of the
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
      execution.spec ??= create(AgentExecutionSpecSchema);
      // Claim the server-owned field first.
      execution.spec.recalledMemories = create(RecalledMemoriesSchema);

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

      execution.spec.recalledMemories.enabled = true;
      execution.spec.recalledMemories.facts = facts;
      logger.debug("Composed recalled memories snapshot", {
        orgId,
        factCount: facts.length,
      });
    },
  };
}

/**
 * Scans the memory kind for `subject`'s confirmed records in the org,
 * oldest-first — the run's person's account id, or the single-operator
 * "" sentinel. Facts carry only memory_id + content (the id is the
 * transparency link back to the addressable record). Undecodable rows are
 * skipped — one bad record must not take recall down.
 */
async function loadConfirmedFacts(
  store: Store,
  orgId: string,
  subject: string,
) {
  const rows = await store.listResources(ApiResourceKind.memory);
  const memories: Memory[] = [];
  for (const data of rows) {
    let memory: Memory;
    try {
      memory = fromBinary(MemorySchema, data);
    } catch {
      continue;
    }
    if ((memory.metadata?.org ?? "") !== orgId) {
      continue;
    }
    if ((memory.spec?.subjectIdentityAccountId ?? "") !== subject) {
      continue;
    }
    if (
      memory.status?.lifecycleState !==
      MemoryLifecycleState.lifecycle_state_confirmed
    ) {
      continue;
    }
    memories.push(memory);
  }

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
      execution.status ??= create(AgentExecutionStatusSchema);
      execution.status.phase = ExecutionPhase.EXECUTION_PENDING;
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
  /** O4: the failure arm's PENDING→FAILED stamp is a notified transition. */
  statusObservers: ReadonlyArray<AgentExecutionStatusObserver>;
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

      // Log callback token presence (async activity completion pattern —
      // the token handshake ADR); Base64 preview only, never the bytes.
      const callbackToken = execution.spec?.callbackToken ?? new Uint8Array();
      if (callbackToken.length > 0) {
        const tokenBase64 = Buffer.from(callbackToken).toString("base64");
        deps.logger.info(
          "📝 Callback token present - workflow will complete external activity on finish",
          {
            executionId,
            tokenPreview:
              tokenBase64.length > 20
                ? `${tokenBase64.slice(0, 20)}...`
                : tokenBase64,
            tokenLength: callbackToken.length,
          },
        );
      }

      try {
        await engine.engine.startInvokeWorkflow({
          executionId,
          sessionId: execution.spec?.sessionId ?? "",
          agentId: execution.spec?.agentId ?? "",
          callbackToken,
          autoApproveAll: execution.spec?.autoApproveAll ?? false,
          parentWorkflowId: execution.spec?.parentWorkflowId ?? "",
          activityTaskQueueOverride: execution.spec?.activityTaskQueue ?? "",
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
        execution.status ??= create(AgentExecutionStatusSchema);
        const oldPhase = execution.status.phase;
        execution.status.phase = ExecutionPhase.EXECUTION_FAILED;
        execution.status.error = `Failed to start Temporal workflow: ${error instanceof Error ? error.message : String(error)}`;

        try {
          await deps.store.saveResource(
            ctx.apiResourceKind,
            executionId,
            AgentExecutionSchema,
            execution as AgentExecution,
          );
        } catch (updateError) {
          throw internalError(
            updateError,
            "failed to start workflow and failed to update status",
          );
        }
        // O4 site 3 of 5 (status-observers.ts): the PENDING→FAILED stamp
        // is a persisted terminal transition — notified before the
        // refusal surfaces.
        await notifyStatusObservers(
          deps,
          execution as AgentExecution,
          oldPhase,
          ExecutionPhase.EXECUTION_FAILED,
        );
        throw internalError(error, "failed to start workflow");
      }

      deps.logger.info("Temporal workflow started successfully", {
        executionId,
      });
    },
  };
}

/** Unknown-execution NotFound with Go's kind naming for these paths. */
export function agentExecutionNotFound(executionId: string): ConnectError {
  return notFoundError("agent_execution", executionId);
}
