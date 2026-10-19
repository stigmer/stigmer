/**
 * Progress-based stall watchdog.
 *
 * Long-running agent turns are kept alive against Temporal by a periodic
 * keep-alive heartbeat (see {@link ./heartbeat.ts}). That heartbeat proves the
 * runner *process* is alive, but it says nothing about whether the agent is
 * making *progress*: a turn that wedges inside the harness stream loop (a tool
 * call that never returns, a model connection that silently dies) keeps
 * heartbeating forever and never times out. The execution then sits at
 * RUN_IN_PROGRESS indefinitely.
 *
 * This watchdog closes that gap. It is an *out-of-band* timer: callers report
 * progress via {@link StallWatchdog.recordActivity} on every stream event AND
 * every token delta, and the watchdog fires `onStall` once if no progress is
 * reported for `stallMs`. "Out-of-band" is the deliberate correctness property
 * — the check runs on its own timer rather than inside the consumer's loop, so
 * it catches a true "no new events for N minutes" hang. An in-band check that
 * only runs when the loop advances cannot fire while the loop is blocked
 * awaiting the next event, which is exactly the wedge we need to detect.
 *
 * One watchdog serves every harness: the turn runtime arms it around the
 * adapter's whole turn (`harness/run-turn.ts`, since #1070), with the
 * window `Config.cursorStreamStallTimeoutMs`.
 *
 * A turn that is working but silent is not a stall. While `held()` says an
 * operation is open (the runtime's fold, `harness/open-operations.ts`),
 * idle time does not accumulate: a ten-minute build that prints nothing is
 * work. The runtime records activity when the last operation closes, so the
 * window counts from there. What the window catches is the wedge: nothing
 * open and nothing arriving. An operation that never finishes is bounded by
 * its own deadline or by the runtime's backstop, which `onTick` runs on this
 * timer's cadence.
 */

/**
 * Thrown / reported when an agent stream makes no progress for longer than the
 * configured stall window. Carries the observed idle duration so callers can
 * build an actionable, recognizable error message.
 */
export class StallTimeoutError extends Error {
  constructor(
    public readonly stalledMs: number,
    detail?: string,
  ) {
    super(
      `Agent stream stalled: no activity for ${Math.round(stalledMs / 1000)}s` +
        (detail ? ` (${detail})` : ""),
    );
    this.name = "StallTimeoutError";
  }
}

/**
 * Recognizable prefix on every stall-induced failure message. Single source of
 * truth so callers (and any future UI/log keying) match on one constant.
 */
export const STALL_ERROR_PREFIX = "[StallTimeoutError]";

/**
 * Build the user-facing failure text for a stall. Keeps the canonical wording
 * (prefix + actionable "Retry or resume.") next to the error it describes.
 */
export function formatStallFailure(error: StallTimeoutError): string {
  return `${STALL_ERROR_PREFIX} ${error.message}. Retry or resume.`;
}

/** What the runtime layers onto the window. */
export interface StallWatchdogOptions {
  /** True while the turn is legitimately busy; idle time does not accumulate while it holds. */
  readonly held?: () => boolean;
  /** Run on every poll before the idle check, while the watchdog is armed. */
  readonly onTick?: () => void;
}

export interface StallWatchdog {
  /** Reset the idle timer. Call on every stream event AND every token delta. */
  recordActivity(): void;
  /** Disarm the watchdog. Idempotent; safe to call in a `finally`. */
  stop(): void;
}

/**
 * Start an out-of-band stall watchdog.
 *
 * @param stallMs  Idle window after which `onStall` fires.
 * @param onStall  Invoked at most once with the observed idle duration (ms)
 *                 when `Date.now() - lastActivityAt` exceeds `stallMs`. The
 *                 watchdog disarms itself before invoking, so `onStall` runs
 *                 exactly once even if its handler is slow.
 *
 * @param options  `held` and `onTick` ({@link StallWatchdogOptions}).
 *
 * The poll interval is `stallMs / 4` capped at 15s: frequent enough to detect a
 * stall promptly without busy-looping, and bounded so a large `stallMs` still
 * polls on a sane cadence.
 */
export function startStallWatchdog(
  stallMs: number,
  onStall: (idleMs: number) => void,
  options: StallWatchdogOptions = {},
): StallWatchdog {
  let lastActivityAt = Date.now();
  let fired = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tickMs = Math.min(Math.max(Math.floor(stallMs / 4), 1), 15_000);

  const disarm = (): void => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  timer = setInterval(() => {
    if (fired) return;
    options.onTick?.();
    if (fired) return;
    if (options.held?.()) {
      // Busy, not idle: the idle time restarts from now, and the close of the
      // last operation records activity on its own.
      lastActivityAt = Date.now();
      return;
    }
    const idleMs = Date.now() - lastActivityAt;
    if (idleMs >= stallMs) {
      fired = true;
      disarm();
      onStall(idleMs);
    }
  }, tickMs);
  // Do not keep the event loop alive solely for the watchdog.
  timer.unref?.();

  return {
    recordActivity(): void {
      lastActivityAt = Date.now();
    },
    stop(): void {
      fired = true;
      disarm();
    },
  };
}
