/**
 * Proves the phase helpers (../run-phases.ts): which run phases are
 * terminal, and the RunPhase each turn phase word names (an unknown word
 * reads as unspecified).
 */
import { describe, it, expect } from "vitest";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { TurnPhase } from "@stigmer/sdk";
import { isTerminalPhase, runPhaseOf } from "../run-phases";

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

describe("runPhaseOf", () => {
  it.each([
    ["pending", RunPhase.RUN_PENDING],
    ["running", RunPhase.RUN_IN_PROGRESS],
    ["waiting", RunPhase.RUN_WAITING_FOR_APPROVAL],
    ["paused", RunPhase.RUN_PAUSED],
    ["completed", RunPhase.RUN_COMPLETED],
    ["failed", RunPhase.RUN_FAILED],
    ["cancelled", RunPhase.RUN_CANCELLED],
    ["terminated", RunPhase.RUN_TERMINATED],
  ] as const)("reads %s", (word, phase) => {
    expect(runPhaseOf(word)).toBe(phase);
  });

  it("reads an unknown word as unspecified", () => {
    expect(runPhaseOf("archived" as TurnPhase)).toBe(RunPhase.RUN_PHASE_UNSPECIFIED);
  });
});
