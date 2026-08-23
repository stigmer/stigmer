/**
 * Session domain-local pipeline steps — port the inline steps of
 * pkg/domain/session/controller/ (create.go, delete.go, list.go,
 * validate_harness_immutability.go,
 * validate_execution_target_immutability.go,
 * record_harness_state_history.go) and its steps/ package
 * (filter_by_agent_instance.go, filter_by_channel.go). Shared steps stay
 * in src/pipeline/steps/; these exist because they embody
 * session-specific contracts: the default-agent-instance resolution, the
 * harness/execution-target immutability sentinels, the server-owned
 * harness-state history, the active-execution delete guard with its
 * execution cascade, and the list filters.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { create, fromBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/status_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import {
  ExecutionTarget,
  Harness,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionListSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { AgentExecutionTemporalConfig } from "../agentexecution/temporal/config.js";
import {
  failedPreconditionError,
  goWrappedStatusError,
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { RESOURCE_ID_KEY } from "../../pipeline/steps/delete.js";
import { compareCreatedAtDesc } from "../../pipeline/steps/helpers.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import { buildDefaultInstanceRequest } from "../agentinstance/defaultinstance.js";
import {
  DefaultAgentNotConfiguredError,
  DefaultAgentNotPublicError,
  findDefaultAgent,
} from "../agent/defaultagent.js";

type SessionDesc = typeof SessionSchema;

/** Context key for the list result (Go listResultKey). */
export const LIST_RESULT_KEY = "listResult";

/**
 * The session label the channel runtime stamps at create time to record
 * which agent channel originated the conversation. Mirrors
 * ChannelRuntimeConstants.CHANNEL_ID_METADATA_KEY in Stigmer Cloud.
 */
const CHANNEL_ID_LABEL_KEY = "stigmer.ai/channel-id";

/**
 * The narrow in-process surface the session domain needs from
 * agentinstance — consumer-defined so the dependency reads at the domain
 * boundary (the Go twin is pkg/downstream/agentinstance.Client). This is
 * the CREATE RPC (Go CreateAsSystem), not apply: the resolve step only
 * reaches it when the default instance is known to be missing, and a
 * duplicate-slug collision must surface as AlreadyExists, not silently
 * update. Calls ride the in-process router transport, traversing the full
 * interceptor chain (DD-002).
 */
export interface AgentInstanceCreator {
  createAsSystem(instance: AgentInstance): Promise<AgentInstance>;
}

/**
 * Lazy provider for the in-process agentinstance edge — resolved at call
 * time, never at construction (the ratified DI story, D2 §2).
 */
export type AgentInstanceCreatorProvider = () => AgentInstanceCreator;

// ---------------------------------------------------------------------------
// ResolveDefaultAgentInstance — create.go:62-182: when agent_instance_id is
// not provided, resolve the platform default agent (shared defaultagent
// implementation: label stigmer.ai/default-agent=true, visibility_public,
// deterministic incumbent-wins tie-break), get or create its default
// instance, and set agent_instance_id on the session spec. This enables the
// session-first UX where users create a session (with workspace entries)
// without knowing the agent instance — the backend resolves it
// automatically.
//
// Runs FIRST in the create chain, before ValidateProto — resolution must
// fill agent_instance_id before validation sees the spec.
//
// The id lands on ctx.newState.spec, NEVER on input: the pipeline cloned
// input into newState at construction and Persist saves newState, so
// mutating input does not propagate (Go's documented clone gotcha,
// create.go:168-170).
// ---------------------------------------------------------------------------

