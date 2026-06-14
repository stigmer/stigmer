import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  activityStartedOnQueue,
  activityFinishedOnQueue,
  inFlightCountForQueue,
  setQueueDrainCallback,
  forgetQueue,
  __resetInFlightRegistryForTests,
} from "../in-flight.js";

const Q = "session:abc";

describe("in-flight activity registry", () => {
  beforeEach(() => {
    __resetInFlightRegistryForTests();
  });

  it("counts concurrent activities up and down per queue", () => {
    expect(inFlightCountForQueue(Q)).toBe(0);
    activityStartedOnQueue(Q);
    activityStartedOnQueue(Q);
    expect(inFlightCountForQueue(Q)).toBe(2);
    activityFinishedOnQueue(Q);
    expect(inFlightCountForQueue(Q)).toBe(1);
    activityFinishedOnQueue(Q);
    expect(inFlightCountForQueue(Q)).toBe(0);
  });

  it("isolates counts across queues", () => {
    activityStartedOnQueue("session:a");
    activityStartedOnQueue("session:b");
    activityStartedOnQueue("session:b");
    expect(inFlightCountForQueue("session:a")).toBe(1);
    expect(inFlightCountForQueue("session:b")).toBe(2);
  });

  it("never goes negative on an unbalanced finish", () => {
    activityFinishedOnQueue(Q);
    expect(inFlightCountForQueue(Q)).toBe(0);
  });

  it("fires the drain callback exactly once when the last activity finishes", () => {
    const onDrained = vi.fn();
    activityStartedOnQueue(Q);
    activityStartedOnQueue(Q);
    setQueueDrainCallback(Q, onDrained);

    activityFinishedOnQueue(Q);
    expect(onDrained).not.toHaveBeenCalled(); // still 1 in flight

    activityFinishedOnQueue(Q);
    expect(onDrained).toHaveBeenCalledTimes(1);

    // A subsequent start/finish cycle does not re-fire the consumed callback.
    activityStartedOnQueue(Q);
    activityFinishedOnQueue(Q);
    expect(onDrained).toHaveBeenCalledTimes(1);
  });

  it("does not fire a drain callback that was cleared (session re-opened)", () => {
    const onDrained = vi.fn();
    activityStartedOnQueue(Q);
    setQueueDrainCallback(Q, onDrained);
    setQueueDrainCallback(Q, undefined); // re-open cancels the deferred teardown

    activityFinishedOnQueue(Q);
    expect(onDrained).not.toHaveBeenCalled();
  });

  it("forgetQueue resets tracking for a torn-down worker", () => {
    activityStartedOnQueue(Q);
    forgetQueue(Q);
    expect(inFlightCountForQueue(Q)).toBe(0);
  });

  it("setQueueDrainCallback is a no-op for an idle (unknown) queue", () => {
    const onDrained = vi.fn();
    setQueueDrainCallback("session:idle", onDrained);
    // No entry exists, so nothing will ever fire it — caller tears down inline.
    activityStartedOnQueue("session:idle");
    activityFinishedOnQueue("session:idle");
    expect(onDrained).not.toHaveBeenCalled();
  });
});
