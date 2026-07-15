import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { FileChangeSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { FileChangeType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  DerivedCostSummary,
  DerivedTaskState,
} from "../../internal/store/workflow-execution-event-store";
import {
  useWorkflowExecutionRailViews,
  type UseWorkflowExecutionRailViewsOptions,
  type WorkflowInspectViewOptions,
} from "../useWorkflowExecutionRailViews";

function artifact(id: string, displayName: string) {
  return create(ArtifactSchema, {
    metadata: { id, name: displayName },
    spec: { displayName, contentType: "application/json" },
  });
}

function fileChange(path: string) {
  return create(FileChangeSchema, {
    path,
    changeType: FileChangeType.MODIFY,
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

/** Minimal valid options; tests override the fields under test. */
function baseOptions(
  overrides?: Partial<UseWorkflowExecutionRailViewsOptions>,
): UseWorkflowExecutionRailViewsOptions {
  return {
    artifacts: [],
    onOpenArtifact: vi.fn(),
    fileChanges: [],
    onOpenFileChange: vi.fn(),
    costSummary: EMPTY_COST_SUMMARY,
    taskStates: EMPTY_TASK_STATES,
    ...overrides,
  };
}

describe("useWorkflowExecutionRailViews", () => {
  it("always offers Artifacts, Changes AND Usage — even with zero data (the always-on panel chip needs a full rail)", () => {
    const { result } = renderHook(() =>
      useWorkflowExecutionRailViews(baseOptions()),
    );
    expect(result.current.map((v) => v.id)).toEqual([
      "artifacts",
      "changes",
      "usage",
    ]);
    expect(result.current[1].label).toBe("Changes");
    expect(result.current[2].label).toBe("Usage");
    // No badge for an empty list (a zero badge would be noise); Usage never
    // carries a badge (cost is a quantity, not a countable collection).
    expect(result.current[0].badge).toBeUndefined();
    expect(result.current[1].badge).toBeUndefined();
    expect(result.current[2].badge).toBeUndefined();
  });

  it("carries the artifact count as the Artifacts rail badge", () => {
    const { result } = renderHook(() =>
      useWorkflowExecutionRailViews(
        baseOptions({
          artifacts: [artifact("art_1", "a.json"), artifact("art_2", "b.json")],
        }),
      ),
    );
    expect(result.current[0].badge).toBe(2);
  });

  it("carries the changed-file count as the Changes rail badge", () => {
    const { result } = renderHook(() =>
      useWorkflowExecutionRailViews(
        baseOptions({
          fileChanges: [fileChange("src/a.ts"), fileChange("src/b.ts")],
        }),
      ),
    );
    expect(result.current[1].badge).toBe(2);
  });

  it("is referentially stable across re-renders with unchanged inputs (DD-010)", () => {
    const options = baseOptions({
      artifacts: [artifact("art_1", "a.json")],
      fileChanges: [fileChange("src/a.ts")],
      onSelectTask: vi.fn(),
    });
    const { result, rerender } = renderHook(() =>
      useWorkflowExecutionRailViews(options),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// The contextual Inspect view (per-node detail, fitted)
// ---------------------------------------------------------------------------

/** A minimal Inspect bundle; tests override `selectedTaskName`. */
function inspectOptions(
  selectedTaskName: string | null,
): WorkflowInspectViewOptions {
  return {
    selectedTaskName,
    events: [],
    hitl: {
      submitApproval: vi.fn(),
      approvalSubmittingToolCallIds: new Set<string>(),
      approvalErrorsByToolCallId: new Map<string, Error>(),
      submitTaskApproval: vi.fn(),
      taskApprovalSubmittingTaskNames: new Set<string>(),
      taskApprovalErrorsByTaskName: new Map<string, Error>(),
    },
  };
}

describe("useWorkflowExecutionRailViews Inspect view", () => {
  it("leads the rail while a task is selected — fitted, unbadged", () => {
    const { result } = renderHook(() =>
      useWorkflowExecutionRailViews(
        baseOptions({ inspect: inspectOptions("build-report") }),
      ),
    );
    expect(result.current.map((v) => v.id)).toEqual([
      "inspect",
      "artifacts",
      "changes",
      "usage",
    ]);
    expect(result.current[0].label).toBe("Inspect");
    // Fitted: the inspector owns its header/tabs/scroll — the surface must
    // hand it the bare slot, not the shared facet envelope.
    expect(result.current[0].fitted).toBe(true);
    expect(result.current[0].badge).toBeUndefined();
  });

  it("is absent without a selection (contextual, like the session's Inspect)", () => {
    const { result } = renderHook(() =>
      useWorkflowExecutionRailViews(
        baseOptions({ inspect: inspectOptions(null) }),
      ),
    );
    expect(result.current.map((v) => v.id)).toEqual([
      "artifacts",
      "changes",
      "usage",
    ]);
  });

  it("is absent when the bundle is not provided (standalone panel embeds)", () => {
    const { result } = renderHook(() =>
      useWorkflowExecutionRailViews(baseOptions()),
    );
    expect(result.current.some((v) => v.id === "inspect")).toBe(false);
  });

  it("selection changes leave the execution-facet elements untouched (DD-010)", () => {
    const base = baseOptions({ inspect: inspectOptions("task-a") });
    const { result, rerender } = renderHook(
      (opts: UseWorkflowExecutionRailViewsOptions) =>
        useWorkflowExecutionRailViews(opts),
      { initialProps: base },
    );
    const firstFacets = result.current.filter((v) => v.id !== "inspect");

    rerender({ ...base, inspect: inspectOptions("task-b") });

    const nextFacets = result.current.filter((v) => v.id !== "inspect");
    expect(nextFacets.map((v, i) => v === firstFacets[i])).not.toContain(
      false,
    );
  });
});
