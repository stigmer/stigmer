/**
 * The one way a turn is told to stop, and the runtime's record of why.
 *
 * The adapter contract gives an engine ONE signal (`TurnSink.stopSignal`) for
 * every cause of stopping and forbids it to branch on the cause; the runtime
 * keeps the cause here, as evidence its terminal table reads after the
 * adapter settles `interrupted`. Six producers abort the signal: the stall
 * watchdog, the open-operation backstop on the watchdog's timer
 * (`open-operations.ts`), a eval-run try's mock (`shared/eval-case/mock-endpoint.ts`:
 * an input guard violated, an agent mock ending the run, the agent mocks'
 * budget spent), the usage accumulator's cost cap, the persist chokepoint's
 * platform STOP, and Temporal's own cancellation (a pause, a worker
 * shutdown, a heartbeat timeout — told apart later from the signal's reason,
 * `shared/worker-shutdown.ts`). The first cause wins the abort; every cause
 * is recorded, because the table's precedence (stall, then the operation
 * limit, over mock abort over cost cap over cancellation over platform
 * stop) is decided at settlement,
 * not at abort.
 *
 * Nothing here is engine-specific and nothing here persists; the Cursor
 * orchestrator kept the same facts as flags on its stream state
 * (`turn-stream.ts` `TurnStreamState`, before #1070 moved them out).
 *
 * A yield is not a stop. When the runner drains, the turn is asked to stop
 * at its engine's next durable step boundary so the next runner continues
 * it where it was (`TurnSink.yieldSignal`, stigmer#2428): the running step
 * finishes first. A second signal to the runner (the yield cannot wait any
 * longer) stops the turn now through the one stop signal, cause
 * `yield-now`; either way the evidence names the yield's cause, and the
 * terminal table continues the turn.
 */

import type { StallTimeoutError } from "../shared/stall-watchdog.js";
import type { OperationLimitError } from "./open-operations.js";
import type { ContinuationCause } from "./terminal-table.js";

/** Why the runtime stopped the turn. */
export type StopCause =
  | { readonly kind: "stall"; readonly error: StallTimeoutError }
  | { readonly kind: "operation-limit"; readonly error: OperationLimitError }
  | { readonly kind: "mock-abort"; readonly abort: MockAbort }
  | { readonly kind: "cost-cap" }
  | { readonly kind: "platform-stop" }
  | { readonly kind: "cancellation" }
  /** A requested yield that cannot wait for the engine's boundary any longer (the runner was signalled again). */
  | { readonly kind: "yield-now" };

/** Which mock stopped a eval-run try, and why. */
export interface MockAbort {
  /** The mocked server's key in the plugin's MCP configuration. */
  readonly server: string;
  readonly tool: string;
  readonly reason: string;
}

/** What the terminal table reads. Each field is set by the first cause of its kind and never cleared. */
export interface StopEvidence {
  readonly stall: StallTimeoutError | undefined;
  readonly operationLimit: OperationLimitError | undefined;
  readonly mockAbort: MockAbort | undefined;
  readonly costCapExceeded: boolean;
  readonly platformStop: boolean;
  /** Temporal delivered a cancellation; its reason is on the cancellation signal itself. */
  readonly cancellation: boolean;
  /** Why the runtime asked the engine to yield so the turn continues; `undefined` when it never asked. */
  readonly yieldCause: ContinuationCause | undefined;
}

export class StopController {
  private readonly controller = new AbortController();
  private readonly yieldController = new AbortController();
  private stall: StallTimeoutError | undefined;
  private operationLimit: OperationLimitError | undefined;
  private mockAbort: MockAbort | undefined;
  private costCapExceeded = false;
  private platformStop = false;
  private cancellation = false;
  private yieldCause: ContinuationCause | undefined;

  /** The adapter's `stopSignal`. Its `reason` is the first cause's kind, a diagnostic only. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** The adapter's `yieldSignal`: stop at the engine's next durable step boundary. */
  get yieldSignal(): AbortSignal {
    return this.yieldController.signal;
  }

  /** Ask the engine to yield, recording why (the first cause wins; the signal aborts once). */
  requestYield(cause: ContinuationCause): void {
    this.yieldCause ??= cause;
    if (!this.yieldController.signal.aborted) this.yieldController.abort(cause);
  }

  get evidence(): StopEvidence {
    return {
      stall: this.stall,
      operationLimit: this.operationLimit,
      mockAbort: this.mockAbort,
      costCapExceeded: this.costCapExceeded,
      platformStop: this.platformStop,
      cancellation: this.cancellation,
      yieldCause: this.yieldCause,
    };
  }

  /** Record a cause and abort the signal (idempotent per cause; the signal aborts once). */
  stop(cause: StopCause): void {
    switch (cause.kind) {
      case "stall":
        this.stall ??= cause.error;
        break;
      case "operation-limit":
        this.operationLimit ??= cause.error;
        break;
      case "mock-abort":
        this.mockAbort ??= cause.abort;
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
      case "yield-now":
        // Its evidence is the yield's own cause, recorded when it was asked.
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
