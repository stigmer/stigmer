/**
 * The execution a runner credential is bound to — the ONE reader every
 * consumer of the binding goes through, so the verifier (who is this
 * runner acting as?), the memory-capture capability (which session is
 * this run's?) and the values fetch (may this credential still read the
 * execution's values?) cannot answer "is this run live" three ways.
 *
 * A credential binds exactly TWO things, and the lane's vocabulary
 * names them (`BoundExecutionKind`):
 *
 *   - an agent execution — a RUN, whose row is the person's run and whose
 *     liveness is its phase;
 *   - an MCP connect (`mcp-connect`) — not an execution at all, but the
 *     connect attempt the connect lane records for one discovery
 *     (domain/mcpserver/connect-attempt.ts), named by the synthetic id
 *     that module and this one recognize through one predicate
 *     (domain/mcpserver/connect-execution-id.ts). The row records the
 *     person who asked for the connect, who the runner acts as when it
 *     reads that connect's values; the lane deletes the row when the
 *     connect settles, so the row's existence IS the binding's liveness,
 *     and its own expiry and the token's clock (every connect token
 *     carries `exp`) bound a row a crash left behind.
 *
 * Two questions, two functions, because the callers pay differently:
 *
 *   - `boundExecutionKindOf(id)`: which kind the binding names, read off
 *     the id alone — the contract's own `kind_meta` prefix table
 *     (pipeline/apiresource-meta.ts `kindByIdPrefix`) for the run, the
 *     connect predicate for the other — with no store read. A session's
 *     or an agent's id, a foreign prefix, or garbage is `undefined`, and
 *     the caller refuses with its own sentence. The context write guard
 *     asks only this, synchronously, so it must stay free of I/O.
 *   - `loadBoundExecution(store, id)`: the row's facts the lane needs and
 *     nothing else — the creator stamp the verifier resolves a person
 *     from, the org and session the capture capability scopes with, and
 *     LIVENESS. One read (a primary key for a run, and for a connect's
 *     attempt); a missing row is `undefined` (the credential is
 *     invalid — the run is not the caller's to learn about); any other
 *     store failure propagates as the fault it is (the store-fault
 *     mapping), so an outage never reads as a bad credential.
 *
 * Liveness is the row's, not a clock's, and it is the same rule on both
 * lanes that accept a run credential: a run is live while its phase is
 * not terminal — a run waits on humans with no timeout, so no clock could
 * bound it — and for RUN_CREDENTIAL_GRACE_AFTER_TERMINAL_MS after the
 * moment the row says it finished (`status.completed_at`), because two
 * legitimate runner writes trail the terminal stamp (constants.ts). A
 * terminal row that does not say when it finished gets no grace: fail
 * closed. The terminal set is the run domain's own predicate
 * (run/phases.ts), never restated here. A RECOVERED execution is live again, and so is its credential —
 * the same principal set as the token in Temporal history (the operator
 * who runs the engine and holds the signing key).
 *
 * One more rule both no-`exp` lanes share, `bindsARun(kind)`: a RUN
 * credential — the no-`exp` token the dispatch mints (runnerauth.ts) —
 * may bind only a run. No mint produces a clockless token for a connect,
 * so a token shaped that way is refused by the verifier and by the values
 * fetch, through this one predicate rather than two restatements of it.
 */
import type { Message } from "@bufbuild/protobuf";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { isTerminalExecutionPhase } from "../domain/run/phases.js";
import { isConnectExecutionId } from "../domain/mcpserver/connect-execution-id.js";
import { kindByIdPrefix } from "../pipeline/apiresource-meta.js";
import { auditOf } from "../pipeline/steps/defaults.js";
import type { Store } from "../store/interface.js";
import { ResourceNotFoundError } from "../store/interface.js";
import { sessionIdOf } from "../domain/run/target.js";
import { RUN_CREDENTIAL_GRACE_AFTER_TERMINAL_MS } from "./constants.js";

/** The two things a runner credential can bind — the lane's own vocabulary, not the enum's. */
export type BoundExecutionKind = "agent-execution" | "mcp-connect";

/** The facts the lane reads off a bound execution's row. */
export interface BoundExecution {
  readonly kind: BoundExecutionKind;
  readonly executionId: string;
  /** `metadata.org` — the capture capability scopes a memory to it. */
  readonly org: string;
  /** The creator stamp as written: an account id since 3.15.0, a raw issuer subject before. */
  readonly createdBy: string;
  /** The agent execution's session; empty for a connect, which has none. */
  readonly sessionId: string;
  /** Not terminal, or terminal within the grace (see the header); a connect's row exists. */
  readonly live: boolean;
}

export type BoundExecutionStore = Pick<Store, "getResource" | "connectAttempts">;

export function boundExecutionKindOf(
  executionId: string,
): BoundExecutionKind | undefined {
  switch (kindByIdPrefix(executionId)) {
    case ApiResourceKind.run:
      return "agent-execution";
    default:
      return isConnectExecutionId(executionId) ? "mcp-connect" : undefined;
  }
}

/** Whether a binding of this kind is a RUN — the only thing a no-`exp` credential may name (see the header). */
export function bindsARun(kind: BoundExecutionKind): boolean {
  switch (kind) {
    case "agent-execution":
      return true;
    case "mcp-connect":
      return false;
    default: {
      const exhaustive: never = kind;
      throw new Error(`unknown bound execution kind ${String(exhaustive)}`);
    }
  }
}

/**
 * Loads the bound execution's facts; `undefined` when the id names no
 * binding kind or no row. `now` is injectable for the grace arms and
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
        ApiResourceKind.run,
        executionId,
        RunSchema,
      );
      if (row === undefined) {
        return undefined;
      }
      return {
        kind,
        executionId,
        org: row.metadata?.org ?? "",
        createdBy: creatorStampOf(RunSchema, row),
        sessionId: sessionIdOf(row.spec),
        live: isLive(
          row.status !== undefined &&
            isTerminalExecutionPhase(row.status.phase),
          row.status?.completedAt ?? "",
          now,
        ),
      };
    }
    case "mcp-connect": {
      // The connect's attempt, by its id. The row is deleted when the
      // connect settles, so its presence is the liveness; the token's
      // clock is enforced by `verify` before this.
      const attempt = await store.connectAttempts.findLive(
        executionId,
        Math.floor(now / 1000),
      );
      if (attempt === undefined) {
        return undefined;
      }
      return {
        kind,
        executionId,
        org: attempt.org,
        createdBy: attempt.createdBy,
        sessionId: "",
        live: true,
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

function creatorStampOf(schema: typeof RunSchema, row: Message): string {
  return auditOf(schema, row)?.specAudit?.createdBy?.id ?? "";
}

async function getRow<Desc extends typeof RunSchema>(
  store: BoundExecutionStore,
  kind: ApiResourceKind,
  id: string,
  schema: Desc,
) {
  try {
    return await store.getResource(kind, id, schema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw error;
  }
}
