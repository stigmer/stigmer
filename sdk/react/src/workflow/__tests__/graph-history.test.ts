import { describe, it, expect } from "vitest";
import { GraphHistory, DeleteNodeCommand } from "../graph-commands";
import { yamlToGraph } from "../workflow-graph-conversions";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model";

// Direct coverage for the GraphHistory command stack and the
// DeleteNodeCommand round-trip. Before oss#588 nothing exercised
// GraphHistory itself — the canvas-sync bug lived one layer up
// (useGraphHistory/useWorkflowCanvas), but the stack's synchronous
// return-the-model contract is what that fix builds on, so it is
// pinned here.

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

function nodeIds(model: { nodes: readonly { id: string }[] }): string[] {
  return model.nodes.map((n) => n.id);
}

describe("GraphHistory — delete/undo/redo round-trip", () => {
  it("dispatch(DeleteNodeCommand) removes the node and its edges", () => {
    const initial = yamlToGraph(FIXTURE_YAML);
    const history = new GraphHistory(initial);

    const next = history.dispatch(new DeleteNodeCommand("step_2", "step_2"));

    expect(nodeIds(next)).not.toContain("step_2");
    expect(next.edges.some((e) => e.source === "step_2" || e.target === "step_2")).toBe(false);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it("undo() synchronously returns the model with the node and edges restored", () => {
    const initial = yamlToGraph(FIXTURE_YAML);
    const history = new GraphHistory(initial);
    const deleted = history.dispatch(new DeleteNodeCommand("step_2", "step_2"));
    const removedEdgeCount = initial.edges.length - deleted.edges.length;
    expect(removedEdgeCount).toBeGreaterThan(0);

    const restored = history.undo();

    expect(nodeIds(restored)).toContain("step_2");
    expect(restored.edges).toHaveLength(initial.edges.length);
    expect(history.current).toBe(restored);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it("redo() synchronously returns the model with the node removed again", () => {
    const initial = yamlToGraph(FIXTURE_YAML);
    const history = new GraphHistory(initial);
    history.dispatch(new DeleteNodeCommand("step_2", "step_2"));
    history.undo();

    const redone = history.redo();

    expect(nodeIds(redone)).not.toContain("step_2");
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it("undo()/redo() on an empty stack return the current model unchanged", () => {
    const initial = yamlToGraph(FIXTURE_YAML);
    const history = new GraphHistory(initial);

    expect(history.undo()).toBe(initial);
    expect(history.redo()).toBe(initial);
  });

  it("sentinels survive the round-trip", () => {
    const initial = yamlToGraph(FIXTURE_YAML);
    const history = new GraphHistory(initial);
    history.dispatch(new DeleteNodeCommand("step_1", "step_1"));
    const restored = history.undo();

    expect(nodeIds(restored)).toContain(START_NODE_ID);
    expect(nodeIds(restored)).toContain(END_NODE_ID);
  });
});
