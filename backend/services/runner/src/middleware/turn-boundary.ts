/**
 * The turn boundary: where a Stigmer-harness graph stops when the runtime
 * asks it to, taken at the model call, inside the engine.
 *
 * Why inside the engine: the loop that reads the graph's events
 * (`execute-deep-agent/turn-stream.ts`) is not the graph. LangGraph buffers
 * the event stream and the graph runs on while the loop is busy (most often
 * while it awaits a persist), so a stop the loop takes can land after the
 * graph has saved steps the session's log never received (stigmer#2469). A
 * check at the model call stops the graph exactly there, whatever the loop's
 * lag; the loop then reads every event the graph produced before it, so the
 * log holds everything the engine did and nothing starts after the stop.
 *
 * What it checks:
 *  - the turn's stop (`TurnSink.stopSignal`), in every graph: no new model
 *    round starts after a pause, a cancel or any other stop;
 *  - the turn's yield (`TurnSink.yieldSignal`, a draining runner), in the
 *    root graph only. The root's model call is a durable step boundary:
 *    each step is saved before the next starts (`durability: "sync"`), so
 *    the next runner resumes from it. A sub-agent's rounds are not: its work
 *    is saved only when its `task` step ends, so a drained turn lets its
 *    sub-agents finish and yields at the root's next round.
 *
 * The stop is a thrown {@link TurnBoundaryHalt}, never a jump to the graph's
 * end: a halted step is not saved, so the next runner's resume (`null`)
 * starts at the model call the halt refused. In a sub-agent the halt fails
 * its `task` step, which deepagents lets through; the error-hints
 * middleware rethrows it rather than turn it into the task's answer
 * (`error-hints.ts`).
 *
 * First in Stigmer's stack, the parent's and each sub-agent's: no Stigmer
 * model wrapper runs for a call the boundary refuses. (The framework's
 * to-do list rides ahead of it on the parent, `turn-setup.ts`; it only
 * shapes the request.)
 */

import type { StigmerMiddleware } from "./types.js";

/** The turn's two requests to stop, as the runtime hands them to the adapter (`TurnSink`). */
export interface TurnBoundarySignals {
  readonly stopSignal: AbortSignal;
  readonly yieldSignal: AbortSignal;
}

/** Which graph the boundary guards: the root takes the stop and the yield, a sub-agent the stop only (the header). */
export type TurnBoundaryScope = "root" | "subagent";

/** Thrown at a model call the turn's stop or yield refuses; the stream loop settles it `interrupted`. */
export class TurnBoundaryHalt extends Error {
  constructor(readonly scope: TurnBoundaryScope) {
    super(`turn boundary: the ${scope === "root" ? "agent" : "sub-agent"} was stopped before its next model call`);
    this.name = "TurnBoundaryHalt";
  }
}

/**
 * Whether `err` is a halt, however it was wrapped on its way out: langchain
 * wraps an error a middleware throws in its own `MiddlewareError`, keeping
 * the original as `cause` (langchain 1.5.14, `agents/errors.js`), and a
 * sub-agent's halt is wrapped again by the parent's `task` step.
 */
export function isTurnBoundaryHalt(err: unknown): boolean {
  for (let current = err, depth = 0; current instanceof Error && depth < MAX_CAUSE_DEPTH; current = current.cause, depth++) {
    if (current instanceof TurnBoundaryHalt) return true;
  }
  return false;
}

/** How deep {@link isTurnBoundaryHalt} follows `cause`: a sub-agent's halt is two wraps deep; the bound only guards a cycle. */
const MAX_CAUSE_DEPTH = 8;

/** Whether a model call in a graph of `scope` is refused now. */
export function haltsAtModelCall(signals: TurnBoundarySignals, scope: TurnBoundaryScope): boolean {
  return signals.stopSignal.aborted || (scope === "root" && signals.yieldSignal.aborted);
}

/** The boundary for one graph of the turn. */
export function createTurnBoundaryMiddleware(signals: TurnBoundarySignals, scope: TurnBoundaryScope): StigmerMiddleware {
  return {
    name: scope === "root" ? "StigmerTurnBoundary" : "StigmerSubAgentTurnBoundary",
    wrapModelCall(request, handler) {
      if (haltsAtModelCall(signals, scope)) throw new TurnBoundaryHalt(scope);
      return handler(request);
    },
  };
}
