import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { useWorkflowCanvas } from "../useWorkflowCanvas";

// Regression tests for oss#609: isDirty was a model-reference comparison
// while graphToYaml serializes no positions. A position-only edit session
// (drag, auto-layout) armed Save and showed "Modified", but saving
// round-tripped byte-identical YAML — and because hosts reset the baseline
// by feeding saved YAML back through the `yaml` prop (string-change gated),
// the flag could never clear. Dirty now means "saving would change the
// document": position-only sessions never arm, content saves still clear
// through the yaml-prop feedback loop.

const FIXTURE_YAML = `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: dirty-fixture
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: dirty-fixture
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
  return renderHook(({ yaml }: { yaml: string }) => useWorkflowCanvas(yaml), {
    initialProps: { yaml: FIXTURE_YAML },
    wrapper,
  });
}

type CanvasResult = ReturnType<typeof renderCanvas>["result"];

const DRAG_EVENT = {} as React.MouseEvent;

/** Drives one full drag gesture the way React Flow produces it. */
function drag(result: CanvasResult, id: string, to: { x: number; y: number }) {
  const startNode = result.current.nodes.find((n) => n.id === id);
  expect(startNode).toBeDefined();

  act(() => {
    result.current.onNodeDragStart(DRAG_EVENT, startNode!, [startNode!]);
  });
  act(() => {
    result.current.onNodesChange([{ id, type: "position", position: to, dragging: true }]);
    result.current.onNodesChange([{ id, type: "position", position: to, dragging: false }]);
  });
  const stopped: Node = { ...startNode!, position: to };
  act(() => {
    result.current.onNodeDragStop(DRAG_EVENT, stopped, [stopped]);
  });
}

describe("useWorkflowCanvas — dirty semantics (oss#609)", () => {
  it("a drag-only session is NOT dirty — saving it would change nothing", () => {
    const { result } = renderCanvas();
    expect(result.current.isDirty).toBe(false);

    drag(result, "step_2", { x: 640, y: 480 });

    // The drag IS in the model and undoable (oss#602)…
    expect(result.current.canUndo).toBe(true);
    // …but positions don't serialize, so the document is unchanged.
    expect(result.current.isDirty).toBe(false);
  });

  it("an auto-layout-only session is NOT dirty", async () => {
    const { result } = renderCanvas();

    // Nudge a node off its dagre position first so auto-layout has real
    // work to do (a no-op layout wouldn't even dispatch).
    drag(result, "step_2", { x: 640, y: 480 });
    await act(async () => {
      await result.current.autoLayout();
    });

    expect(result.current.canUndo).toBe(true);
    expect(result.current.isDirty).toBe(false);
  });

  it("a content edit IS dirty", () => {
    const { result } = renderCanvas();

    act(() => {
      result.current.renameNode("step_1", "step_1_renamed");
    });

    expect(result.current.isDirty).toBe(true);
  });

  it("a content edit that is undone is NOT dirty again", () => {
    const { result } = renderCanvas();

    act(() => {
      result.current.renameNode("step_1", "step_1_renamed");
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.undo();
    });
    expect(result.current.isDirty).toBe(false);
  });

  it("the save feedback loop clears dirty: edit → serialize → feed back through the yaml prop", () => {
    const { result, rerender } = renderCanvas();

    act(() => {
      result.current.renameNode("step_1", "step_1_renamed");
    });
    expect(result.current.isDirty).toBe(true);

    // WorkflowEditorView's handleCanvasSave: serializeToYaml() → setYaml()
    // → the string re-enters through the `yaml` prop and resets the baseline.
    const saved = result.current.serializeToYaml();
    expect(saved).not.toBeNull();
    rerender({ yaml: saved! });

    expect(result.current.isDirty).toBe(false);
  });

  it("drag + content edit is dirty; the save loop clears it even though positions never persist", () => {
    const { result, rerender } = renderCanvas();

    drag(result, "step_2", { x: 640, y: 480 });
    act(() => {
      result.current.renameNode("step_1", "step_1_renamed");
    });
    expect(result.current.isDirty).toBe(true);

    const saved = result.current.serializeToYaml();
    expect(saved).not.toBeNull();
    rerender({ yaml: saved! });

    // Pre-#609 this was the trap: the position delta kept the model
    // reference unequal forever, so dirty survived its own save.
    expect(result.current.isDirty).toBe(false);
  });

  it("cosmetic YAML formatting differences do not read as dirty", () => {
    // Host YAML with extra blank lines / comments parses to the same model;
    // the baseline is the canonical re-serialization, so the comparison is
    // canonical-vs-canonical from the first render.
    const cosmetic = `${FIXTURE_YAML}\n# trailing comment\n`;
    const { result } = renderHook(({ yaml }: { yaml: string }) => useWorkflowCanvas(yaml), {
      initialProps: { yaml: cosmetic },
      wrapper,
    });

    expect(result.current.isDirty).toBe(false);

    drag(result, "step_2", { x: 640, y: 480 });
    expect(result.current.isDirty).toBe(false);
  });
});
