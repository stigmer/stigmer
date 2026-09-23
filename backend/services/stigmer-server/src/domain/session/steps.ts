/**
 * Session domain-local pipeline steps — port the inline steps of
 * pkg/domain/session/controller/ (create.go, delete.go, list.go,
 * validate_harness_immutability.go,
 * validate_execution_target_immutability.go,
 * record_harness_state_history.go) and its steps/ package
 * (filter_by_agent_instance.go, filter_by_channel.go). Shared steps stay
 * in src/pipeline/steps/; these exist because they embody
 * session-specific contracts: the harness/execution-target immutability
 * sentinels, the server-owned harness-state history, the active-execution
 * delete guard with its execution cascade, and the list filters.
 *
 * An empty spec.agent_instance_id is a legal shape and stays empty: the
 * session runs the built-in assistant (session/v1/spec.proto). No step here
 * resolves it into an instance, and no step guards it on update, because
 * a conversation may gain an agent or drop back to the assistant; the
 * immutable fields are the harness and the execution target below.
 */
import { create, fromBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import {
  ExecutionTarget,
  Harness,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionListSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import type { SessionList } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { AgentExecutionTemporalConfig } from "../agentexecution/temporal/config.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import { newAuthorizeResolvedTargetStep } from "../../pipeline/steps/authorize-resolved-target.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { RESOURCE_ID_KEY } from "../../pipeline/steps/delete.js";
import {
  listPageFingerprint,
  readListPage,
} from "../../pipeline/steps/list-page.js";
import type { ListPageRequest } from "../../pipeline/steps/list-page.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import type { ListIndexQuery, ListIndexRow } from "../../store/list-index.js";
import { agentExecutionListIndex } from "../agentexecution/list-index.js";
import { sessionListIndex } from "./list-index.js";

type SessionDesc = typeof SessionSchema;

/** Context key for the list result (Go listResultKey). */
export const LIST_RESULT_KEY = "listResult";

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
 * Every agent execution of the given session, through the list index's
 * session key (exact whoever wrote the rows, store/interface.ts); malformed
 * rows warn and are skipped. Shared by the guard and cascade steps (Go
 * listExecutionsBySession).
 */
async function listExecutionsBySession(
  store: Store,
  logger: Logger,
  sessionId: string,
): Promise<AgentExecution[]> {
  let rows: ListIndexRow[];
  try {
    rows = await store.queryResources(agentExecutionListIndex, {
      anyKey: [{ name: "session", value: sessionId }],
    });
  } catch (error) {
    throw internalError(error, "failed to list agent executions");
  }

  const executions: AgentExecution[] = [];
  for (const row of rows) {
    try {
      executions.push(fromBinary(AgentExecutionSchema, row.data));
    } catch (error) {
      logger.warn("Failed to unmarshal execution, skipping", {
        error: error instanceof Error ? error.message : String(error),
      });
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
// List steps — list.go and the steps/ package. Each lane reads its page
// through the list index (pipeline/steps/list-page.ts): the store narrows
// by the request's organization or parent key and orders newest first
// (spec-audit created_at, unstamped last, ties by id); the read scope, when
// composed, narrows each batch to the caller's authorized sessions last —
// the Java list handlers' FGA-ids pattern, guest cookie rule included
// driver-side. No scope composed = the OSS single-user posture, every
// matching session.
// ---------------------------------------------------------------------------

/**
 * ListAllSessions — one page of sessions, the request's organization when
 * it names one, newest first. Malformed rows warn and are skipped.
 */
export function newListAllSessionsStep(
  store: Store,
  logger: Logger,
  listReadScope: ListReadScope | undefined,
): PipelineStep<typeof SessionQueryController.method.list.input> {
  return {
    name: "ListAllSessions",
    async execute(
      ctx: RequestContext<typeof SessionQueryController.method.list.input>,
    ): Promise<void> {
      const input = ctx.input;
      const page = await readSessionPage(
        store,
        logger,
        listReadScope,
        ctx.callerIdentity,
        ctx.input,
        {
          query: { org: input.org },
          fingerprint: {
            lane: "session.list",
            org: input.org,
            tags: input.tags,
          },
        },
      );
      ctx.set(LIST_RESULT_KEY, page);
    },
  };
}

/**
 * FilterByAgentInstance — steps/filter_by_agent_instance.go: one page of
 * the sessions whose spec.agent_instance_id matches, newest first.
 */
export function newFilterByAgentInstanceStep(
  store: Store,
  logger: Logger,
  listReadScope: ListReadScope | undefined,
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

      // The instance's sessions through its key, the scope last (census
      // lane 2): a composed driver is asked about one instance's rows.
      const page = await readSessionPage(
        store,
        logger,
        listReadScope,
        ctx.callerIdentity,
        ctx.input,
        {
          query: {
            anyKey: [{ name: "agent_instance", value: agentInstanceId }],
          },
          fingerprint: { lane: "session.listByAgentInstance", agentInstanceId },
        },
      );
      ctx.set(LIST_RESULT_KEY, page);
    },
  };
}

/**
 * AuthorizeChannelAccess — the Java SessionListByChannelHandler's
 * two-stage authorization, stage one: an explicit can_view check on the
 * TARGET agent_channel before any session work, so a caller without
 * channel access learns nothing about the channel's sessions. The
 * mid-chain resolved-target evaluation (the is_skip_authorization
 * annotation makes the position-1 step a no-op on this lane); deny copy is
 * the Java handler's byte-pinned "unauthorized to list channel
 * conversations". The blank-id refusal stays FilterByChannel's (the step
 * behind this gate) — the gate asks nothing when no channel is named.
 */
export function newAuthorizeChannelAccessStep(
  authorizer: Authorizer,
): PipelineStep<typeof SessionQueryController.method.listByChannel.input> {
  return newAuthorizeResolvedTargetStep(
    authorizer,
    ({ input }) =>
      input.channelId === ""
        ? []
        : [
            {
              permission: IamPermission.can_view,
              resourceKind: ApiResourceKind.agent_channel,
              resourceId: input.channelId,
              deniedMessage: "unauthorized to list channel conversations",
            },
          ],
    "AuthorizeChannelAccess",
  );
}

/**
 * FilterByChannel — steps/filter_by_channel.go: one page of the sessions
 * whose metadata.labels carry the channel's stigmer.ai/channel-id stamp,
 * newest first. Channel sessions are created by the cloud channel runtime
 * (Slack/WhatsApp inbound turns), which stamps the label at create time;
 * the OSS runtime has no channel broker, so this filter typically matches
 * nothing — the RPC exists for contract parity with Stigmer Cloud (which
 * additionally gates on can_view of the agent_channel and intersects with
 * FGA-authorized session IDs).
 */
export function newFilterByChannelStep(
  store: Store,
  logger: Logger,
  listReadScope: ListReadScope | undefined,
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

      // The channel's sessions through its key, the scope last (census lane 3).
      const page = await readSessionPage(
        store,
        logger,
        listReadScope,
        ctx.callerIdentity,
        ctx.input,
        {
          query: { anyKey: [{ name: "channel", value: channelId }] },
          fingerprint: { lane: "session.listByChannel", channelId },
        },
      );
      ctx.set(LIST_RESULT_KEY, page);
    },
  };
}

/** The three session lanes' shared read: one page, the scope last, as a SessionList. */
async function readSessionPage(
  store: Store,
  logger: Logger,
  listReadScope: ListReadScope | undefined,
  caller: CallerIdentity,
  request: ListPageRequest,
  lane: {
    readonly query: ListIndexQuery<"agent_instance" | "channel">;
    readonly fingerprint: Readonly<Record<string, unknown>>;
  },
): Promise<SessionList> {
  const page = await readListPage({
    store,
    declaration: sessionListIndex,
    query: lane.query,
    request,
    fingerprint: listPageFingerprint(lane.fingerprint),
    decode: (data) => {
      try {
        return fromBinary(SessionSchema, data);
      } catch (error) {
        logger.warn("Failed to unmarshal session, skipping", {
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }
    },
    scope: (sessions) =>
      restrictListByReadScope(
        listReadScope,
        caller,
        ApiResourceKind.session,
        sessions,
        "",
      ),
    failure: "failed to list sessions",
  });
  return create(SessionListSchema, {
    entries: page.entries,
    nextPageToken: page.nextPageToken,
    totalPages: page.nextPageToken === "" ? 1 : 0,
  });
}
