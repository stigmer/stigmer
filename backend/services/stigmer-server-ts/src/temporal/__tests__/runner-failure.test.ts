/**
 * Pins the worker-shutdown classification (pkg/runnerfailure parity,
 * issue #776): the two message shapes that mean "infrastructure
 * interrupted the turn", matched exactly as the Go and Java control
 * planes match them, and the honest status.error copy every edition
 * shares. The invoke workflow's recovery loop and failure-path persist
 * both key on this classifier.
 */
import { ApplicationFailure, CancelledFailure } from "@temporalio/common";
import { describe, expect, it } from "vitest";

import {
  isWorkerShutdown,
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