export function newResolveDefaultAgentInstanceStep(
  store: Store,
  creator: AgentInstanceCreatorProvider,
  logger: Logger,
): PipelineStep<SessionDesc> {
  return {
    name: "ResolveDefaultAgentInstance",
    async execute(ctx: RequestContext<SessionDesc>): Promise<void> {
      if ((ctx.input.spec?.agentInstanceId ?? "") !== "") {
        return;
      }

      logger.info(
        "agent_instance_id not provided on session, resolving platform default agent",
      );

      // 1. Resolve the default agent. The error copy is Go WrapError's
      // "%s: %v" — the sentinel's text RIDES the wire message, and the
      // NotFound arm carries Go's DOUBLE wrap (fmt.Errorf("no default
      // agent available on this platform: %w", err) inside WrapError).
      // Byte-pinned.
      let defaultAgent: Agent;
      try {
        defaultAgent = await findDefaultAgent(store, logger);
      } catch (error) {
        if (error instanceof DefaultAgentNotConfiguredError) {
          logger.error("No platform default agent configured", {
            error: error.message,
          });
          throw new ConnectError(
            `No default agent available. Ensure an agent with label stigmer.ai/default-agent=true and visibility_public exists: no default agent available on this platform: ${error.message}`,
            Code.NotFound,
          );
        }
        if (error instanceof DefaultAgentNotPublicError) {
          logger.error("Default agent is not visibility_public", {
            error: error.message,
          });
          throw new ConnectError(
            `Default agent exists but is not visibility_public: ${error.message}`,
            Code.FailedPrecondition,
          );
        }
        // Store/decode failure — an internal fault, not "no default
        // agent". InternalError keeps the cause off the wire
        // (stigmer/stigmer#478).
        logger.error("Failed to resolve platform default agent", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw internalError(
          error,
          "failed to resolve the platform default agent",
        );
      }

      const metadata = defaultAgent.metadata;
      if (metadata === undefined) {
        // Unreachable: findDefaultAgent only returns public-visibility
        // candidates, whose metadata is necessarily set.
        throw internalError(
          new Error("default agent metadata is nil"),
          "failed to resolve the platform default agent",
        );
      }
      const agentId = metadata.id;
      logger.info("Resolved platform default agent", {
        agentId,
        agentName: metadata.name,
      });

      // 2. Get or create the default instance.
      let defaultInstanceId = defaultAgent.status?.defaultInstanceId ?? "";
      if (defaultInstanceId === "") {
        logger.info("Default instance missing, creating one", { agentId });

        const instanceRequest = buildDefaultInstanceRequest(metadata);

        // Go create.go:144-148 wraps the downstream error with fmt.Errorf
        // ("failed to create default instance for default agent: %w") and
        // PipelineError.GRPCStatus's errors.As branch keeps the inner
        // CODE but rewrites the wire MESSAGE to the wrapped text —
        // transport formatting (`rpc error: code = X desc = ...`)
        // included. Mirrored byte-for-byte via goWrappedStatusError; the
        // leak is stigmer/stigmer#852 (both-editions post-cutover fix).
        // Unstatused failures fall to the pipeline's Internal fallback,
        // exactly Go's plain-error path.
        let createdInstance: AgentInstance;
        try {
          createdInstance = await creator().createAsSystem(instanceRequest);
        } catch (error) {
          logger.error("Failed to create default instance", {
            agentId,
            error: error instanceof Error ? error.message : String(error),
          });
          if (error instanceof ConnectError) {
            throw goWrappedStatusError(
              "failed to create default instance for default agent",
              error,
            );
          }
          throw new Error(
            `failed to create default instance for default agent: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        defaultInstanceId = createdInstance.metadata?.id ?? "";

        // Persist default_instance_id on the agent — EXPLICITLY the agent
        // kind: this pipeline's ctx kind is session (Go hardcodes
        // ApiResourceKind_agent here too).
        if (defaultAgent.status === undefined) {
          defaultAgent.status = create(AgentStatusSchema, {});
        }
        defaultAgent.status.defaultInstanceId = defaultInstanceId;
        try {
          await store.saveResource(
            ApiResourceKind.agent,
            agentId,
            AgentSchema,
            defaultAgent,
          );
        } catch (error) {
          logger.error("Failed to persist agent with default_instance_id", {
            agentId,
            error: error instanceof Error ? error.message : String(error),
          });
          // Go wraps as a plain error → the pipeline's Internal fallback.
          throw new Error(
            `failed to persist agent with default instance: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        logger.info("Created default instance for default agent", {
          instanceId: defaultInstanceId,
          agentId,
        });
      }

      // 3. Set agent_instance_id on the session's newState (not input) —
      // see the module-level clone gotcha note.
      const newState = ctx.newState;
      if (newState.spec === undefined) {
        newState.spec = create(SessionSpecSchema, {});
      }
      newState.spec.agentInstanceId = defaultInstanceId;

      logger.info(
        "Set agent_instance_id on session from platform default agent",
        {
          agentInstanceId: defaultInstanceId,
        },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// ValidateHarnessImmutability — validate_harness_immutability.go: rejects
// session updates that attempt to change the harness after the session has
// been used for execution. Each harness owns its conversation state
// independently (LangGraph uses Stigmer checkpoints via harness_state_id;
// Cursor uses a Cursor-hosted Agent via cursor_agent_id in
// harness_state_id); switching harness mid-session would silently discard
// conversation history. A session counts as "used" when its
// harness_state_id is non-empty — set after the first execution completes.
// ---------------------------------------------------------------------------

export function newValidateHarnessImmutabilityStep(): PipelineStep<SessionDesc> {
  return {
    name: "ValidateHarnessImmutability",
    execute(ctx: RequestContext<SessionDesc>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined;
      if (existing === undefined) {
        return;
      }

      const existingSpec = existing.spec;
      if (existingSpec === undefined) {
        return;
      }

      // Session has not been used yet — harness can still change.
      if (existingSpec.harnessStateId === "") {
        return;
      }

      const inputSpec = ctx.input.spec;
      if (inputSpec === undefined) {
        return;
      }

      // Treat UNSPECIFIED as NATIVE for comparison.
      let existingHarness = existingSpec.harness;
      let inputHarness = inputSpec.harness;
      if (existingHarness === Harness.UNSPECIFIED) {
        existingHarness = Harness.NATIVE;
      }
      if (inputHarness === Harness.UNSPECIFIED) {
        inputHarness = Harness.NATIVE;
      }

      if (inputHarness !== existingHarness) {
        throw failedPreconditionError(
          "session harness cannot be changed after the first execution — each harness owns its conversation state independently",
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// ValidateExecutionTargetImmutability —
// validate_execution_target_immutability.go: rejects session updates that
// attempt to change execution_target after the session has been used for
// execution — workspace state may not be portable between local and cloud
// environments.
//
// UNSPECIFIED is compared by what dispatch would actually do with it: both
// the existing and the input target are resolved through the same
// deployment default dispatch uses (resolveExecutionTarget — LOCAL on OSS,
// CLOUD on hosted deployments), so "no effective change" and "no dispatch
// change" are the same predicate on every deployment. Hardcoding
// UNSPECIFIED to a fixed target here would refuse round-trips that change
// nothing on cloud-defaulting deployments and wave through updates that
// really do move the session (oss#397).
//
// Uses the same sentinel as harness immutability: harness_state_id is
// non-empty after the first execution completes.
// ---------------------------------------------------------------------------

/**
 * Go's ExecutionTarget.String() names, reproduced explicitly: protobuf-es
 * strips the shared EXECUTION_TARGET_ prefix from the TS enum members
 * (ExecutionTarget[1] yields "LOCAL"), but the refusal copy carries the
 * full proto value names — cross-edition wire contract.
 */
const EXECUTION_TARGET_GO_NAMES: Readonly<Record<ExecutionTarget, string>> = {
  [ExecutionTarget.UNSPECIFIED]: "EXECUTION_TARGET_UNSPECIFIED",
  [ExecutionTarget.LOCAL]: "EXECUTION_TARGET_LOCAL",
  [ExecutionTarget.CLOUD]: "EXECUTION_TARGET_CLOUD",
};

export function newValidateExecutionTargetImmutabilityStep(
  temporalConfig: AgentExecutionTemporalConfig,
): PipelineStep<SessionDesc> {
  return {
    name: "ValidateExecutionTargetImmutability",
    execute(ctx: RequestContext<SessionDesc>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined;
      if (existing === undefined) {
        return;
      }

      const existingSpec = existing.spec;
      if (existingSpec === undefined) {
        return;
      }

      if (existingSpec.harnessStateId === "") {
        return;
      }

      const inputSpec = ctx.input.spec;
      if (inputSpec === undefined) {
        return;
      }

      const existingTarget = temporalConfig.resolveExecutionTarget(
        existingSpec.executionTarget,
      );
      const inputTarget = temporalConfig.resolveExecutionTarget(
        inputSpec.executionTarget,
      );

      if (inputTarget !== existingTarget) {
        throw failedPreconditionError(
          `session execution_target cannot be changed after the first execution (${EXECUTION_TARGET_GO_NAMES[existingTarget]} → ${EXECUTION_TARGET_GO_NAMES[inputTarget]}; unset resolves to the deployment default, ${temporalConfig.defaultExecutionTarget}) — workspace state may not be portable between local and cloud environments`,
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// RecordHarnessStateHistory — record_harness_state_history.go: maintains
// the server-owned harness_state_id_history on the merged update state.
//
// A session can span multiple harness-side conversations: when the
// cursor-runner's resume fails, it creates a fresh Cursor agent and
// replaces harness_state_id via a normal session update. The replaced id
// must not be destroyed — billing reconciliation joins Cursor ledger
// events on the union of current + prior ids, and every turn that ran
// under a replaced id would otherwise become an orphaned ledger event.
//
// The history is computed here, from the observed harness_state_id
// transition, and never taken from client input: BuildUpdateState performs
// full spec replacement, so a stale client resending an old spec would
// silently clobber a client-writable history. Resetting it from the
// existing record makes the server the single writer of this field.
//
// Must run after BuildUpdateState (it mutates the merged state) and
// before Persist.
// ---------------------------------------------------------------------------

export function newRecordHarnessStateHistoryStep(): PipelineStep<SessionDesc> {
  return {
    name: "RecordHarnessStateHistory",
    execute(ctx: RequestContext<SessionDesc>): void {
      const mergedSpec = ctx.newState.spec;
      if (mergedSpec === undefined) {
        return;
      }

      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined;
      if (existing === undefined || existing.spec === undefined) {
        return;
      }
      const existingSpec = existing.spec;

      // Server-owned: the merged state carries whatever the client sent
      // for this field — discard it and rebuild from the stored history.
      const history = [...existingSpec.harnessStateIdHistory];

      const previousId = existingSpec.harnessStateId;
      if (
        previousId !== "" &&
        previousId !== mergedSpec.harnessStateId &&
        !history.includes(previousId)
      ) {
        history.push(previousId);
      }

      mergedSpec.harnessStateIdHistory = history;
    },
  };
}

// ---------------------------------------------------------------------------
// Delete guard + cascade — delete.go. Children before parent, so a
// mid-failure retry converges (already-deleted executions are simply no
// longer found; the reverse order would orphan executions permanently).
// The cross-kind access to agent_execution rows (#17's kind) is RATIFIED
// (project T01 brief) — the session owns its executions' lifecycle.
// ---------------------------------------------------------------------------

/**
 * Whether an execution phase counts as active for the session-delete
 * guard: pending, in progress, waiting for approval, or paused.
 * WAITING_FOR_APPROVAL and PAUSED are deliberately included — the
 * execution is logically alive and expected to resume. Mirrors the Cloud
 * AgentExecutionRepo.countActiveBySessionId phase set (Go
 * isActiveExecutionPhase, default-false switch).
 */
function isActiveExecutionPhase(phase: ExecutionPhase): boolean {
  switch (phase) {
    case ExecutionPhase.EXECUTION_PENDING:
    case ExecutionPhase.EXECUTION_IN_PROGRESS:
    case ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL:
    case ExecutionPhase.EXECUTION_PAUSED:
      return true;
    default:
      return false;
  }
}

/**
 * Loads every agent execution whose spec.session_id matches the given
 * session; malformed rows warn and are skipped. Shared by the guard and
 * cascade steps (Go listExecutionsBySession).
 */
async function listExecutionsBySession(
  store: Store,
  logger: Logger,
  sessionId: string,
): Promise<AgentExecution[]> {
  let rows: Uint8Array[];
  try {
    rows = await store.listResources(ApiResourceKind.agent_execution);
  } catch (error) {
    throw internalError(error, "failed to list agent executions");
  }

  const executions: AgentExecution[] = [];
  for (const data of rows) {
    let execution: AgentExecution;
    try {
      execution = fromBinary(AgentExecutionSchema, data);
    } catch (error) {
      logger.warn("Failed to unmarshal execution, skipping", {
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if ((execution.spec?.sessionId ?? "") === sessionId) {
      executions.push(execution);
    }
  }
  return executions;
}

/**
 * RejectDeleteWithActiveExecutions — rejects deletion while any agent
 * execution in the session is still active. Deleting a session mid-run
 * would strand a live execution whose conversation no longer exists; the
 * caller must cancel the execution or wait for it to finish. Error
 * contract matches Stigmer Cloud's
 * SessionDeleteHandler.RejectDeleteWithActiveExecutionsStep.
 */
export function newRejectDeleteWithActiveExecutionsStep<
  Desc extends DescMessage,
>(store: Store, logger: Logger): PipelineStep<Desc> {
  return {
    name: "RejectDeleteWithActiveExecutions",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const sessionId = requireSessionId(ctx);
      const executions = await listExecutionsBySession(
        store,
        logger,
        sessionId,
      );

      let activeCount = 0;
      for (const execution of executions) {
        if (
          isActiveExecutionPhase(
            execution.status?.phase ??
              ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED,
          )
        ) {
          activeCount++;
        }
      }

      if (activeCount > 0) {
        throw failedPreconditionError(
          `session has ${activeCount} active execution(s); cancel them or wait for completion before deleting`,
        );
      }
    },
  };
}

/**
 * CascadeDeleteAgentExecutions — deletes the session's agent executions
 * before the session row itself. Billing/usage data is unaffected — usage
 * records are immutable and carry their own copies of session/execution
 * identifiers. Search-index removal per execution is best-effort,
 * matching DeleteSearchIndexStep's convention.
 */
export function newCascadeDeleteAgentExecutionsStep<Desc extends DescMessage>(
  store: Store,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "CascadeDeleteAgentExecutions",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const sessionId = requireSessionId(ctx);
      const executions = await listExecutionsBySession(
        store,
        logger,
        sessionId,
      );
      if (executions.length === 0) {
        return;
      }

      for (const execution of executions) {
        const executionId = execution.metadata?.id ?? "";
        try {
          await store.deleteResource(
            ApiResourceKind.agent_execution,
            executionId,
          );
        } catch (error) {
          throw internalError(
            error,
            `failed to cascade-delete execution ${executionId} of session ${sessionId}`,
          );
        }
        try {
          await store.deleteSearchIndex(
            ApiResourceKind.agent_execution,
            executionId,
          );
        } catch (error) {
          logger.warn(
            "CascadeDeleteAgentExecutions: failed to remove search index entry (best-effort)",
            {
              executionId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }

      logger.info("Cascade-deleted executions of session", {
        sessionId,
        count: executions.length,
      });
    },
  };
}

/** The delete pipeline's extracted session id (ExtractResourceId runs first). */
function requireSessionId<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
): string {
  const sessionId = ctx.get(RESOURCE_ID_KEY);
  if (typeof sessionId !== "string" || sessionId === "") {
    throw internalError(
      new Error(
        "session id not found in context (ExtractResourceId must run first)",
      ),
      "session id not found in context (ExtractResourceId must run first)",
    );
  }
  return sessionId;
}

// ---------------------------------------------------------------------------
// List steps — list.go and the steps/ package. Full scans with client-side
// filtering, exactly Go (no pagination, no authorization filtering in OSS).
// ---------------------------------------------------------------------------

/**
 * ListAllSessions — all sessions, newest first by spec-audit created_at
 * (seconds then nanos; timestamped entries before untimestamped ones).
 * Malformed rows warn and are skipped.
 */
export function newListAllSessionsStep(
  store: Store,
  logger: Logger,
): PipelineStep<typeof SessionQueryController.method.list.input> {
  return {
    name: "ListAllSessions",
    async execute(
      ctx: RequestContext<typeof SessionQueryController.method.list.input>,
    ): Promise<void> {
      const sessions = await loadAllSessions(
        store,
        logger,
        ctx.apiResourceKind,
      );

      sessions.sort((a, b) =>
        compareCreatedAtDesc(
          a.status?.audit?.specAudit?.createdAt,
          b.status?.audit?.specAudit?.createdAt,
        ),
      );

      logger.info("Loaded sessions from database", { count: sessions.length });

      ctx.set(
        LIST_RESULT_KEY,
        create(SessionListSchema, { entries: sessions }),
      );
    },
  };
}

/**
 * FilterByAgentInstance — steps/filter_by_agent_instance.go: sessions
 * whose spec.agent_instance_id matches. No sorting (Go doesn't sort here).
 */
export function newFilterByAgentInstanceStep(
  store: Store,
  logger: Logger,
): PipelineStep<
  typeof SessionQueryController.method.listByAgentInstance.input
> {
  return {
    name: "FilterByAgentInstance",
    async execute(
      ctx: RequestContext<
        typeof SessionQueryController.method.listByAgentInstance.input
      >,
    ): Promise<void> {
      const agentInstanceId = ctx.input.agentInstanceId;
      if (agentInstanceId === "") {
        throw invalidArgumentError("agent_instance_id is required");
      }

      const sessions = await loadAllSessions(
        store,
        logger,
        ctx.apiResourceKind,
      );
      const filtered = sessions.filter(
        (session) => (session.spec?.agentInstanceId ?? "") === agentInstanceId,
      );

      logger.info("Filtered sessions by agent instance", {
        agentInstanceId,
        totalSessions: sessions.length,
        filteredSessions: filtered.length,
      });

      ctx.set(
        LIST_RESULT_KEY,
        create(SessionListSchema, { entries: filtered }),
      );
    },
  };
}

/**
 * FilterByChannel — steps/filter_by_channel.go: sessions whose
 * metadata.labels carry the channel's stigmer.ai/channel-id stamp. No
 * sorting. Channel sessions are created by the cloud channel runtime
 * (Slack/WhatsApp inbound turns), which stamps the label at create time;
 * the OSS runtime has no channel broker, so this filter typically matches
 * nothing — the RPC exists for contract parity with Stigmer Cloud (which
 * additionally gates on can_view of the agent_channel and intersects with
 * FGA-authorized session IDs).
 */
export function newFilterByChannelStep(
  store: Store,
  logger: Logger,
): PipelineStep<typeof SessionQueryController.method.listByChannel.input> {
  return {
    name: "FilterByChannel",
    async execute(
      ctx: RequestContext<
        typeof SessionQueryController.method.listByChannel.input
      >,
    ): Promise<void> {
      const channelId = ctx.input.channelId;
      if (channelId === "") {
        throw invalidArgumentError("channel_id is required");
      }

      const sessions = await loadAllSessions(
        store,
        logger,
        ctx.apiResourceKind,
      );
      const filtered = sessions.filter(
        (session) =>
          (session.metadata?.labels ?? {})[CHANNEL_ID_LABEL_KEY] === channelId,
      );

      logger.info("Filtered sessions by channel", {
        channelId,
        totalSessions: sessions.length,
        filteredSessions: filtered.length,
      });

      ctx.set(
        LIST_RESULT_KEY,
        create(SessionListSchema, { entries: filtered }),
      );
    },
  };
}

/** Full-scan session load shared by the list steps; malformed rows warn + skip. */
async function loadAllSessions(
  store: Store,
  logger: Logger,
  kind: ApiResourceKind,
): Promise<Session[]> {
  let rows: Uint8Array[];
  try {
    rows = await store.listResources(kind);
  } catch (error) {
    throw internalError(error, "failed to list sessions");
  }

  const sessions: Session[] = [];
  for (const data of rows) {
    let session: Session;
    try {
      session = fromBinary(SessionSchema, data);
    } catch (error) {
      logger.warn("Failed to unmarshal session, skipping", {
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    sessions.push(session);
  }
  return sessions;
}
