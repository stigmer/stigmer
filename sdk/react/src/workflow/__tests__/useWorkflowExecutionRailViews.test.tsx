import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import type {
  DerivedCostSummary,
  DerivedTaskState,
} from "../../internal/store/workflow-execution-event-store";
import { useWorkflowExecutionRailViews } from "../useWorkflowExecutionRailViews";

function artifact(id: string, displayName: string) {
  return create(ArtifactSchema, {
    metadata: { id, name: displayName },
    spec: { displayName, contentType: "application/json" },
  });
}

const EMPTY_COST_SUMMARY: DerivedCostSummary = {
  costConsumedMicros: 0n,
  costRemainingMicros: -1n,
  tokensConsumed: 0n,
  tokensRemaining: -1n,
  thresholdBreached: false,
};

const EMPTY_TASK_STATES: ReadonlyMap<string, DerivedTaskState> = new Map();

describe("useWorkflowExecutionRailViews", () => {
  it("always offers Artifacts AND Usage — even with zero artifacts and zero usage (the always-on panel chip needs both)", () => {
    const { result } = renderHook(() =>
      useWorkflowExecutionRailViews({
        artifacts: [],
        onOpenArtifact: vi.fn(),
        costSummary: EMPTY_COST_SUMMARY,
        taskStates: EMPTY_TASK_STATES,
      }),
    );
    expect(result.current.map((v) => v.id)).toEqual(["artifacts", "usage"]);
    expect(result.current[1].label).toBe("Usage");
    // No badge for an empty list (a zero badge would be noise); Usage never
    // carries a badge (cost is a quantity, not a countable collection).
    expect(result.current[0].badge).toBeUndefined();
    expect(result.current[1].badge).toBeUndefined();
  });

  it("carries the artifact count as the Artifacts rail badge", () => {
    const { result } = renderHook(() =>
      useWorkflowExecutionRailViews({
        artifacts: [artifact("art_1", "a.json"), artifact("art_2", "b.json")],
        onOpenArtifact: vi.fn(),
        costSummary: EMPTY_COST_SUMMARY,
        taskStates: EMPTY_TASK_STATES,
      }),
    );
    expect(result.current[0].badge).toBe(2);
  });

  it("is referentially stable across re-renders with unchanged inputs (DD-010)", () => {
    const onOpenArtifact = vi.fn();
    const onSelectTask = vi.fn();
    const artifacts = [artifact("art_1", "a.json")];
    const { result, rerender } = renderHook(() =>
      useWorkflowExecutionRailViews({
        artifacts,
        onOpenArtifact,
        costSummary: EMPTY_COST_SUMMARY,
        taskStates: EMPTY_TASK_STATES,
        onSelectTask,
      }),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
