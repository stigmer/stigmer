/**
 * Pins `isTerminalWorkflowExecutionPhase` (phases.ts) over every member
 * of the workflow ExecutionPhase enum, so the set is stated by
 * enumeration and a new phase added to the contract lands in exactly one
 * arm here. The contrast with subscribe.ts's `isWorkflowTerminalPhase`
 * (TERMINATED omitted on purpose) is pinned so the two are never merged.
 */
import { describe, expect, it } from "vitest";

import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";

import { isTerminalWorkflowExecutionPhase } from "../phases.js";
import { isWorkflowTerminalPhase } from "../subscribe.js";

const TERMINAL = [
  ExecutionPhase.EXECUTION_COMPLETED,
  ExecutionPhase.EXECUTION_FAILED,
  ExecutionPhase.EXECUTION_CANCELLED,
  ExecutionPhase.EXECUTION_TERMINATED,
];

describe("isTerminalWorkflowExecutionPhase", () => {
  it.each(TERMINAL.map((phase) => [ExecutionPhase[phase], phase] as const))(
    "%s will never run again",
    (_name, phase) => {
      expect(isTerminalWorkflowExecutionPhase(phase)).toBe(true);
    },
  );

  it.each([
    ["UNSPECIFIED", ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED],
    ["PENDING", ExecutionPhase.EXECUTION_PENDING],
    ["IN_PROGRESS", ExecutionPhase.EXECUTION_IN_PROGRESS],
    ["PAUSED", ExecutionPhase.EXECUTION_PAUSED],
  ])("%s may still run", (_name, phase) => {
    expect(isTerminalWorkflowExecutionPhase(phase)).toBe(false);
  });

  it("covers every member of the enum — a new phase must be classified here", () => {
    const members = Object.values(ExecutionPhase).filter(
      (value): value is ExecutionPhase => typeof value === "number",
    );
    const classified = members.filter((phase) =>
      isTerminalWorkflowExecutionPhase(phase),
    );
    expect(classified.sort()).toEqual([...TERMINAL].sort());
    expect(members).toHaveLength(8);
  });

  it("differs from the subscribe stream's close set on TERMINATED alone — deliberate, not to be merged", () => {
    expect(isWorkflowTerminalPhase(ExecutionPhase.EXECUTION_TERMINATED)).toBe(
      false,
    );
    expect(
      isTerminalWorkflowExecutionPhase(ExecutionPhase.EXECUTION_TERMINATED),
    ).toBe(true);
  });
});
