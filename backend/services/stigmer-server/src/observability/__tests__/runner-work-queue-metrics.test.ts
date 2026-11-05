/**
 * Pins the worker lane's counter (runner-work-queue-metrics.ts): its name,
 * its four attributes and nothing tenant-shaped, and its birth at zero,
 * on a meter provider registered for the test.
 */
import { metrics } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";

import {
  initWorkQueueMetrics,
  recordWorkQueueCall,
  resetWorkQueueMetrics,
} from "../runner-work-queue-metrics.js";

interface Added {
  readonly value: number;
  readonly attributes: Record<string, unknown> | undefined;
}

function recordingMeter() {
  const added: Added[] = [];
  const names: string[] = [];
  const meter = {
    createCounter: (name: string) => {
      names.push(name);
      return { add: (value: number, attributes?: Record<string, unknown>) => added.push({ value, attributes }) };
    },
  };
  metrics.setGlobalMeterProvider({ getMeter: () => meter } as never);
  return { added, names };
}

afterEach(() => {
  metrics.disable();
  resetWorkQueueMetrics();
});

describe("stigmer.runner.work_queue.calls", () => {
  it("is born at zero, then counts each call by method, decision, status and check", async () => {
    const { added, names } = recordingMeter();
    await initWorkQueueMetrics();
    recordWorkQueueCall({ method: "PollActivityTaskQueue", decision: "refused", status: "PERMISSION_DENIED", check: "queue" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(names).toEqual(["stigmer.runner.work_queue.calls"]);
    expect(added).toEqual([
      { value: 0, attributes: undefined },
      {
        value: 1,
        attributes: { method: "PollActivityTaskQueue", decision: "refused", status: "PERMISSION_DENIED", check: "queue" },
      },
    ]);
  });
});
