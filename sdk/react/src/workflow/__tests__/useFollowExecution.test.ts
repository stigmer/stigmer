import { describe, expect, it } from "vitest";
import { computeFollowCenter } from "../useFollowExecution";
import type { FollowCenterInput } from "../useFollowExecution";

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
