/**
 * Pins the workflow-gone counter (run-workflow-gone-metrics.ts): its name,
 * its two attributes and nothing tenant-shaped, and its birth at zero, on
 * a meter provider registered for the test.
 */
import { metrics } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";

import {
  initRunWorkflowGoneMetrics,
  recordRunWorkflowGone,
  resetRunWorkflowGoneMetrics,
} from "../run-workflow-gone-metrics.js";

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
      return {
        add: (value: number, attributes?: Record<string, unknown>) =>
          added.push({ value, attributes }),
      };
    },
  };
  metrics.setGlobalMeterProvider({ getMeter: () => meter } as never);
  return { added, names };
}

afterEach(() => {
  metrics.disable();
  resetRunWorkflowGoneMetrics();
});

describe("stigmer.run.workflow_gone", () => {
  it("is born at zero, then counts each ended run by the phase it left and what the engine answered", async () => {
    const { added, names } = recordingMeter();
    await initRunWorkflowGoneMetrics();
    recordRunWorkflowGone({ phase: "in_progress", found: "not_found" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(names).toEqual(["stigmer.run.workflow_gone"]);
    expect(added).toEqual([
      { value: 0, attributes: undefined },
      { value: 1, attributes: { phase: "in_progress", found: "not_found" } },
    ]);
  });
});
