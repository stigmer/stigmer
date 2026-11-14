// How the session stands, in the words of its title's status pill: what its
// newest turn is doing or how it ended, in the kit's status hues. Blue while
// the agent works, amber while it waits for a person or paused at a limit,
// green once done, red when it didn't finish, grey before it starts and once
// a person or the platform stopped it. The session's header reads it.
//
// An ended turn's pill is its ending's (`describeTurnEnding`), so the pill
// and the notice under the turn say the same thing: a spending cap reads
// amber "Paused at its spending cap" in both places.

import { describeTurnEnding, type Turn, type TurnEndingTone } from "@stigmer/client";
import type { StatusPhase } from "../resource-workbench/types.js";

/** The pill's hue and words, and whether its words carry the turn's ticking time. */
export interface SessionStatusView {
  readonly phase: StatusPhase;
  readonly label: string;
  /** True while the turn runs or waits: the pill reads its time beside its words. */
  readonly timed: boolean;
}

/**
 * How the session stands from its newest turn; undefined before it has one.
 * `decides` is whether this reader answers what the turn waits on: one who
 * cannot (an observer, a participant) reads that it waits for an answer, not
 * for them.
 */
export function sessionStatus(last: Turn | undefined, decides: boolean): SessionStatusView | undefined {
  if (last === undefined) return undefined;
  const phase = last.status?.phase;
  if (!last.ended) {
    if (last.asks.length > 0 || phase === "waiting") {
      return { phase: "degraded", label: decides ? "Waiting for you" : "Waiting for an answer", timed: true };
    }
    if (phase === "paused") return { phase: "degraded", label: "Paused", timed: true };
    if (phase === undefined || phase === "pending") return { phase: "pending", label: "Starting", timed: true };
    return { phase: "running", label: "Working", timed: true };
  }
  const ending = describeTurnEnding({
    turn: last,
    viewer: { canManageProviders: false, canOpenAgent: false, canAct: false, stoppedIt: decides },
  });
  if (ending !== undefined) return { phase: TONE_PHASES[ending.tone], label: ending.pill, timed: false };
  return { phase: "ready", label: "Done", timed: false };
}

/** The pill's hue for an ending's tone. */
const TONE_PHASES: Readonly<Record<TurnEndingTone, StatusPhase>> = {
  failed: "failed",
  paused: "degraded",
  stopped: "pending",
};
