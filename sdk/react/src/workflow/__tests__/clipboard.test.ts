import { describe, it, expect } from "vitest";
import { serializeSelection, pasteClipboard } from "../clipboard";
import type { ClipboardEntry } from "../clipboard";
import type {
  WorkflowGraphModel,
  WorkflowGraphNode,
  WorkflowGraphEdge,
} from "../workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model";
import type { JsonObject } from "@bufbuild/protobuf";

function makeNode(id: string, kind = 1, x = 0, y = 0): WorkflowGraphNode {
  return {
    id,
    taskName: id,
    kind: kind as any,
    category: "ai" as any,
    config: { foo: "bar" } as unknown as JsonObject,
    position: { x, y },
  };
}

function makeEdge(id: string, source: string, target: string): WorkflowGraphEdge {
  return { id, source, target };
}

function makeModel(
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[] = [],
): WorkflowGraphModel {
  return {
    document: { dsl: "1.0", namespace: "test", name: "test", version: "1" },
    nodes,
    edges,
  };
}

describe("serializeSelection", () => {
  it("returns null for empty selection", () => {
    const model = makeModel([makeNode("a")]);
    expect(serializeSelection(model, new Set())).toBeNull();
  });

  it("excludes sentinel nodes", () => {
    const model = makeModel([
      makeNode(START_NODE_ID),
      makeNode("task_1"),
      makeNode(END_NODE_ID),
    ]);
    const result = serializeSelection(
      model,
      new Set([START_NODE_ID, "task_1", END_NODE_ID]),
    );
    expect(result).not.toBeNull();
    expect(result!.nodes).toHaveLength(1);
    expect(result!.nodes[0].id).toBe("task_1");
  });

  it("returns null when only sentinels are selected", () => {
    const model = makeModel([makeNode(START_NODE_ID), makeNode(END_NODE_ID)]);
    expect(
      serializeSelection(model, new Set([START_NODE_ID, END_NODE_ID])),
    ).toBeNull();
  });

  it("serializes a single node with no edges", () => {
    const model = makeModel([makeNode("a"), makeNode("b")]);
    const result = serializeSelection(model, new Set(["a"]));
    expect(result!.nodes).toHaveLength(1);
    expect(result!.nodes[0].id).toBe("a");
    expect(result!.edges).toHaveLength(0);
  });

  it("includes edges where both endpoints are selected", () => {
    const model = makeModel(
      [makeNode("a"), makeNode("b"), makeNode("c")],
      [makeEdge("e1", "a", "b"), makeEdge("e2", "b", "c")],
    );
    const result = serializeSelection(model, new Set(["a", "b"]));
    expect(result!.nodes).toHaveLength(2);
    expect(result!.edges).toHaveLength(1);
    expect(result!.edges[0].id).toBe("e1");
  });

  it("excludes edges where one endpoint is outside the selection", () => {
    const model = makeModel(
      [makeNode("a"), makeNode("b")],
      [makeEdge("e1", "a", "b")],
    );
    const result = serializeSelection(model, new Set(["a"]));
    expect(result!.edges).toHaveLength(0);
  });

  it("deep-clones node config so mutations are isolated", () => {
    const node = makeNode("a");
    const model = makeModel([node]);
    const result = serializeSelection(model, new Set(["a"]));
    expect(result!.nodes[0].config).toEqual(node.config);
    expect(result!.nodes[0].config).not.toBe(node.config);
  });
});

describe("pasteClipboard", () => {
  it("returns null for empty clipboard entry", () => {
    const entry: ClipboardEntry = { nodes: [], edges: [] };
    const model = makeModel([]);
    expect(pasteClipboard(entry, model)).toBeNull();
  });

  it("generates unique task names that don't collide with existing", () => {
    const entry: ClipboardEntry = {
      nodes: [makeNode("agent_call_1", 1, 10, 20)],
      edges: [],
    };
    const model = makeModel([makeNode("agent_call_1")]);
    const result = pasteClipboard(entry, model);
    expect(result).not.toBeNull();
    expect(result!.newNodeIds).toHaveLength(1);
    expect(result!.newNodeIds[0]).not.toBe("agent_call_1");
    expect(result!.newNodeIds[0]).toMatch(/^agent_call_\d+$/);
  });

  it("offsets positions by default paste offset", () => {
    const entry: ClipboardEntry = {
      nodes: [makeNode("a", 1, 100, 200)],
      edges: [],
    };
    const model = makeModel([]);
    const result = pasteClipboard(entry, model);
    const cmd = result!.command;

    const applied = cmd.apply(model);
    const pasted = applied.nodes.find((n) => n.id === result!.newNodeIds[0]);
    expect(pasted!.position.x).toBe(140);
    expect(pasted!.position.y).toBe(240);
  });

  it("accepts a custom position offset", () => {
    const entry: ClipboardEntry = {
      nodes: [makeNode("a", 1, 0, 0)],
      edges: [],
    };
    const model = makeModel([]);
    const result = pasteClipboard(entry, model, { x: 100, y: 200 });
    const applied = result!.command.apply(model);
    const pasted = applied.nodes.find((n) => n.id === result!.newNodeIds[0]);
    expect(pasted!.position.x).toBe(100);
    expect(pasted!.position.y).toBe(200);
  });

  it("remaps edge source/target to new node IDs", () => {
    const entry: ClipboardEntry = {
      nodes: [makeNode("a", 1, 0, 0), makeNode("b", 2, 100, 0)],
      edges: [makeEdge("e1", "a", "b")],
    };
    const model = makeModel([]);
    const result = pasteClipboard(entry, model);
    expect(result!.newNodeIds).toHaveLength(2);

    const applied = result!.command.apply(model);
    const newEdges = applied.edges;
    expect(newEdges).toHaveLength(1);
    expect(newEdges[0].source).toBe(result!.newNodeIds[0]);
    expect(newEdges[0].target).toBe(result!.newNodeIds[1]);
    expect(newEdges[0].id).not.toBe("e1");
  });

  it("generates unique names across multiple pasted nodes", () => {
    const entry: ClipboardEntry = {
      nodes: [
        makeNode("agent_call_1", 1),
        makeNode("agent_call_2", 1),
      ],
      edges: [],
    };
    const model = makeModel([makeNode("agent_call_1"), makeNode("agent_call_2")]);
    const result = pasteClipboard(entry, model);
    const ids = new Set(result!.newNodeIds);
    expect(ids.size).toBe(2);
    expect(ids.has("agent_call_1")).toBe(false);
    expect(ids.has("agent_call_2")).toBe(false);
  });

  it("clears export and flow on pasted nodes", () => {
    const node: WorkflowGraphNode = {
      ...makeNode("a"),
      export: { as: "result" },
      flow: { then: "b" },
    };
    const entry: ClipboardEntry = { nodes: [node], edges: [] };
    const model = makeModel([]);
    const result = pasteClipboard(entry, model);
    const applied = result!.command.apply(model);
    const pasted = applied.nodes.find((n) => n.id === result!.newNodeIds[0]);
    expect(pasted!.export).toBeUndefined();
    expect(pasted!.flow).toBeUndefined();
  });

  it("returns a compound command that is undoable", () => {
    const entry: ClipboardEntry = {
      nodes: [makeNode("a", 1, 10, 20)],
      edges: [],
    };
    const model = makeModel([makeNode("existing")]);
    const result = pasteClipboard(entry, model);
    const applied = result!.command.apply(model);
    expect(applied.nodes).toHaveLength(2);

    const undone = result!.command.undo(applied);
    expect(undone.nodes).toHaveLength(1);
    expect(undone.nodes[0].id).toBe("existing");
  });
});
