// Pins the canvas editor's right-click and keyboard flows end to end, from
// the gesture to the graph it edits:
//
// - a node's context menu duplicates the task and closes;
// - "Add task after" is the two-step flow: the menu closes, the task picker
//   opens anchored where the menu was, and the chosen kind lands after the
//   node, wired to it;
// - the pane's menu adds the chosen kind as a new task;
// - an edge's menu deletes the connection;
// - with focus in the editor, `N` opens the picker, Escape dismisses it, and
//   Cmd/Ctrl+Z undoes the last edit.
//
// React Flow itself is replaced by a stub that renders one button per node
// and edge and forwards the gestures to the handlers the editor hands it,
// so the real context menu, task picker and keyboard shortcuts run against
// the real canvas hook without a layout engine in happy-dom.
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import type { WorkflowCanvasInner } from "../WorkflowCanvasInner";
import type { CanvasTaskNodeData } from "../workflow-graph-conversions";
import { TaskKindRegistryContext } from "../TaskKindRegistryContext";
import type { TaskKindDescriptor } from "../types";
import { WorkflowCanvasEditor } from "../WorkflowCanvasEditor";

type InnerProps = Parameters<typeof WorkflowCanvasInner>[0];

vi.mock("../WorkflowCanvasInner", () => ({
  WorkflowCanvasInner: (props: InnerProps) => (
    <div data-testid="canvas-pane" onContextMenu={(e) => props.onPaneContextMenu?.(e)}>
      {props.nodes.map((node: Node) => (
        <button
          key={node.id}
          type="button"
          data-testid={`node:${(node.data as CanvasTaskNodeData).taskName}`}
          onClick={(e) => props.onNodeClick(e, node)}
          onContextMenu={(e) => {
            e.stopPropagation();
            props.onNodeContextMenu?.(e, node);
          }}
        >
          {(node.data as CanvasTaskNodeData).taskName}
        </button>
      ))}
      {props.edges.map((edge) => (
        <button
          key={edge.id}
          type="button"
          data-testid={`edge:${edge.source}->${edge.target}`}
          onContextMenu={(e) => {
            e.stopPropagation();
            props.onEdgeContextMenu?.(e, edge);
          }}
        >
          {edge.id}
        </button>
      ))}
    </div>
  ),
}));

const FIXTURE_YAML = `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: menu-fixture
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: menu-fixture
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

function descriptor(kind: string, displayName: string, category: TaskKindDescriptor["category"]): TaskKindDescriptor {
  return {
    kind,
    displayName,
    description: `${displayName} task`,
    category,
    icon: "box",
    configProtoType: "",
    fields: [],
    fieldGroups: [],
    configJsonSchema: {},
    documentationUrl: "",
    isAiNative: false,
    requiresExternalService: false,
  };
}

const REGISTRY = {
  descriptors: [descriptor("llm_call", "LLM Call", "ai"), descriptor("set", "Set Variables", "data")],
  isLoading: false,
  error: null,
  refetch: () => {},
};

afterEach(cleanup);

function renderEditor() {
  const view = render(
    <TaskKindRegistryContext.Provider value={REGISTRY}>
      <WorkflowCanvasEditor yaml={FIXTURE_YAML} showPalette={false} showInspector={false} />
    </TaskKindRegistryContext.Provider>,
  );
  return view;
}

/** The task nodes the stub canvas renders, by task name (sentinels included). */
function nodeNames(): string[] {
  return screen.queryAllByTestId(/^node:/).map((el) => el.textContent ?? "");
}

async function openNodeMenu(taskName: string) {
  const node = await screen.findByTestId(`node:${taskName}`);
  fireEvent.contextMenu(node, { clientX: 140, clientY: 90 });
}

describe("WorkflowCanvasEditor — context menus and the task picker", () => {
  it("duplicates a task from its context menu, and the menu closes", async () => {
    renderEditor();
    await screen.findByTestId("node:step_1");
    const before = nodeNames().length;

    await openNodeMenu("step_1");
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Duplicate/ }));

    await waitFor(() => expect(nodeNames()).toHaveLength(before + 1));
    expect(screen.queryByRole("menuitem", { name: /^Duplicate/ })).toBeNull();
  });

  it("adds a task after a node through the menu-to-picker flow, wired to that node", async () => {
    renderEditor();
    await screen.findByTestId("node:step_2");
    const before = nodeNames();

    await openNodeMenu("step_2");
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Add task after/ }));

    // The menu hands off to the picker.
    expect(await screen.findByRole("dialog", { name: "Select task type" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^Add task after/ })).toBeNull();
    // The picker can list a kind twice (a suggestion and its category); either
    // picks it.
    fireEvent.click((await screen.findAllByRole("option", { name: /LLM Call/ }))[0]!);

    await waitFor(() => expect(nodeNames()).toHaveLength(before.length + 1));
    const added = nodeNames().find((name) => !before.includes(name));
    expect(added).toBeDefined();
    expect(screen.getByTestId(`edge:step_2->${added}`)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Select task type" })).toBeNull();
  });

  it("adds a task from the pane's context menu", async () => {
    renderEditor();
    await screen.findByTestId("node:step_1");
    const before = nodeNames().length;

    fireEvent.contextMenu(screen.getByTestId("canvas-pane"), { clientX: 400, clientY: 300 });
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Add task…/ }));
    fireEvent.click((await screen.findAllByRole("option", { name: /Set Variables/ }))[0]!);

    await waitFor(() => expect(nodeNames()).toHaveLength(before + 1));
  });

  it("deletes a connection from the edge's context menu", async () => {
    renderEditor();
    const edge = await screen.findByTestId("edge:step_1->step_2");

    fireEvent.contextMenu(edge, { clientX: 200, clientY: 120 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete connection" }));

    await waitFor(() => expect(screen.queryByTestId("edge:step_1->step_2")).toBeNull());
  });
});

describe("WorkflowCanvasEditor — keyboard shortcuts", () => {
  it("opens the picker on N, dismisses it on Escape, and undoes the last edit on Cmd/Ctrl+Z", async () => {
    const { container } = renderEditor();
    await screen.findByTestId("node:step_1");
    const root = container.querySelector<HTMLDivElement>("[tabindex='-1']");
    expect(root).not.toBeNull();
    act(() => root!.focus());

    fireEvent.keyDown(document, { key: "n" });
    expect(await screen.findByRole("dialog", { name: "Select task type" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Select task type" })).toBeNull());

    const before = nodeNames().length;
    await openNodeMenu("step_1");
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Duplicate/ }));
    await waitFor(() => expect(nodeNames()).toHaveLength(before + 1));

    act(() => root!.focus());
    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    await waitFor(() => expect(nodeNames()).toHaveLength(before));
  });
});
