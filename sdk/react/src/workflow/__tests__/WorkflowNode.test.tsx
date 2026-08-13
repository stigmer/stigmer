import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { NodeProps } from "@xyflow/react";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { WorkflowNode } from "../WorkflowNode";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model";
import type { CanvasTaskNodeData } from "../workflow-graph-conversions";

// NodeHandles and NodeActions render @xyflow/react primitives (Handle,
// NodeToolbar) that throw outside a live React Flow canvas. Stub them so
// WorkflowNode's own DOM contract can be asserted in isolation — the
// established pattern for React Flow-adjacent component tests in this suite.
vi.mock("../node-shell/NodeHandles.js", () => ({
  NodeHandles: () => null,
}));
vi.mock("../node-shell/NodeActions.js", () => ({
  NodeActions: () => null,
}));

function makeData(overrides: Partial<CanvasTaskNodeData>): CanvasTaskNodeData {
  return {
    taskName: "analyze",
    kind: WorkflowTaskKind.agent_call,
    kindString: "agent_call",
    category: "ai",
    visualClass: "task-card",
    displayName: "Agent Call",
    ariaShapeLabel: "card",
    config: {},
    isSentinel: false,
    ...overrides,
  };
}

function renderNode(id: string, data: CanvasTaskNodeData) {
  const props = { id, data, selected: false } as unknown as NodeProps & {
    data: CanvasTaskNodeData;
  };
  return render(<WorkflowNode {...props} />);
}

afterEach(cleanup);

describe("WorkflowNode data-task-kind contract (oss#581)", () => {
  test("task nodes expose their kind string as data-task-kind", () => {
    const { container } = renderNode("analyze", makeData({}));
    const node = container.querySelector('[role="button"]');
    expect(node).not.toBeNull();
    expect(node!.getAttribute("data-task-kind")).toBe("agent_call");
  });

  test("sentinel nodes carry no data-task-kind attribute", () => {
    for (const [id, taskName] of [
      [START_NODE_ID, "Start"],
      [END_NODE_ID, "End"],
    ] as const) {
      const { container, unmount } = renderNode(
        id,
        makeData({
          taskName,
          kind: WorkflowTaskKind.workflow_task_kind_unspecified,
          kindString: id,
          category: id === START_NODE_ID ? "start" : "end",
          visualClass: "terminal-pill",
          displayName: taskName,
          ariaShapeLabel: "pill",
          isSentinel: true,
        }),
      );
      const node = container.querySelector('[role="button"]');
      expect(node).not.toBeNull();
      expect(node!.hasAttribute("data-task-kind")).toBe(false);
      unmount();
    }
  });

  test("the internal unknown_* enum fallback never reaches the DOM", () => {
    const { container } = renderNode(
      START_NODE_ID,
      makeData({
        taskName: "Start",
        kind: WorkflowTaskKind.workflow_task_kind_unspecified,
        kindString: START_NODE_ID,
        category: "start",
        visualClass: "terminal-pill",
        displayName: "Start",
        ariaShapeLabel: "pill",
        isSentinel: true,
      }),
    );
    expect(container.querySelector('[data-task-kind^="unknown_"]')).toBeNull();
  });
});
