/**
 * Pins the worker-shutdown classification (pkg/runnerfailure parity,
 * issue #776): the two message shapes that mean "infrastructure
 * interrupted the turn", matched exactly as the Go and Java control
 * planes match them, and the honest status.error copy every edition
 * shares; and the typed failure of a turn that stopped to continue
 * (stigmer#2428), matched by its type and never its text. The invoke
 * workflow's recovery loop and failure-path persist both key on these.
 */
import { ApplicationFailure, CancelledFailure } from "@temporalio/common";
import { describe, expect, it } from "vitest";

import {
  endsAsWorkerShutdown,
  modelStallCopyOf,
  streamCutCopyOf,
  isTurnContinuation,
  isWorkerShutdown,
  turnContinuationCauseOf,
  TURN_CONTINUES_FAILURE_TYPE,
  WORKER_SHUTDOWN_STATUS_ERROR,
} from "../runner-failure.js";

describe("isWorkerShutdown", () => {
  it("matches the runner's own shutdown classification in a cancelled failure", () => {
    expect(
      isWorkerShutdown(
        new CancelledFailure("Activity cancelled (worker shutdown, not user pause)"),
      ),
    ).toBe(true);
  });

  it("matches loose markers only inside CANCELLED failures (runner-authored text)", () => {
    expect(isWorkerShutdown(new CancelledFailure("shutting down"))).toBe(true);
    // The same loose text in a NON-cancelled failure could be agent/tool
    // output — it must NOT classify.
    expect(isWorkerShutdown(new Error("shutting down"))).toBe(false);
  });

  it("matches the Temporal TS worker's drain text in application failures", () => {
    expect(
      isWorkerShutdown(
        ApplicationFailure.create({
          message:
            "Worker is shutting down and this activity did not complete in time",
        }),
      ),
    ).toBe(true);
  });

  it("matches the drain text anywhere in the cause chain", () => {
    const wrapped = new Error("activity 'ExecuteDeepAgent' failed", {
      cause: ApplicationFailure.create({
        message: "Worker is shutting down and this activity did not complete in time",
      }),
    });
    expect(isWorkerShutdown(wrapped)).toBe(true);
  });

  it("does not classify ordinary failures", () => {
    expect(isWorkerShutdown(new Error("agent blew up"))).toBe(false);
    expect(
      isWorkerShutdown(ApplicationFailure.create({ message: "boom" })),
    ).toBe(false);
    expect(isWorkerShutdown(undefined)).toBe(false);
  });

  it("pins the honest cross-edition status.error copy", () => {
    expect(WORKER_SHUTDOWN_STATUS_ERROR).toBe(
      "Execution interrupted: runner worker was shut down. Retry or resume.",
    );
  });
});

/** The failure a runner's continuing turn throws, as the workflow receives it. */
function continues(cause: unknown, message = "The turn continues on the next invocation"): ApplicationFailure {
  return ApplicationFailure.create({ type: TURN_CONTINUES_FAILURE_TYPE, message, details: [cause] });
}

describe("turnContinuationCauseOf", () => {
  it("pins the type the runner throws", () => {
    expect(TURN_CONTINUES_FAILURE_TYPE).toBe("StigmerTurnContinues");
  });

  it("reads the cause of a continuing turn, anywhere in the cause chain", () => {
    expect(turnContinuationCauseOf(continues("drain"))).toBe("drain");
    expect(turnContinuationCauseOf(new Error("activity 'ExecuteDeepAgent' failed", { cause: continues("drain") }))).toBe("drain");
    expect(isTurnContinuation(continues("drain"))).toBe(true);
  });

  it("matches by type, never by text", () => {
    expect(turnContinuationCauseOf(ApplicationFailure.create({ message: "The turn continues on the next invocation" }))).toBeUndefined();
    expect(isTurnContinuation(continues("drain", "any words at all"))).toBe(true);
    expect(isTurnContinuation(new Error("StigmerTurnContinues"))).toBe(false);
    expect(isTurnContinuation(undefined)).toBe(false);
  });

  it("still reads a continuation whose cause is unknown or missing", () => {
    expect(turnContinuationCauseOf(continues("something-new"))).toBe("something-new");
    expect(turnContinuationCauseOf(continues(42))).toBe("");
  });
});

describe("endsAsWorkerShutdown", () => {
  it("gives a drained turn the workflow stopped recovering the shutdown's ending, in either shape", () => {
    expect(endsAsWorkerShutdown(continues("drain"))).toBe(true);
    expect(endsAsWorkerShutdown(new CancelledFailure("Activity cancelled (worker shutdown, not user pause)"))).toBe(true);
    expect(endsAsWorkerShutdown(continues("something-new"))).toBe(false);
    expect(endsAsWorkerShutdown(new Error("agent blew up"))).toBe(false);
  });
});

describe("modelStallCopyOf", () => {
  const STALL = "[StallTimeoutError] Agent stream stalled: no activity for 180s. Retry or resume.";

  it("reads the runner's own stall copy off a model stall's continuation, however wrapped", () => {
    expect(modelStallCopyOf(continues("model-stall", STALL))).toBe(STALL);
    expect(modelStallCopyOf(new Error("activity 'ExecuteDeepAgent' failed", { cause: continues("model-stall", STALL) }))).toBe(STALL);
  });

  it("is undefined for a drain's continuation and for any other failure", () => {
    expect(modelStallCopyOf(continues("drain"))).toBeUndefined();
    expect(modelStallCopyOf(new Error("agent blew up"))).toBeUndefined();
    expect(modelStallCopyOf(ApplicationFailure.create({ type: "Other", message: STALL, details: ["model-stall"] }))).toBeUndefined();
  });

  it("is not a worker shutdown's ending", () => {
    expect(endsAsWorkerShutdown(continues("model-stall", STALL))).toBe(false);
  });
});

describe("streamCutCopyOf", () => {
  const CUT = "[unknown] [canceled] http/2 stream closed with error code CANCEL (0x8) [category=stream-cut, source=sdk, retryable=true]";

  it("reads the runner's words for the cut off a cut connection's continuation, however wrapped", () => {
    expect(turnContinuationCauseOf(continues("stream-cut", CUT))).toBe("stream-cut");
    expect(streamCutCopyOf(continues("stream-cut", CUT))).toBe(CUT);
    expect(streamCutCopyOf(new Error("activity 'ExecuteCursor' failed", { cause: continues("stream-cut", CUT) }))).toBe(CUT);
  });

  it("is undefined for any other continuation or failure, and is no worker shutdown's ending", () => {
    expect(streamCutCopyOf(continues("model-stall", CUT))).toBeUndefined();
    expect(streamCutCopyOf(new Error("agent blew up"))).toBeUndefined();
    expect(modelStallCopyOf(continues("stream-cut", CUT))).toBeUndefined();
    expect(endsAsWorkerShutdown(continues("stream-cut", CUT))).toBe(false);
  });
});
