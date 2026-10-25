/**
 * The idle ladder's decision for one session's sandbox, as a pure
 * function kept apart from the calls it leads to, so every case is a row
 * in a table test: what the sweep should do to it now, from its state,
 * whether its session is busy, and when the session was last active.
 *
 *   - A busy session is never touched: a run that is pending, running,
 *     waiting on a person or paused keeps its sandbox running.
 *   - running and idle for `suspendAfter`: suspend (the sandbox stopped,
 *     its workspace kept on its node and copied to storage in the
 *     background; the next wakeup starts a fresh runner over it, on its
 *     node or, once that is gone, on any worker).
 *   - Every other state is mid-transition or already asleep: nothing.
 */
import type { SubstrateSandboxState } from "./driver.js";

export type IdleAction = "none" | "suspend";

export interface IdleInput {
  readonly state: SubstrateSandboxState;
  readonly busy: boolean;
  readonly lastActiveAt: Date;
  readonly now: Date;
  readonly suspendAfterMs: number;
}

export function decideIdle(input: IdleInput): IdleAction {
  if (input.busy || input.state !== "running") {
    return "none";
  }
  const idleMs = input.now.getTime() - input.lastActiveAt.getTime();
  return idleMs >= input.suspendAfterMs ? "suspend" : "none";
}
