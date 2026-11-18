/**
 * How an RPC ended: the one rule the serving chain's observers read, so
 * the log and the numbers cannot disagree on a call (stigmer/stigmer#2890).
 * The logging interceptor writes its line from it, the request metrics
 * label their record from it, and the error boundary asks it whether a
 * raw error belongs to a caller who already left. Before this module the
 * logging and metrics interceptors each decided the end themselves and
 * drifted: a closed console tab was "rpc cancelled" in the log and OK in
 * the numbers, the write that failed after it was UNKNOWN there, and a
 * stream that ended on its caller's deadline was an error in the log and
 * OK in the numbers.
 *
 * The departure rule. A caller that leaves (a closed console tab, a
 * dropped connection, the server's shutdown destroying open requests)
 * does not reach the handler as an error: connect aborts the request's
 * signal and the stream handlers return on it (domain/session/events/
 * stream.ts, attention.ts, transport/health.ts). So the departure is read
 * from `request.signal`: aborted with a reason whose code is not
 * DeadlineExceeded means the caller left, with the reason's code:
 * Canceled for a close with no reason, Aborted or Internal for a reset,
 * Unknown for the raw error of a write that failed first. It covers a
 * stream however it ended, a stream the consumer stopped early, and a
 * unary call that FAILED after the abort; a unary call that succeeded
 * after its caller left did its whole job and is completed. A call that
 * threw keeps its error on the departure, so the log still records a
 * real fault in a request its caller gave up on.
 *
 * A deadline is not a departure: the server ran out of the caller's
 * budget, so the call failed with DeadlineExceeded, the code its caller
 * received. A throw under it carries its own error; a stream that
 * returned or was stopped on the deadline's abort carries the signal's
 * reason.
 *
 * What the signal cannot tell apart: connect also aborts it, with no
 * reason, before it stops a stream it failed to send (a message over the
 * write limit, or one that cannot be encoded). That stream reads as a
 * departure with Canceled while its client receives the failure. Telling
 * the two apart needs connect itself.
 *
 * Private to the interceptor folder: not exported from src/index.ts.
 * Pinned by __tests__/rpc-end.test.ts.
 */
import { Code, ConnectError } from "@connectrpc/connect";

/**
 * How an RPC ended, as an interceptor saw it. `stopped` is a stream the
 * consumer closed before its end (connect aborts the signal first, so a
 * real one also reads as a departure).
 */
export type Outcome =
  | { readonly ended: "completed"; readonly stream: boolean }
  | { readonly ended: "stopped" }
  | { readonly ended: "threw"; readonly error: unknown };

/**
 * The decided end. `departed` carries the abort's code and, when the
 * call threw, its error; `failed` carries the error the caller received
 * (the thrown one, or the deadline's reason for a stream that ended on
 * it); `stopped` is a stream the consumer closed with the signal live.
 */
export type RpcEnd =
  | {
      readonly end: "departed";
      readonly code: Code;
      readonly thrown: { readonly error: unknown } | undefined;
    }
  | { readonly end: "failed"; readonly error: unknown }
  | { readonly end: "stopped" }
  | { readonly end: "completed" };

/**
 * The abort's code when the caller left; undefined while the call runs
 * and when its deadline ended it.
 */
export function departureCode(signal: AbortSignal): Code | undefined {
  if (!signal.aborted) {
    return undefined;
  }
  const code = ConnectError.from(signal.reason).code;
  return code === Code.DeadlineExceeded ? undefined : code;
}

export function classifyRpcEnd(signal: AbortSignal, outcome: Outcome): RpcEnd {
  // A unary success did its whole job, whatever the signal says.
  if (outcome.ended === "completed" && !outcome.stream) {
    return { end: "completed" };
  }
  const departed = departureCode(signal);
  if (departed !== undefined) {
    return {
      end: "departed",
      code: departed,
      thrown: outcome.ended === "threw" ? { error: outcome.error } : undefined,
    };
  }
  if (outcome.ended === "threw") {
    return { end: "failed", error: outcome.error };
  }
  if (signal.aborted) {
    // Aborted but not departed: the stream ended on its deadline.
    return { end: "failed", error: signal.reason };
  }
  if (outcome.ended === "stopped") {
    return { end: "stopped" };
  }
  return { end: "completed" };
}
