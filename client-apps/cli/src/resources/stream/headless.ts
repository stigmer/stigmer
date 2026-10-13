// The headless stream driver: follow the session's event log, fold it, render
// it, and answer the turn's asks.
//
// One async loop over `followSession` (the session's whole log, then each new
// event): every stored event is handed to the renderer as it arrives (the
// NDJSON renderer writes it), folded by one `SessionLog`, and the fold is
// handed to the renderer after every change (the plaintext renderer draws from
// it). The loop ends when the followed turn has ended.
//
// Asks are answered when the session idles waiting on them (its
// `requires_action` idle names the tool uses), each once, with the run's
// `--approve-default` answer, retried through transient failures. A refused
// answer whose call no longer waits (a grant settled its class, or the turn
// ended) is settled, not failed; any other refusal ends the stream with an
// error naming how to re-attach.
//
// The follow never outlives the drive: it runs under a signal of the driver's
// own, joined to the caller's, aborted on every way out, so the open stream
// does not hold the process after the turn has ended.

import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { StreamSessionEventsResponse } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import {
  foldSession,
  SessionLog,
  turnOf,
  type SessionFold,
  type SessionStatusView,
  type ToolUse,
  type Turn,
} from "@stigmer/sdk";
import { answerFor, type ApproveDefault, type AskAnswer } from "./answer.js";
import {
  APPROVAL_RETRY_BASE_DELAY_MS,
  APPROVAL_RETRY_MAX_ATTEMPTS,
  classifyStreamError,
  isSettledAnswerError,
  retryWithBackoff,
} from "./submit.js";

/** A headless renderer: NdjsonRenderer and PlaintextRenderer. */
export interface HeadlessRenderer {
  /** One stored event, in log order, as it arrives. */
  event(event: SessionEvent): void;
  /** The fold, after every change. */
  fold(fold: SessionFold): void;
  /** An ask is about to be answered by the run's `--approve-default`. */
  answering(ask: ToolUse, choice: ApproveDefault, answer: AskAnswer): void;
}

/** How a headless stream ended. */
export interface HeadlessResult {
  /** The turn's phase word; "" when the stream ended before the turn did. */
  readonly phase: string;
  /** What went wrong with the stream; "" when nothing did. */
  readonly error: string;
  /** The followed turn, folded, when the stream reached it. */
  readonly turn: Turn | undefined;
}

/** Dependencies for {@link runHeadlessStream}. */
export interface HeadlessStreamDeps {
  /** The session's events from the start of its log (the SDK's followSession). */
  readonly follow: (signal: AbortSignal) => AsyncIterable<StreamSessionEventsResponse>;
  /** Send one answer for a tool use of the session. */
  readonly answer: (toolUseId: string, answer: AskAnswer) => Promise<void>;
  /** The run's `--approve-default`. */
  readonly approveDefault: ApproveDefault;
  readonly renderer: HeadlessRenderer;
  readonly sessionId: string;
  /** The turn the stream follows to its end. */
  readonly runId: string;
  readonly signal: AbortSignal;
}

const STOPPED: HeadlessResult = { phase: "", error: "", turn: undefined };

/**
 * Drive the stream until the followed turn ends and return how it ended.
 * Aborting (Ctrl-C) resolves cleanly with an empty result; a dropped stream or
 * a failed answer returns its message.
 */
export async function runHeadlessStream(deps: HeadlessStreamDeps): Promise<HeadlessResult> {
  const log = new SessionLog();
  const answered = new Set<string>();
  const own = new AbortController();
  const signal = AbortSignal.any([deps.signal, own.signal]);
  let handledIdle: SessionStatusView | undefined;
  try {
    for await (const frame of deps.follow(signal)) {
      if (frame.frame.case === "event") deps.renderer.event(frame.frame.value);
      if (!log.applyFrame(frame)) continue;
      const fold = log.snapshot();
      deps.renderer.fold(fold);
      const turn = turnOf(fold, deps.runId);
      if (turn === undefined) continue;
      if (turn.ended) return { phase: turn.status?.phase ?? "", error: turn.status?.error ?? "", turn };
      if (fold.status !== handledIdle && waitsOnAsks(fold.status)) {
        handledIdle = fold.status;
        const failure = await answerAsks(turn, fold.status, answered, deps, signal);
        if (failure !== undefined) return failure;
      }
    }
    return STOPPED;
  } catch (err) {
    if (deps.signal.aborted) return STOPPED;
    return { phase: "", error: classifyStreamError(err, deps.sessionId), turn: undefined };
  } finally {
    own.abort();
  }
}

/** Render a finished session's stored events: each event, then the fold of them all. */
export function renderReplay(events: readonly SessionEvent[], renderer: HeadlessRenderer): void {
  for (const event of events) renderer.event(event);
  renderer.fold(foldSession(events));
}

function waitsOnAsks(status: SessionStatusView): boolean {
  return status.state === "idle" && status.stopReason === "requires_action";
}

// Answer every ask of the turn the idle names and this drive has not answered.
// Returns the stream's failure when an answer fails for good.
async function answerAsks(
  turn: Turn,
  status: SessionStatusView,
  answered: Set<string>,
  deps: HeadlessStreamDeps,
  signal: AbortSignal,
): Promise<HeadlessResult | undefined> {
  const answer = answerFor(deps.approveDefault);
  for (const ask of turn.asks) {
    if (answered.has(ask.id) || !status.waitingOn.includes(ask.id)) continue;
    answered.add(ask.id);
    deps.renderer.answering(ask, deps.approveDefault, answer);
    try {
      await retryWithBackoff(signal, APPROVAL_RETRY_MAX_ATTEMPTS, APPROVAL_RETRY_BASE_DELAY_MS, () =>
        deps.answer(ask.id, answer),
      );
    } catch (err) {
      if (deps.signal.aborted) return STOPPED;
      if (isSettledAnswerError(err)) continue;
      let message = `Failed to answer the ${ask.name} call: ${err instanceof Error ? err.message : String(err)}`;
      if (deps.sessionId !== "") message += `. Re-attach to retry: stigmer resume ${deps.sessionId}`;
      return { phase: "", error: message, turn };
    }
  }
  return undefined;
}
