/**
 * Pins the one rule for how an RPC ended (../rpc-end.ts), the decision
 * the logging interceptor, the request metrics and the error boundary all
 * read, so the log and the numbers cannot drift apart
 * (stigmer/stigmer#2890):
 *
 *   - with a live signal the outcome decides: a completed call is
 *     completed, a throw is a failure carrying its error, a stream the
 *     consumer stopped is stopped;
 *   - a signal aborted with any code but DeadlineExceeded is a departure
 *     carrying that code, whatever the call did, and a call that threw
 *     keeps its error on it; the one exception is a unary success, which
 *     did its whole job and stays completed;
 *   - the raw error of a write that itself aborted the signal reads
 *     Unknown, the code connect gives a raw reason;
 *   - a deadline is not a departure: a stream that ended on its abort,
 *     however it ended, is a failure carrying the deadline's reason, a
 *     throw under it keeps its own error, and a unary success under it
 *     stays completed;
 *   - `departureCode` answers the departure alone: the abort's code, or
 *     undefined while the call runs and when its deadline ended it.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { classifyRpcEnd, departureCode } from "../rpc-end.js";
import type { Outcome } from "../rpc-end.js";

const live = (): AbortSignal => new AbortController().signal;

function abortedWith(reason?: unknown): AbortSignal {
  const controller = new AbortController();
  if (reason === undefined) {
    controller.abort();
  } else {
    controller.abort(reason);
  }
  return controller.signal;
}

const DEADLINE = new ConnectError("the operation timed out", Code.DeadlineExceeded);
const RESET = new ConnectError("socket hang up", Code.Aborted);

const UNARY_SUCCESS: Outcome = { ended: "completed", stream: false };
const STREAM_COMPLETED: Outcome = { ended: "completed", stream: true };
const STOPPED: Outcome = { ended: "stopped" };

describe("classifyRpcEnd with a live signal", () => {
  it("is completed for a unary success and for a stream that ran to its end", () => {
    expect(classifyRpcEnd(live(), UNARY_SUCCESS)).toEqual({ end: "completed" });
    expect(classifyRpcEnd(live(), STREAM_COMPLETED)).toEqual({
      end: "completed",
    });
  });

  it("is a failure carrying the thrown error", () => {
    const error = new ConnectError("engine went away", Code.Unavailable);
    expect(classifyRpcEnd(live(), { ended: "threw", error })).toEqual({
      end: "failed",
      error,
    });
  });

  it("is stopped for a stream the consumer closed before its end", () => {
    expect(classifyRpcEnd(live(), STOPPED)).toEqual({ end: "stopped" });
  });
});

describe("classifyRpcEnd after the caller left", () => {
  it("is a departure with Canceled for an abort with no reason, for a stream that returned on it", () => {
    expect(classifyRpcEnd(abortedWith(), STREAM_COMPLETED)).toEqual({
      end: "departed",
      code: Code.Canceled,
      thrown: undefined,
    });
  });

  it("is a departure with the reset's code for a stream the consumer stopped", () => {
    expect(classifyRpcEnd(abortedWith(RESET), STOPPED)).toEqual({
      end: "departed",
      code: Code.Aborted,
      thrown: undefined,
    });
  });

  it("is a departure that keeps the thrown error, for a write that failed after the reset", () => {
    const error = new Error("write after close");
    expect(
      classifyRpcEnd(abortedWith(RESET), { ended: "threw", error }),
    ).toEqual({ end: "departed", code: Code.Aborted, thrown: { error } });
  });

  it("reads Unknown when the failed write itself aborted the signal", () => {
    const error = new Error("write EPIPE");
    expect(classifyRpcEnd(abortedWith(error), { ended: "threw", error })).toEqual(
      { end: "departed", code: Code.Unknown, thrown: { error } },
    );
  });

  it("keeps a unary success completed: it did its whole job", () => {
    expect(classifyRpcEnd(abortedWith(), UNARY_SUCCESS)).toEqual({
      end: "completed",
    });
  });
});

describe("classifyRpcEnd under a deadline", () => {
  it("is a failure carrying the deadline's reason for a stream that returned on it", () => {
    expect(classifyRpcEnd(abortedWith(DEADLINE), STREAM_COMPLETED)).toEqual({
      end: "failed",
      error: DEADLINE,
    });
  });

  it("is a failure carrying the deadline's reason for a stream the consumer stopped", () => {
    expect(classifyRpcEnd(abortedWith(DEADLINE), STOPPED)).toEqual({
      end: "failed",
      error: DEADLINE,
    });
  });

  it("is a failure carrying the thrown error, not the reason, for a throw under it", () => {
    const error = new ConnectError("store read timed out", Code.DeadlineExceeded);
    expect(
      classifyRpcEnd(abortedWith(DEADLINE), { ended: "threw", error }),
    ).toEqual({ end: "failed", error });
  });

  it("keeps a unary success completed", () => {
    expect(classifyRpcEnd(abortedWith(DEADLINE), UNARY_SUCCESS)).toEqual({
      end: "completed",
    });
  });
});

describe("departureCode", () => {
  it("is undefined while the call runs", () => {
    expect(departureCode(live())).toBeUndefined();
  });

  it("is undefined when the caller's deadline ended the call", () => {
    expect(departureCode(abortedWith(DEADLINE))).toBeUndefined();
  });

  it("is the abort's code when the caller left", () => {
    expect(departureCode(abortedWith())).toBe(Code.Canceled);
    expect(departureCode(abortedWith(RESET))).toBe(Code.Aborted);
    expect(departureCode(abortedWith(new Error("write EPIPE")))).toBe(
      Code.Unknown,
    );
  });
});
