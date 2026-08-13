import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { useWorkflowCanvas } from "../useWorkflowCanvas";

// Regression tests for oss#602: node drags updated only React Flow's copy
// of positions — nothing wrote them back to the WorkflowGraphModel. Any
// later dispatch's syncFromModel snapped dragged nodes back to stale model
// positions, and drags were invisible to undo (inconsistent with
// auto-layout, which records a MoveNodesCommand). These tests drive the
// hook through the same event sequence React Flow produces: position
// changes stream through onNodesChange during the drag, then
// onNodeDragStop fires with the dragged nodes' final positions.

const FIXTURE_YAML = `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: drag-fixture
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: drag-fixture
    version: "0.0.1"
  tasks:
    - name: step_1
      kind: agent_call
      task_config:
        agent: "org/agent-slug"
        message: "first"
      flow:
        then: step_2
    - name: step_2
      kind: agent_call
      task_config:
        agent: "org/agent-slug"
        message: "second"
      flow:
        then: end
`;

function wrapper({ children }: { children: ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

function renderCanvas() {
  return renderHook(() => useWorkflowCanvas(FIXTURE_YAML), { wrapper });
}

type CanvasResult = ReturnType<typeof renderCanvas>["result"];

const DRAG_EVENT = {} as React.MouseEvent;

function canvasPosition(result: CanvasResult, id: string): { x: number; y: number } {
  const node = result.current.nodes.find((n) => n.id === id);
  expect(node).toBeDefined();
  return { x: node!.position.x, y: node!.position.y };
}

function modelPosition(result: CanvasResult, id: string): { x: number; y: number } {
  const node = result.current.graph?.nodes.find((n) => n.id === id);
  expect(node).toBeDefined();
  return { x: node!.position.x, y: node!.position.y };
}

/**
 * Drives one full drag gesture the way React Flow does: dragStart with the
 * node at its current position, position changes streamed through
 * onNodesChange, then dragStop with the final positions.
 */
function drag(result: CanvasResult, moves: readonly { id: string; to: { x: number; y: number } }[]) {
  const startNodes = moves.map(({ id }) => {
    const node = result.current.nodes.find((n) => n.id === id);
    expect(node).toBeDefined();
    return node!;
  });

  act(() => {
    result.current.onNodeDragStart(DRAG_EVENT, startNodes[0], startNodes);
  });
  act(() => {
    result.current.onNodesChange(
      moves.map(({ id, to }) => ({ id, type: "position" as const, position: to, dragging: true })),
    );
    result.current.onNodesChange(
      moves.map(({ id, to }) => ({ id, type: "position" as const, position: to, dragging: false })),
    );
  });

  const stoppedNodes: Node[] = moves.map(({ id, to }, i) => ({
    ...startNodes[i],
    id,
    position: to,
  }));
  act(() => {
    result.current.onNodeDragStop(DRAG_EVENT, stoppedNodes[0], stoppedNodes);
  });
}

describe("useWorkflowCanvas — drag → model sync (oss#602)", () => {
  it("writes the dragged position into the graph model", () => {
    const { result } = renderCanvas();
    const target = { x: 640, y: 480 };

    drag(result, [{ id: "step_2", to: target }]);

    expect(modelPosition(result, "step_2")).toEqual(target);
    expect(canvasPosition(result, "step_2")).toEqual(target);
  });

  it("a dragged position survives a later dispatch (the snap-back repro)", () => {
    const { result } = renderCanvas();
    const target = { x: 640, y: 480 };

    drag(result, [{ id: "step_2", to: target }]);

    // Any dispatch triggers syncFromModel, which rebuilds the canvas from
    // the model — on main this snapped step_2 back to its stale position.
    act(() => {
      result.current.renameNode("step_1", "step_1_renamed");
    });

    expect(result.current.nodes.map((n) => n.id)).toContain("step_1_renamed");
    expect(canvasPosition(result, "step_2")).toEqual(target);
    expect(modelPosition(result, "step_2")).toEqual(target);
  });

  it("undo restores pre-drag positions on model AND canvas; redo reapplies", () => {
    const { result } = renderCanvas();
    const before = canvasPosition(result, "step_2");
    const target = { x: 640, y: 480 };

    drag(result, [{ id: "step_2", to: target }]);
    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.undo();
    });
    expect(modelPosition(result, "step_2")).toEqual(before);
    expect(canvasPosition(result, "step_2")).toEqual(before);

    act(() => {
      result.current.redo();
    });
    expect(modelPosition(result, "step_2")).toEqual(target);
    expect(canvasPosition(result, "step_2")).toEqual(target);
  });

  it("a multi-select drag is ONE history entry — a single undo restores the group", () => {
    const { result } = renderCanvas();
    const before1 = canvasPosition(result, "step_1");
    const before2 = canvasPosition(result, "step_2");

    drag(result, [
      { id: "step_1", to: { x: 100, y: 700 } },
      { id: "step_2", to: { x: 300, y: 700 } },
    ]);
    expect(modelPosition(result, "step_1")).toEqual({ x: 100, y: 700 });
    expect(modelPosition(result, "step_2")).toEqual({ x: 300, y: 700 });

    act(() => {
      result.current.undo();
    });
    expect(modelPosition(result, "step_1")).toEqual(before1);
    expect(modelPosition(result, "step_2")).toEqual(before2);
    expect(result.current.canUndo).toBe(false);
  });

  it("a zero-delta drag records no history entry", () => {
    const { result } = renderCanvas();
    const before = canvasPosition(result, "step_2");

    drag(result, [{ id: "step_2", to: before }]);

    expect(result.current.canUndo).toBe(false);
  });

  it("selection survives a drag (record-only dispatch: no canvas rebuild)", () => {
    const { result } = renderCanvas();

    act(() => {
      result.current.onNodesChange([{ id: "step_2", type: "select", selected: true }]);
    });
    expect(result.current.nodes.find((n) => n.id === "step_2")?.selected).toBe(true);

    drag(result, [{ id: "step_2", to: { x: 640, y: 480 } }]);

    // A syncing dispatch would rebuild the node array from the model and
    // wipe React Flow's `selected` flags — the record-only invariant
    // keeps the just-dragged node selected. Pinned so a refactor to the
    // syncing dispatch() fails here.
    expect(result.current.nodes.find((n) => n.id === "step_2")?.selected).toBe(true);
  });

  it("a drag invalidated by a mid-drag model mutation records nothing", () => {
    const { result } = renderCanvas();
    const startNode = result.current.nodes.find((n) => n.id === "step_2")!;

    act(() => {
      result.current.onNodeDragStart(DRAG_EVENT, startNode, [startNode]);
    });
    // A mutation lands while the mouse is still down (keyboard undo and
    // the host's YAML prop are both reachable mid-drag). syncFromModel
    // already rebuilt the canvas, so the drag has nothing valid to record.
    act(() => {
      result.current.renameNode("step_1", "step_1_renamed");
    });
    act(() => {
      result.current.onNodeDragStop(DRAG_EVENT, { ...startNode, position: { x: 640, y: 480 } }, [
        { ...startNode, position: { x: 640, y: 480 } },
      ]);
    });

    expect(modelPosition(result, "step_2")).not.toEqual({ x: 640, y: 480 });

    // Only the rename is in history: one undo drains it.
    act(() => {
      result.current.undo();
    });
    expect(result.current.canUndo).toBe(false);
  });
});
