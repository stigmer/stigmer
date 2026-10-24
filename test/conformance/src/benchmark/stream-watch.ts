// Watches one turn through its session's event stream (`streamEvents`, the
// lane a console reads a conversation on) and stamps on the client's clock
// the instants the parity work is judged by: when the user first saw
// something (an agent message with text, or thinking, on the turn's primary
// thread, a live preview included), when the agent's edits were offered for
// review (the turn's stigmer.file_review.changes), and when the turn ended
// (its stigmer.run.status reaching an end phase).
//
// The end is the run's own `stigmer.run.status` in an end phase, never the
// fold's `ended` alone: the fold also reads a turn with no status of its own
// as ended while the session is idle, and a session's later turn shows its
// first events before the session reads as running again, so the idle the
// turn before it left would end its watch at once (stigmer#2536).
//
// Review never holds a turn: the edits land, the turn ends, and the offer is
// in the log beside it. So a watch always follows the turn to its end; the
// session driver (session.ts) decides on the offer afterwards.
// Domain: conformance benchmark (the client-clock axes).
//
// Consumption goes through `support/collect-stream.ts`, the one bounded
// reader of a server stream in this workspace; its `until` predicate runs at
// every arrival, so the receive stamps are taken there and the helper needs
// no second hook. Each frame is folded with @stigmer/session-log's
// `SessionLog` (previews included), the model every client reads. The stream
// can only open after `create()` has returned the session, so every axis
// here starts at the CREATE CALL's start, the instant the caller hands in:
// that is the console's own experience, and the runner's `turn_phases` line
// carries the precise activity-relative instants beside it.
import type { StreamSessionEventsResponse } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { SessionLog, turnOf, type Turn } from "@stigmer/session-log";
import type { ConformanceClients } from "../harness/clients";
import { collectStream, type CollectedStream } from "../support/collect-stream";
import { visibleRows } from "./status-facts";

export interface WatchOptions {
  /** `Date.now()` immediately before the create call the turn came from. */
  startedAtMs: number;
  /** How long to wait for the turn's end before giving up (the sample is then a `timeout`). */
  timeoutMs: number;
  /** Injected for tests; `Date.now` in production. */
  now?: () => number;
}

export interface WatchedTurn {
  /** Client clock, from `startedAtMs`; `null` when never seen. */
  client_first_visible_token_ms: number | null;
  client_first_text_ms: number | null;
  /** Client clock, from `startedAtMs`, when the turn's end arrived; `null` on timeout. */
  end_to_end_ms: number | null;
  /** Client clock, from `startedAtMs`, when the turn's edits were first offered for review; `null` when none were. */
  review_ready_ms: number | null;
  /** The turn as folded when the watch stopped; undefined when none of its events arrived. */
  turn: Turn | undefined;
  outcome: CollectedStream<StreamSessionEventsResponse>["outcome"];
}

/** The stream factory a watch consumes; the session's streamEvents by default, injectable for tests. */
export type EventStreamFactory = (signal: AbortSignal) => AsyncIterable<StreamSessionEventsResponse>;

/** The session's whole log, then its live events, with message and thinking previews. */
export function streamSessionEvents(clients: ConformanceClients, sessionId: string): EventStreamFactory {
  return (signal) =>
    clients.sessionQuery.streamEvents(
      { sessionId, afterSeq: 0n, eventDeltas: ["agent.message", "agent.thinking"] },
      { signal },
    );
}

export async function watchTurn(stream: EventStreamFactory, runId: string, options: WatchOptions): Promise<WatchedTurn> {
  const now = options.now ?? Date.now;
  const log = new SessionLog();
  let firstVisible: number | null = null;
  let firstText: number | null = null;
  let reviewAt: number | null = null;
  let endAt: number | null = null;
  let turn: Turn | undefined;

  const collected = await collectStream(stream, {
    timeoutMs: options.timeoutMs,
    until: (frames) => {
      const latest = frames[frames.length - 1];
      if (latest === undefined) return false;
      log.applyFrame(latest);
      turn = turnOf(log.snapshot(), runId);
      if (turn === undefined) return false;
      const at = now();
      const rows = visibleRows(turn);
      if (rows.visible && firstVisible === null) firstVisible = at;
      if (rows.text && firstText === null) firstText = at;
      if (reviewAt === null && turn.fileReview.length > 0) reviewAt = at;
      if (turn.ended && turn.status !== undefined) {
        endAt = at;
        return true;
      }
      return false;
    },
  });

  const relative = (at: number | null): number | null => (at === null ? null : at - options.startedAtMs);
  return {
    client_first_visible_token_ms: relative(firstVisible),
    client_first_text_ms: relative(firstText),
    end_to_end_ms: relative(endAt),
    review_ready_ms: relative(reviewAt),
    turn,
    outcome: collected.outcome,
  };
}
