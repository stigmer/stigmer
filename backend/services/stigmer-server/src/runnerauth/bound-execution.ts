/**
 * The execution a runner credential is bound to — the ONE reader every
 * consumer of the binding goes through, so the verifier (who is this
 * runner acting as?), the memory-capture capability (which session is
 * this run's?) and the ExecutionContext decrypt lane (may a run
 * credential still decrypt?) cannot answer "is this run live" three ways.
 *
 * Two questions, two functions, because the callers pay differently:
 *
 *   - `boundExecutionKindOf(id)`: which execution kind the binding names,
 *     read off the id's prefix through the contract's own `kind_meta`
 *     table (pipeline/apiresource-meta.ts `kindByIdPrefix`) — no store
 *     read. A credential can bind exactly two kinds; a session's or an
 *     agent's id, a foreign prefix, or garbage is `undefined`, and the
 *     caller refuses with its own sentence. The lane-admission decorator
 *     asks only this, per run-gate check, so it must stay free of I/O.
 *   - `loadBoundExecution(store, id)`: the row's facts the lane needs and
 *     nothing else — the creator stamp the verifier resolves a person
 *     from, the org and session the capture capability scopes with, and
 *     LIVENESS. One primary-key read; a missing row is `undefined` (the
 *     credential is invalid — the run is not the caller's to learn
 *     about); any other store failure propagates as the fault it is (the
 *     ratified store-fault mapping), so an outage never reads as a bad
 *     credential.
 *
 * Liveness is the row's, not a clock's, and it is the same rule on both
 * lanes that accept a run credential: a run is live while its phase is
 * not terminal — a run waits on humans with no timeout, so no clock could
 * bound it — and for RUN_CREDENTIAL_GRACE_AFTER_TERMINAL_MS after the
 * moment the row says it finished (`status.completed_at`), because two
 * legitimate runner writes trail the terminal stamp (constants.ts). A
 * terminal row that does not say when it finished gets no grace: fail
 * closed. Each kind's terminal set is its own domain's predicate
 * (agentexecution/phases.ts, workflowexecution/phases.ts), never restated
 * here. A RECOVERED execution is live again, and so is its credential —
 * the same principal set as the token in Temporal history (the operator
 * who runs the engine and holds the signing key).
 */
import type { Message } from "@bufbuild/protobuf";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { isTerminalExecutionPhase } from "../domain/agentexecution/phases.js";
import { isTerminalWorkflowExecutionPhase } from "../domain/workflowexecution/phases.js";
import { kindByIdPrefix } from "../pipeline/apiresource-meta.js";
import { auditOf } from "../pipeline/steps/defaults.js";
import type { Store } from "../store/interface.js";
import { ResourceNotFoundError } from "../store/interface.js";
import { RUN_CREDENTIAL_GRACE_AFTER_TERMINAL_MS } from "./constants.js";

/** The two kinds a runner credential can bind — the lane's own vocabulary, not the enum's. */
export type BoundExecutionKind = "agent-execution" | "workflow-execution";

/** The facts the lane reads off a bound execution's row. */
export interface BoundExecution {
  readonly kind: BoundExecutionKind;
  readonly executionId: string;
  /** `metadata.org` — the capture capability scopes a memory to it. */
  readonly org: string;
  /** The creator stamp as written: an account id since 3.15.0, a raw issuer subject before. */
  readonly createdBy: string;
  /** The agent execution's session; empty for a workflow execution, which has none. */
  readonly sessionId: string;
  /** Not terminal, or terminal within the grace (see the header). */
  readonly live: boolean;
}

export type BoundExecutionStore = Pick<Store, "getResource">;

export function boundExecutionKindOf(
  executionId: string,
): BoundExecutionKind | undefined {
  switch (kindByIdPrefix(executionId)) {
    case ApiResourceKind.agent_execution:
      return "agent-execution";
    case ApiResourceKind.workflow_execution:
      return "workflow-execution";
    default:
      return undefined;
  }
}

/**
 * Loads the bound execution's facts; `undefined` when the id names no
 * execution kind or no row. `now` is injectable for the grace arms and
 * defaults to the wall clock.
 */
export async function loadBoundExecution(
  store: BoundExecutionStore,
  executionId: string,
  now: number = Date.now(),
): Promise<BoundExecution | undefined> {
  const kind = boundExecutionKindOf(executionId);
  if (kind === undefined) {
    return undefined;
  }
  switch (kind) {
    case "agent-execution": {
      const row = await getRow(
        store,
        ApiResourceKind.agent_execution,
        executionId,
        AgentExecutionSchema,
      );
      if (row === undefined) {
        return undefined;
      }
      return {
        kind,
        executionId,
        org: row.metadata?.org ?? "",
        createdBy: creatorStampOf(AgentExecutionSchema, row),
        sessionId: row.spec?.sessionId ?? "",
        live: isLive(
          row.status !== undefined &&
            isTerminalExecutionPhase(row.status.phase),
          row.status?.completedAt ?? "",
          now,
        ),
      };
    }
    case "workflow-execution": {
      const row = await getRow(
        store,
        ApiResourceKind.workflow_execution,
        executionId,
        WorkflowExecutionSchema,
      );
      if (row === undefined) {
        return undefined;
      }
      return {
        kind,
        executionId,
        org: row.metadata?.org ?? "",
        createdBy: creatorStampOf(WorkflowExecutionSchema, row),
        sessionId: "",
        live: isLive(
          row.status !== undefined &&
            isTerminalWorkflowExecutionPhase(row.status.phase),
          row.status?.completedAt ?? "",
          now,
        ),
      };
    }
    default: {
      const exhaustive: never = kind;
      throw new Error(`unknown bound execution kind ${String(exhaustive)}`);
    }
  }
}

/** A row with no status has not started, which is live. */
function isLive(terminal: boolean, completedAt: string, now: number): boolean {
  if (!terminal) {
    return true;
  }
  const finishedAt = Date.parse(completedAt);
  if (Number.isNaN(finishedAt)) {
    return false;
  }
  return now - finishedAt < RUN_CREDENTIAL_GRACE_AFTER_TERMINAL_MS;
}

function creatorStampOf(
  schema: typeof AgentExecutionSchema | typeof WorkflowExecutionSchema,
  row: Message,
): string {
  return auditOf(schema, row)?.specAudit?.createdBy?.id ?? "";
}

async function getRow<
  Desc extends typeof AgentExecutionSchema | typeof WorkflowExecutionSchema,
>(store: BoundExecutionStore, kind: ApiResourceKind, id: string, schema: Desc) {
  try {
    return await store.getResource(kind, id, schema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw error;
  }
}
