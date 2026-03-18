import { describe, it, expect } from "vitest";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { isTerminalPhase } from "../execution-phases";

describe("isTerminalPhase", () => {
  const terminalPhases = [
    ExecutionPhase.EXECUTION_COMPLETED,
    ExecutionPhase.EXECUTION_FAILED,
    ExecutionPhase.EXECUTION_CANCELLED,
    ExecutionPhase.EXECUTION_TERMINATED,
  ];

  it.each(terminalPhases)("returns true for terminal phase %i", (phase) => {
    expect(isTerminalPhase(phase)).toBe(true);
  });

  const nonTerminalPhases = [
    ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED,
    ExecutionPhase.EXECUTION_PENDING,
    ExecutionPhase.EXECUTION_IN_PROGRESS,
    ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    ExecutionPhase.EXECUTION_PAUSED,
  ];

  it.each(nonTerminalPhases)(
    "returns false for non-terminal phase %i",
    (phase) => {
      expect(isTerminalPhase(phase)).toBe(false);
    },
  );
});
