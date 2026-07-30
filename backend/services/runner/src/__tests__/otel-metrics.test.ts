import { describe, it, expect, beforeEach } from "vitest";
import { getInstruments, resetInstruments } from "../otel-metrics.js";

describe("OTel Metrics Registry", () => {
  beforeEach(() => {
    resetInstruments();
  });

  it("creates all required instruments", async () => {
    const instruments = await getInstruments();
    expect(instruments.executionCount).toBeDefined();
    expect(instruments.executionActive).toBeDefined();
    expect(instruments.activityDuration).toBeDefined();
    expect(instruments.workflowTaskDuration).toBeDefined();
    expect(instruments.workflowTaskCount).toBeDefined();
    expect(instruments.runnerBootDuration).toBeDefined();
    expect(instruments.executionSetupDuration).toBeDefined();
    expect(instruments.poolAttachDuration).toBeDefined();
  });

  it("returns the same singleton on repeated calls", async () => {
    const first = await getInstruments();
    const second = await getInstruments();
    expect(first).toBe(second);
  });

  it("instruments are callable without throwing (no-op meter)", async () => {
    const instruments = await getInstruments();
    expect(() => instruments.executionCount.add(1)).not.toThrow();
    expect(() => instruments.executionActive.add(1)).not.toThrow();
    expect(() => instruments.executionActive.add(-1)).not.toThrow();
    expect(() => instruments.activityDuration.record(150)).not.toThrow();
    expect(() => instruments.workflowTaskDuration.record(42)).not.toThrow();
    expect(() => instruments.workflowTaskCount.add(1, { "task.kind": "set" })).not.toThrow();
    expect(() => instruments.runnerBootDuration.record(6200, { mode: "cloud" })).not.toThrow();
    expect(() => instruments.executionSetupDuration.record(3000, { harness: "cursor" })).not.toThrow();
    expect(() => instruments.poolAttachDuration.record(400)).not.toThrow();
  });

  it("reset allows re-creation", async () => {
    const first = await getInstruments();
    resetInstruments();
    const second = await getInstruments();
    expect(first).not.toBe(second);
  });
});
