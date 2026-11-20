/**
 * The idle ladder's decision for one session's sandbox, as a pure
 * function kept apart from the calls it leads to, so every case is a row
 * in a table test: what the sweep should do to it now, from its state,
 * whether its session is busy, when the session was last active, and
 * whether its worker is leaving.
 *
 *   - A busy session is never touched: a run that is pending or running
 *     keeps its sandbox running. A turn parked on a person's answer or a
 *     pause does not (domain/run/phases.ts `keepsSandboxAwake`): it
 *     sleeps like an idle session, and the run workflow asks for the
 *     sandbox again before the turn carries on (stigmer#3122).
 *   - running and idle for `suspendAfter`: suspend (the sandbox stopped,
 *     its workspace kept on its node and copied to storage in the
 *     background; the next wakeup starts a fresh runner over it, on its
 *     node or, once that is gone, on any worker).
 *   - Every other state is mid-transition or already asleep: nothing.
 *
 * On a draining worker (`drainingSince`: when this server first saw the
 * worker draining) the node is going away, so a background copy could be
 * lost with it, and the sandbox is stored instead: suspended durably,
 * returning once its workspace is in storage. A running sandbox is stored
 * as soon as its session is not busy, whatever its idle window, so a
 * lively conversation sleeps in the gap between two turns and its next
 * message wakes it on a healthy worker. A turn that runs on past
 * DRAIN_DEADLINE_MS is stored anyway: a suspend keeps no runner, so that
 * ends the turn, and its files are kept as they stood.
 *
 * A sandbox started under an older configuration (`outdated`: on another
 * template than the server's current one, driver.ts) may hold network
 * lanes this server no longer grants, so it is suspended as soon as its
 * session is not busy, whatever its idle window; its next wake starts the
 * current template's runner under the current policy (stigmer#2984). A
 * turn in flight is never cut for it: the pass after the turn ends puts
 * it to sleep. A draining worker still decides first, because a store
 * also keeps the files a leaving node would lose.
 *
 * A routine's fire (`routineFire`: a routine started the session) is a
 * fresh conversation for one run, so nobody is about to type into it: its
 * sandbox is suspended as soon as its session is not busy, whatever its
 * idle window, rather than holding a seat for the window after its run
 * ends. A fire parked on an approval sleeps too, and its workflow wakes it
 * before the turn carries on, as for any parked turn; a person who later
 * continues the conversation finds it asleep after each of their turns
 * too, which costs their next message a wake, never their files. A
 * draining worker still decides first, as for an outdated sandbox.
 */
import type { SubstrateSandboxState } from "./driver.js";
import { DRAIN_DEADLINE_MS } from "./limits.js";

/** `store` is a durable suspend, for a sandbox whose worker is leaving. */
export type IdleAction = "none" | "suspend" | "store";

export interface IdleInput {
  readonly state: SubstrateSandboxState;
  readonly busy: boolean;
  readonly lastActiveAt: Date;
  readonly now: Date;
  readonly suspendAfterMs: number;
  /** When this server first saw the sandbox's worker draining; absent when it is not. */
  readonly drainingSince?: Date;
  /** On another template than the server's current one (module header). */
  readonly outdated?: boolean;
  /** A routine's fire started the session (module header). */
  readonly routineFire?: boolean;
}

export function decideIdle(input: IdleInput): IdleAction {
  if (input.state !== "running") {
    return "none";
  }
  if (input.drainingSince !== undefined) {
    const drainingMs = input.now.getTime() - input.drainingSince.getTime();
    return !input.busy || drainingMs >= DRAIN_DEADLINE_MS ? "store" : "none";
  }
  if (input.busy) {
    return "none";
  }
  if (input.outdated === true || input.routineFire === true) {
    return "suspend";
  }
  const idleMs = input.now.getTime() - input.lastActiveAt.getTime();
  return idleMs >= input.suspendAfterMs ? "suspend" : "none";
}
