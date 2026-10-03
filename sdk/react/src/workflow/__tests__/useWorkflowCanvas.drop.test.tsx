// Pins the canvas's drop-to-create path on an empty canvas: the first task
// dropped onto a workflow with no graph yet bootstraps the Start and End
// sentinels, wires Start to the new task, and keeps the task exactly where
// it was dropped — the drop does not re-layout the graph. A second drop
// adds an unconnected task beside it, and a drag that carries no task kind
// changes nothing. The hook is driven the way React Flow drives it: a drop
// event whose dataTransfer carries the palette's task-kind payload.
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode, DragEvent } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model";
import { TASK_KIND_DRAG_MIME } from "../WorkflowTaskPalette";
import { useWorkflowCanvas } from "../useWorkflowCanvas";

function wrapper({ children }: { children: ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

/** A drop event as React Flow's pane forwards it: a payload and a pointer position. */
function dropEvent(kind: string, at: { x: number; y: number }): DragEvent {
  return {
    preventDefault: () => {},
    clientX: at.x,
    clientY: at.y,
    dataTransfer: { getData: (mime: string) => (mime === TASK_KIND_DRAG_MIME ? kind : "") },
  } as unknown as DragEvent;
}

describe("useWorkflowCanvas — dropping a task onto an empty canvas", () => {
  it("bootstraps Start and End, wires Start to the dropped task, and keeps the drop position", () => {
    const { result } = renderHook(() => useWorkflowCanvas(null), { wrapper });
    expect(result.current.getGraphModel().nodes).toEqual([]);

    act(() => result.current.onDrop(dropEvent("agent_call", { x: 320, y: 140 })));

    const model = result.current.getGraphModel();
    const ids = model.nodes.map((n) => n.id);
    expect(ids).toContain(START_NODE_ID);
    expect(ids).toContain(END_NODE_ID);

    const tasks = model.nodes.filter((n) => n.id !== START_NODE_ID && n.id !== END_NODE_ID);
    expect(tasks).toHaveLength(1);
    const [task] = tasks;
    expect(task!.taskName).toMatch(/agent/i);
    // No re-layout: the task sits where it was dropped (no React Flow
    // viewport is mounted, so screen and flow coordinates coincide).
    expect(task!.position).toEqual({ x: 320, y: 140 });

    expect(model.edges).toEqual([expect.objectContaining({ source: START_NODE_ID, target: task!.id })]);
  });

  it("adds a second dropped task without wiring it, and ignores a drag with no task kind", () => {
    const { result } = renderHook(() => useWorkflowCanvas(null), { wrapper });

    act(() => result.current.onDrop(dropEvent("agent_call", { x: 100, y: 100 })));
    act(() => result.current.onDrop(dropEvent("llm_call", { x: 400, y: 100 })));
    act(() => result.current.onDrop(dropEvent("", { x: 700, y: 100 })));

    const model = result.current.getGraphModel();
    const tasks = model.nodes.filter((n) => n.id !== START_NODE_ID && n.id !== END_NODE_ID);
    expect(tasks).toHaveLength(2);
    expect(model.edges).toHaveLength(1);
    expect(result.current.isDirty).toBe(true);
  });
});
