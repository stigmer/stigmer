import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { useWorkflowCanvas } from "../useWorkflowCanvas";

// Regression tests for oss#588: undoing a node deletion restored the graph
// MODEL (inspector rebinds, history entry consumed) but the React Flow
// nodes array was synced from a stale pre-undo snapshot, so the canvas
// node never reappeared. These tests exercise the hook composition — the
// exact layer the bug lived in; the pure command stack is covered in
// graph-history.test.ts.

const FIXTURE_YAML = `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: undo-fixture
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: undo-fixture
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

function canvasNodeIds(result: { current: { nodes: readonly { id: string }[] } }): string[] {
  return result.current.nodes.map((n) => n.id);
}

describe("useWorkflowCanvas — undo/redo canvas sync (oss#588)", () => {
  it("parses the fixture into canvas nodes", () => {
    const { result } = renderCanvas();
    expect(canvasNodeIds(result)).toEqual(
      expect.arrayContaining(["step_1", "step_2"]),
    );
  });

  it("undo after a node delete restores the node on the CANVAS, not just the model", () => {
    const { result } = renderCanvas();

    const target = result.current.nodes.find((n) => n.id === "step_2");
    expect(target).toBeDefined();

    act(() => {
      result.current.onNodesDelete([target!]);
    });
    expect(canvasNodeIds(result)).not.toContain("step_2");
    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.undo();
    });

    // The model restores (this always worked — the inspector saw it) …
    expect(result.current.graph?.nodes.map((n) => n.id)).toContain("step_2");
    // … and the canvas must restore with it (the oss#588 gap).
    expect(canvasNodeIds(result)).toContain("step_2");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it("undo restores the deleted node's edges on the canvas", () => {
    const { result } = renderCanvas();
    const edgeCountBefore = result.current.edges.length;

    const target = result.current.nodes.find((n) => n.id === "step_2");
    act(() => {
      result.current.onNodesDelete([target!]);
    });
    expect(result.current.edges.length).toBeLessThan(edgeCountBefore);

    act(() => {
      result.current.undo();
    });
    expect(result.current.edges.length).toBe(edgeCountBefore);
  });

  it("redo after an undo removes the node from the canvas again", () => {
    const { result } = renderCanvas();

    const target = result.current.nodes.find((n) => n.id === "step_2");
    act(() => {
      result.current.onNodesDelete([target!]);
    });
    act(() => {
      result.current.undo();
    });
    expect(canvasNodeIds(result)).toContain("step_2");

    act(() => {
      result.current.redo();
    });

    expect(result.current.graph?.nodes.map((n) => n.id)).not.toContain("step_2");
    expect(canvasNodeIds(result)).not.toContain("step_2");
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("undo with an empty history leaves the canvas untouched", () => {
    const { result } = renderCanvas();
    const before = canvasNodeIds(result);

    act(() => {
      result.current.undo();
    });

    expect(canvasNodeIds(result)).toEqual(before);
  });
});
