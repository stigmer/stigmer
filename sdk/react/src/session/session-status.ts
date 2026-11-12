// How the session stands, in the words of its title's status pill: what its
// newest turn is doing or how it ended, in the kit's status hues. Blue while
// the agent works, amber while it waits for a person, green once done, red
// when it didn't finish, grey before it starts and once a person stopped it.
// The session's header reads it; the words never come from anywhere else.
//
// A turn's failure has kinds (a refused key, a provider gone, a cap
// reached); the pill names none of them, only that the turn didn't finish:
// the failure's own notice under the turn says which.

import type { Turn } from "@stigmer/client";
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
    if (phase === undefined || phase === "pending") return { phase: "pending", label: "Starting", timed: false };
    return { phase: "running", label: "Working", timed: true };
  }
  if (phase === "completed") return { phase: "ready", label: "Done", timed: false };
  // A person's stop is a quiet end, as is a cancel no cause explains.
  const cause = last.status?.stopCause ?? "";
  if (phase === "cancelled" && (cause === "user" || cause === "")) return { phase: "pending", label: "Stopped", timed: false };
  return { phase: "failed", label: "Didn't finish", timed: false };
}
