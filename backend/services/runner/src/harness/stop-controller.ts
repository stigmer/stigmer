/**
 * The one way a turn is told to stop, and the runtime's record of why.
 *
 * The adapter contract gives an engine ONE signal (`TurnSink.stopSignal`) for
 * every cause of stopping and forbids it to branch on the cause; the runtime
 * keeps the cause here, as evidence its terminal table reads after the
 * adapter settles `interrupted`. Four producers abort the signal: the stall
 * watchdog, the usage accumulator's cost cap, the persist chokepoint's
 * platform STOP, and Temporal's own cancellation (a pause, a worker
 * shutdown, a heartbeat timeout — told apart later from the signal's reason,
 * `shared/worker-shutdown.ts`). The first cause wins the abort; every cause
 * is recorded, because the table's precedence (stall over cost cap over
 * cancellation over platform stop) is decided at settlement, not at abort.
 *
 * Nothing here is engine-specific and nothing here persists; the Cursor
 * orchestrator kept the same facts as flags on its stream state
 * (`turn-stream.ts` `TurnStreamState`, before S2 M3 moved them out).
 */

import type { StallTimeoutError } from "../shared/stall-watchdog.js";

/** Why the runtime stopped the turn. */
export type StopCause =
  | { readonly kind: "stall"; readonly error: StallTimeoutError }
  | { readonly kind: "cost-cap" }
  | { readonly kind: "platform-stop" }
  | { readonly kind: "cancellation" };

/** What the terminal table reads. Each field is set by the first cause of its kind and never cleared. */
export interface StopEvidence {
  readonly stall: StallTimeoutError | undefined;
  readonly costCapExceeded: boolean;
  readonly platformStop: boolean;
  /** Temporal delivered a cancellation; its reason is on the cancellation signal itself. */
  readonly cancellation: boolean;
}

export class StopController {
  private readonly controller = new AbortController();
  private stall: StallTimeoutError | undefined;
  private costCapExceeded = false;
  private platformStop = false;
  private cancellation = false;

  /** The adapter's `stopSignal`. Its `reason` is the first cause's kind, a diagnostic only. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get evidence(): StopEvidence {
    return {
      stall: this.stall,
      costCapExceeded: this.costCapExceeded,
      platformStop: this.platformStop,
      cancellation: this.cancellation,
    };
  }

  /** Record a cause and abort the signal (idempotent per cause; the signal aborts once). */
  stop(cause: StopCause): void {
    switch (cause.kind) {
      case "stall":
        this.stall ??= cause.error;
        break;
      case "cost-cap":
        this.costCapExceeded = true;
        break;
      case "platform-stop":
        this.platformStop = true;
        break;
      case "cancellation":
        this.cancellation = true;
        break;
      default: {
        const exhaustive: never = cause;
        throw new Error(`StopController: unknown stop cause ${JSON.stringify(exhaustive)}`);
      }
    }
    if (!this.controller.signal.aborted) {
      this.controller.abort(cause.kind);
    }
  }
}
