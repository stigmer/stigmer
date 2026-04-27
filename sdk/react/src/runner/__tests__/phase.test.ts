import { describe, it, expect } from "vitest";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import { isTransitionalPhase, isActivePhase } from "../phase";

describe("isTransitionalPhase", () => {
  it("returns true for PENDING", () => {
    expect(isTransitionalPhase(RunnerPhase.PENDING)).toBe(true);
  });

  it.each([
    ["READY", RunnerPhase.READY],
    ["BUSY", RunnerPhase.BUSY],
    ["STOPPED", RunnerPhase.STOPPED],
    ["FAILED", RunnerPhase.FAILED],
    ["UNSPECIFIED", RunnerPhase.UNSPECIFIED],
  ] as const)("returns false for %s", (_label, phase) => {
    expect(isTransitionalPhase(phase)).toBe(false);
  });

  it("is disjoint from isActivePhase", () => {
    const allPhases = [
      RunnerPhase.READY,
      RunnerPhase.BUSY,
      RunnerPhase.PENDING,
      RunnerPhase.STOPPED,
      RunnerPhase.FAILED,
      RunnerPhase.UNSPECIFIED,
    ];
    for (const phase of allPhases) {
      if (isTransitionalPhase(phase)) {
        expect(isActivePhase(phase)).toBe(false);
      }
    }
  });
});
