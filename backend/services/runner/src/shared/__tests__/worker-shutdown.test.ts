import { describe, expect, it } from "vitest";
import {
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
  const none = {
    heartbeatCancelled: false,
    heartbeatWorkerShutdown: false,
    cancellationSignalAborted: false,
    shutdownSignalAborted: false,
  };

  it("an uninterrupted turn is none", () => {
    expect(classifyTurnInterruption(none)).toBe("none");
  });

  it("GRACE-WINDOW GUARD (#776): an aborted shutdown signal alone stays none — a run that completed inside the drain grace window must not be failed", () => {
    expect(
      classifyTurnInterruption({ ...none, shutdownSignalAborted: true }),
    ).toBe("none");
  });

  it("heartbeat cancellation without a shutdown signal is the orchestrator's pause", () => {
    expect(
      classifyTurnInterruption({ ...none, heartbeatCancelled: true }),
    ).toBe("pause");
  });

  it("heartbeat cancellation WITH the shutdown signal aborted is a worker shutdown, not a pause (the #776 misclassification)", () => {
    expect(
      classifyTurnInterruption({
        ...none,
        heartbeatCancelled: true,
        shutdownSignalAborted: true,
      }),
    ).toBe("worker-shutdown");
  });

  it("the heartbeat's own workerShutdown flag classifies directly", () => {
    expect(
      classifyTurnInterruption({ ...none, heartbeatWorkerShutdown: true }),
    ).toBe("worker-shutdown");
  });

  it("a delivered cancellation with the shutdown signal aborted is a worker shutdown (signal races the heartbeat tick)", () => {
    expect(
      classifyTurnInterruption({
        ...none,
        cancellationSignalAborted: true,
        shutdownSignalAborted: true,
      }),
    ).toBe("worker-shutdown");
  });

  it("a delivered cancellation alone (heartbeat timeout / infra cancel) is neither shutdown nor pause", () => {
    expect(
      classifyTurnInterruption({ ...none, cancellationSignalAborted: true }),
    ).toBe("none");
  });
});
