import { describe, it, expect } from "vitest";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { isTerminalPhase } from "../run-phases";

describe("isTerminalPhase", () => {
  const terminalPhases = [
    RunPhase.RUN_COMPLETED,
    RunPhase.RUN_FAILED,
    RunPhase.RUN_CANCELLED,
    RunPhase.RUN_TERMINATED,
  ];

  it.each(terminalPhases)("returns true for terminal phase %i", (phase) => {
    expect(isTerminalPhase(phase)).toBe(true);
  });

  const nonTerminalPhases = [
    RunPhase.RUN_PHASE_UNSPECIFIED,
    RunPhase.RUN_PENDING,
    RunPhase.RUN_IN_PROGRESS,
    RunPhase.RUN_WAITING_FOR_APPROVAL,
    RunPhase.RUN_PAUSED,
  ];

  it.each(nonTerminalPhases)(
    "returns false for non-terminal phase %i",
    (phase) => {
      expect(isTerminalPhase(phase)).toBe(false);
    },
  );
});
