/**
 * The idle ladder's decision for one session's sandbox, as a pure
 * function kept apart from the calls it leads to, so every case is a row
 * in a table test: what the sweep should do to it now, from its state,
 * whether its session is busy, and when the session was last active.
 *
 *   - A busy session is never touched: a run that is pending, running,
 *     waiting on a person or paused keeps its sandbox running.
 *   - RUNNING and idle for `pauseAfter`: pause (memory kept, wakes in about
 *     a second).
 *   - PAUSED and idle for `suspendAfter`: suspend (memory released, the
 *     workspace committed to storage; the next wakeup starts a fresh
 *     runner over it).
 *   - A RUNNING sandbox idle past `suspendAfter` is paused first and
 *     suspended on a later pass: one rule per step, and every suspend
 *     comes from PAUSED, where no turn can be in flight.
 *   - Every other state is mid-transition or already asleep: nothing.
 */
import { ActorState } from "./gen/ateapipb/ateapi_pb.js";

export type IdleAction = "none" | "pause" | "suspend";

export interface IdleInput {
  readonly state: ActorState;
  readonly busy: boolean;
  readonly lastActiveAt: Date;
  readonly now: Date;
  readonly pauseAfterMs: number;
  readonly suspendAfterMs: number;
}

export function decideIdle(input: IdleInput): IdleAction {
  if (input.busy) {
    return "none";
  }
  const idleMs = input.now.getTime() - input.lastActiveAt.getTime();
  switch (input.state) {
    case ActorState.RUNNING:
      return idleMs >= input.pauseAfterMs ? "pause" : "none";
    case ActorState.PAUSED:
      return idleMs >= input.suspendAfterMs ? "suspend" : "none";
    default:
      return "none";
  }
}
