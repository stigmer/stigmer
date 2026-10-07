import { describe, it, expect, beforeEach } from "vitest";
import { getInstruments, resetInstruments } from "../otel-metrics.js";

describe("OTel Metrics Registry", () => {
  beforeEach(() => {
    resetInstruments();
  });

  it("creates all required instruments", async () => {
    const instruments = await getInstruments();
    expect(instruments.activityDuration).toBeDefined();
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
    expect(() => instruments.activityDuration.record(150)).not.toThrow();
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
