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
 *     sandbox again before the turn carries on (stigmer-cloud#1558).
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
  const idleMs = input.now.getTime() - input.lastActiveAt.getTime();
  return idleMs >= input.suspendAfterMs ? "suspend" : "none";
}
