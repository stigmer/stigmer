// The words of the terminal's working line and of the line a turn leaves
// when it ends, from the derivation the browser's activity line reads too
// (`describeTurnActivity` and `activityPhrase` in @stigmer/client), so both
// surfaces say the same thing about the same turn.
//
// - While a turn works: what it is doing now and for how long, "Running a
//   command · 1m 12s". Stopping, waiting on the person, and slowness take the
//   phrase over, in that order.
// - When a turn completes: "Worked for 1m 12s", one quiet line left in the
//   history. A failed or stopped turn keeps its badge instead.
//
// A span of time reads as `formatElapsed` in @stigmer/client writes it, the
// one format every terminal surface shares ("1h 3m", never "63m 0s").
//
// Proven by __tests__/working-line.test.tsx.

import { activityPhrase, describeTurnActivity, formatElapsed, type Turn } from "@stigmer/client";

/** What the working line says at one instant. */
export interface WorkingWords {
  /** What the turn is doing, in present-tense words. */
  readonly phrase: string;
  /** How long it has worked ("1m 12s"); "" when the log stamps no start. */
  readonly elapsed: string;
  /** Whether the turn waits on the person rather than working. */
  readonly waiting: boolean;
}

/** What the conversation says about the turn beside its events. */
export interface WorkingState {
  /** A stop was asked for and the turn is winding down. */
  readonly isStopping?: boolean;
  /** The turn has gone quiet for longer than usual. */
  readonly isSlow?: boolean;
}

/** The phrase a slow turn reads. */
export const SLOW_PHRASE = "Still working, taking longer than usual";
/** The phrase a turn that is being stopped reads. */
export const STOPPING_PHRASE = "Stopping…";

/** The working line's words for `turn` at `nowMs` (module header); a turn not yet folded reads "Starting". */
export function workingWords(turn: Turn | null, nowMs: number, state: WorkingState = {}): WorkingWords {
  if (turn === null) return { phrase: state.isStopping === true ? STOPPING_PHRASE : "Starting", elapsed: "", waiting: false };
  const progress = describeTurnActivity(turn, nowMs);
  const waiting = progress.activity.kind === "waiting_for_you";
  const elapsed = progress.startedAt === "" ? "" : formatElapsed(progress.elapsedMs);
  if (state.isStopping === true) return { phrase: STOPPING_PHRASE, elapsed, waiting: false };
  if (waiting) return { phrase: activityPhrase(progress.activity), elapsed, waiting };
  if (state.isSlow === true) return { phrase: SLOW_PHRASE, elapsed, waiting };
  return { phrase: activityPhrase(progress.activity), elapsed, waiting };
}

/**
 * The line a completed turn leaves in the history, "Worked for 1m 12s"; ""
 * when the turn did not complete or took under a second, which is not worth
 * a line (a turn the log stamps no start for counts no time).
 */
export function workedWords(turn: Turn): string {
  if (!turn.ended || turn.status?.phase !== "completed") return "";
  const { elapsedMs } = describeTurnActivity(turn, Date.parse(turn.status.processedAt));
  return elapsedMs < 1000 ? "" : `Worked for ${formatElapsed(elapsedMs)}`;
}
