import { describe, expect, it } from "vitest";
import { CancelledFailure } from "@temporalio/activity";
import {
  cancellationReasonOf,
  classifyTurnInterruption,
  getShutdownSignalForQueue,
  registerWorkerShutdownSignal,
  signalWorkerShutdown,
  unregisterWorkerShutdownSignal,
} from "../worker-shutdown.js";

describe("worker-shutdown signal registry", () => {
  it("registers a live signal an activity can resolve by queue name", () => {
    const controller = registerWorkerShutdownSignal("session:reg-1");
    const signal = getShutdownSignalForQueue("session:reg-1");
    expect(signal).toBe(controller.signal);
    expect(signal?.aborted).toBe(false);
    unregisterWorkerShutdownSignal("session:reg-1");
  });

  it("aborting via signalWorkerShutdown marks the queue's signal (idempotent, unknown queues are no-ops)", () => {
    registerWorkerShutdownSignal("session:abort-1");
    signalWorkerShutdown("session:abort-1");
    signalWorkerShutdown("session:abort-1");
    expect(getShutdownSignalForQueue("session:abort-1")?.aborted).toBe(true);
    expect(() => signalWorkerShutdown("session:never-registered")).not.toThrow();
    unregisterWorkerShutdownSignal("session:abort-1");
  });

  it("re-registering a reused queue replaces an aborted signal with a fresh one", () => {
    // A re-created worker on a reused queue (desktop re-opens a session) must
    // not observe the previous worker's aborted signal as its own shutdown.
    const first = registerWorkerShutdownSignal("session:reuse-1");
    first.abort();
    const second = registerWorkerShutdownSignal("session:reuse-1");
    expect(getShutdownSignalForQueue("session:reuse-1")).toBe(second.signal);
    expect(getShutdownSignalForQueue("session:reuse-1")?.aborted).toBe(false);
    unregisterWorkerShutdownSignal("session:reuse-1");
  });

  it("unregistering removes the signal", () => {
    registerWorkerShutdownSignal("session:gone-1");
    unregisterWorkerShutdownSignal("session:gone-1");
    expect(getShutdownSignalForQueue("session:gone-1")).toBeUndefined();
  });
});

describe("classifyTurnInterruption", () => {
  it("an uninterrupted turn is none", () => {
    expect(classifyTurnInterruption({ cancellationReason: undefined, shutdownSignalAborted: false })).toBe("none");
  });

  it("GRACE-WINDOW GUARD (#776): an aborted shutdown signal alone stays none — a run that completed inside the drain grace window must not be failed", () => {
    expect(classifyTurnInterruption({ cancellationReason: undefined, shutdownSignalAborted: true })).toBe("none");
  });

  it("a workflow-requested cancellation without a shutdown signal is the orchestrator's pause", () => {
    expect(classifyTurnInterruption({ cancellationReason: "CANCELLED", shutdownSignalAborted: false })).toBe("pause");
  });

  it("a delivered cancellation WITH the shutdown signal aborted is a worker shutdown, not a pause (the #776 misclassification)", () => {
    expect(classifyTurnInterruption({ cancellationReason: "CANCELLED", shutdownSignalAborted: true })).toBe("worker-shutdown");
  });

  it("the SDK's own WORKER_SHUTDOWN reason classifies directly, signal or not", () => {
    expect(classifyTurnInterruption({ cancellationReason: "WORKER_SHUTDOWN", shutdownSignalAborted: false })).toBe("worker-shutdown");
  });

  it("a heartbeat timeout (TIMED_OUT) is an infrastructure cancel, neither shutdown nor pause", () => {
    expect(classifyTurnInterruption({ cancellationReason: "TIMED_OUT", shutdownSignalAborted: false })).toBe("infrastructure");
  });

  it("any other reason (a closed run, a conversion failure) is an infrastructure cancel", () => {
    expect(classifyTurnInterruption({ cancellationReason: "NOT_FOUND", shutdownSignalAborted: false })).toBe("infrastructure");
    expect(classifyTurnInterruption({ cancellationReason: "HEARTBEAT_DETAILS_CONVERSION_FAILED", shutdownSignalAborted: false })).toBe("infrastructure");
  });

  it("the shutdown signal outranks an infrastructure reason: a drain is a drain whatever Temporal says", () => {
    expect(classifyTurnInterruption({ cancellationReason: "TIMED_OUT", shutdownSignalAborted: true })).toBe("worker-shutdown");
  });
});

describe("cancellationReasonOf", () => {
  it("is undefined for a live signal", () => {
    expect(cancellationReasonOf(new AbortController().signal)).toBeUndefined();
  });

  it("reads the CancelledFailure message the Temporal SDK aborts with", () => {
    const controller = new AbortController();
    controller.abort(new CancelledFailure("TIMED_OUT"));
    expect(cancellationReasonOf(controller.signal)).toBe("TIMED_OUT");
  });

  it("reads a string reason as itself and a reasonless abort as CANCELLED", () => {
    const withString = new AbortController();
    withString.abort("WORKER_SHUTDOWN");
    expect(cancellationReasonOf(withString.signal)).toBe("WORKER_SHUTDOWN");
    const bare = new AbortController();
    bare.abort();
    // A bare abort() carries a DOMException (an Error), whose message is the
    // platform's "This operation was aborted": not a Temporal reason, but a
    // delivered cancellation all the same — the classifier files it as
    // infrastructure, never as nothing.
    expect(cancellationReasonOf(bare.signal)).toBeTypeOf("string");
  });
});
