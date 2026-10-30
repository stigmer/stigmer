import { describe, it, expect } from "vitest";
import { RoutineFireOutcome } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import { fireOutcomeBadge } from "../RoutineFiresTable";

// Pins every fire outcome's pill to a pair the theme contract measures: the
// status pill pairs for the tinted outcomes (the at-risk pair for the two that
// need the owner, stigmer#2772) and the muted panel pair for Skipped and
// Unknown. The table is a Record over the enum, so a new outcome fails the
// typecheck until it is given a pill here on purpose, never by falling
// through to "Unknown" unnoticed.

const EXPECTED: Record<RoutineFireOutcome, { label: string; className: string }> = {
  [RoutineFireOutcome.UNSPECIFIED]: {
    label: "Unknown",
    className: "stg:bg-muted stg:text-muted-foreground",
  },
  [RoutineFireOutcome.STARTED]: {
    label: "Started",
    className: "stg:bg-status-running-subtle stg:text-status-running",
  },
  [RoutineFireOutcome.COMPLETED]: {
    label: "Completed",
    className: "stg:bg-status-ready-subtle stg:text-status-ready",
  },
  [RoutineFireOutcome.REFUSED]: {
    label: "Refused",
    className: "stg:bg-status-degraded-subtle stg:text-status-degraded",
  },
  [RoutineFireOutcome.TARGET_MISSING]: {
    label: "Target missing",
    className: "stg:bg-status-degraded-subtle stg:text-status-degraded",
  },
  [RoutineFireOutcome.SKIPPED]: {
    label: "Skipped",
    className: "stg:bg-muted stg:text-muted-foreground",
  },
  [RoutineFireOutcome.FAILED]: {
    label: "Failed",
    className: "stg:bg-status-failed-subtle stg:text-status-failed",
  },
  [RoutineFireOutcome.TIMED_OUT]: {
    label: "Timed out",
    className: "stg:bg-status-failed-subtle stg:text-status-failed",
  },
};

const OUTCOMES = Object.values(RoutineFireOutcome).filter(
  (value): value is RoutineFireOutcome => typeof value === "number",
);

describe("fireOutcomeBadge", () => {
  it.each(OUTCOMES.map((outcome) => [RoutineFireOutcome[outcome], outcome] as const))(
    "%s draws its measured pill",
    (_name, outcome) => {
      expect(fireOutcomeBadge(outcome)).toEqual(EXPECTED[outcome]);
    },
  );

  it("fades no colour token", () => {
    for (const outcome of OUTCOMES) {
      expect(fireOutcomeBadge(outcome).className).not.toMatch(/\/\d+(\s|$)/);
    }
  });
});
