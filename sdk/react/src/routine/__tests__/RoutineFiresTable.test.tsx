import { describe, it, expect } from "vitest";
import { RoutineFireOutcome } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import { fireOutcomeBadge } from "../RoutineFiresTable";
import type { StatusPhase } from "../../resource-workbench/types";

// Pins every fire outcome's status pill to its phase: the at-risk (degraded)
// phase for the two that need the owner (stigmer#2772) and the disabled phase
// for Skipped and Unknown. The table is a Record over the enum, so a new
// outcome fails the typecheck until it is given a pill here on purpose, never
// by falling through to "Unknown" unnoticed.

const EXPECTED: Record<RoutineFireOutcome, { label: string; phase: StatusPhase }> = {
  [RoutineFireOutcome.UNSPECIFIED]: {
    label: "Unknown",
    phase: "disabled",
  },
  [RoutineFireOutcome.STARTED]: {
    label: "Started",
    phase: "running",
  },
  [RoutineFireOutcome.COMPLETED]: {
    label: "Completed",
    phase: "ready",
  },
  [RoutineFireOutcome.REFUSED]: {
    label: "Refused",
    phase: "degraded",
  },
  [RoutineFireOutcome.TARGET_MISSING]: {
    label: "Target missing",
    phase: "degraded",
  },
  [RoutineFireOutcome.SKIPPED]: {
    label: "Skipped",
    phase: "disabled",
  },
  [RoutineFireOutcome.FAILED]: {
    label: "Failed",
    phase: "failed",
  },
  [RoutineFireOutcome.TIMED_OUT]: {
    label: "Timed out",
    phase: "failed",
  },
};

const OUTCOMES = Object.values(RoutineFireOutcome).filter(
  (value): value is RoutineFireOutcome => typeof value === "number",
);

describe("fireOutcomeBadge", () => {
  it.each(OUTCOMES.map((outcome) => [RoutineFireOutcome[outcome], outcome] as const))(
    "%s draws its phase's pill",
    (_name, outcome) => {
      expect(fireOutcomeBadge(outcome)).toEqual(EXPECTED[outcome]);
    },
  );
});
