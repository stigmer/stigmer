import { describe, expect, it } from "vitest";
import { computeFollowCenter, computeFollowSelection } from "../useFollowExecution";
import type { FollowCenterInput, FollowSelectionInput } from "../useFollowExecution";

function defaultInput(overrides: Partial<FollowCenterInput> = {}): FollowCenterInput {
  return {
    nodeX: 300,
    nodeY: 200,
    nodeWidth: 200,
    nodeHeight: 56,
    currentZoom: 1.0,
    panelOffsetPx: 0,
    ...overrides,
  };
}

describe("computeFollowCenter", () => {
  it("centers exactly on node midpoint when panelOffsetPx is 0", () => {
    const result = computeFollowCenter(defaultInput());

    expect(result.x).toBe(400); // 300 + 200/2
    expect(result.y).toBe(228); // 200 + 56/2
    expect(result.zoom).toBe(1.0);
  });

  it("shifts center leftward when panelOffsetPx is provided (overlay scenario)", () => {
    const result = computeFollowCenter(defaultInput({ panelOffsetPx: 384 }));

    // offsetX = (384 / 2) / 1.0 = 192
    expect(result.x).toBe(400 - 192);
    expect(result.y).toBe(228);
  });

  it("scales offset inversely with zoom level", () => {
    const result = computeFollowCenter(
      defaultInput({ panelOffsetPx: 384, currentZoom: 2.0 }),
    );

    // offsetX = (384 / 2) / 2.0 = 96
    expect(result.x).toBe(400 - 96);
    expect(result.y).toBe(228);
  });

  it("enforces minimum zoom of 1.0 when current zoom is lower", () => {
    const result = computeFollowCenter(defaultInput({ currentZoom: 0.5 }));

    expect(result.zoom).toBe(1.0);
  });

  it("preserves current zoom when above minimum", () => {
    const result = computeFollowCenter(defaultInput({ currentZoom: 1.5 }));

    expect(result.zoom).toBe(1.5);
  });

  it("handles nodes at the origin", () => {
    const result = computeFollowCenter(
      defaultInput({ nodeX: 0, nodeY: 0, nodeWidth: 100, nodeHeight: 40 }),
    );

    expect(result.x).toBe(50);  // 0 + 100/2
    expect(result.y).toBe(20);  // 0 + 40/2
  });

  it("handles negative node positions", () => {
    const result = computeFollowCenter(
      defaultInput({ nodeX: -100, nodeY: -50, nodeWidth: 200, nodeHeight: 56 }),
    );

    expect(result.x).toBe(0);   // -100 + 200/2
    expect(result.y).toBe(-22); // -50 + 56/2
  });

  it("produces no offset when panelOffsetPx is negative", () => {
    const result = computeFollowCenter(defaultInput({ panelOffsetPx: -100 }));

    expect(result.x).toBe(400); // no offset applied for non-positive values
    expect(result.y).toBe(228);
  });

  it("produces correct offset at very high zoom", () => {
    const result = computeFollowCenter(
      defaultInput({ panelOffsetPx: 400, currentZoom: 10.0 }),
    );

    // offsetX = (400 / 2) / 10.0 = 20
    expect(result.x).toBe(400 - 20);
  });
});

// ---------------------------------------------------------------------------
// computeFollowSelection
// ---------------------------------------------------------------------------

function selectionInput(overrides: Partial<FollowSelectionInput> = {}): FollowSelectionInput {
  return {
    isFollowing: true,
    activeTaskName: "analyze_data",
    currentSelectedTask: null,
    ...overrides,
  };
}

describe("computeFollowSelection", () => {
  it("returns the active task name when following and no task is selected", () => {
    const result = computeFollowSelection(selectionInput());

    expect(result).toBe("analyze_data");
  });

  it("returns the active task name when a different task is selected", () => {
    const result = computeFollowSelection(
      selectionInput({ currentSelectedTask: "fetch_data" }),
    );

    expect(result).toBe("analyze_data");
  });

  it("returns null when the active task is already selected", () => {
    const result = computeFollowSelection(
      selectionInput({ currentSelectedTask: "analyze_data" }),
    );

    expect(result).toBeNull();
  });

  it("returns null when not following", () => {
    const result = computeFollowSelection(
      selectionInput({ isFollowing: false }),
    );

    expect(result).toBeNull();
  });

  it("returns null when there is no active task", () => {
    const result = computeFollowSelection(
      selectionInput({ activeTaskName: null }),
    );

    expect(result).toBeNull();
  });

  it("returns null when not following even if active task differs from selection", () => {
    const result = computeFollowSelection(
      selectionInput({
        isFollowing: false,
        activeTaskName: "new_task",
        currentSelectedTask: "old_task",
      }),
    );

    expect(result).toBeNull();
  });

  it("returns null when following but active task is null despite having a selection", () => {
    const result = computeFollowSelection(
      selectionInput({
        activeTaskName: null,
        currentSelectedTask: "some_task",
      }),
    );

    expect(result).toBeNull();
  });

  it("selects the new active task when the running task changes", () => {
    const result = computeFollowSelection(
      selectionInput({
        activeTaskName: "generate_report",
        currentSelectedTask: "analyze_data",
      }),
    );

    expect(result).toBe("generate_report");
  });
});
