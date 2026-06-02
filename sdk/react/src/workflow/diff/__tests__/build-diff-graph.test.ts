import { describe, test, expect } from "vitest";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphModel, WorkflowGraphNode, WorkflowGraphEdge } from "../../workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "../../workflow-graph-model";
import { computeGraphDiff } from "../graph-diff";
import { buildDiffGraph } from "../build-diff-graph";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  kind: WorkflowTaskKind = WorkflowTaskKind.http_call,
  config: JsonObject = {} as JsonObject,
): WorkflowGraphNode {
  return {
    id,
    taskName: id,
    kind,
    category: "invocation",
    config,
    position: { x: 0, y: 0 },
  };
}

function makeEdge(
  source: string,
  target: string,
  sourceHandle?: string,
): WorkflowGraphEdge {
  return {
    id: `e_${source}_${target}`,
    source,
    target,
    ...(sourceHandle && { sourceHandle }),
  };
}

function makeModel(
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[],
): WorkflowGraphModel {
  return {
    document: { dsl: "1.0.0", namespace: "test", name: "test", version: "0.0.1" },
    nodes: [
      makeNode(START_NODE_ID, WorkflowTaskKind.workflow_task_kind_unspecified),
      ...nodes,
      makeNode(END_NODE_ID, WorkflowTaskKind.workflow_task_kind_unspecified),
    ],
    edges,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildDiffGraph", () => {
  test("unchanged graphs produce merged model with same node/edge count", () => {
    const model = makeModel(
      [makeNode("task_a"), makeNode("task_b")],
      [
        makeEdge(START_NODE_ID, "task_a"),
        makeEdge("task_a", "task_b"),
        makeEdge("task_b", END_NODE_ID),
      ],
    );

    const diff = computeGraphDiff(model, model);
    const merged = buildDiffGraph(model, model, diff);

    expect(merged.nodes.length).toBe(model.nodes.length);
    expect(merged.edges.length).toBe(model.edges.length);
  });

  test("removed nodes are present in merged graph", () => {
    const before = makeModel(
      [makeNode("task_a"), makeNode("task_b"), makeNode("task_c")],
      [
        makeEdge(START_NODE_ID, "task_a"),
        makeEdge("task_a", "task_b"),
        makeEdge("task_b", "task_c"),
      ],
    );
    const after = makeModel(
      [makeNode("task_a"), makeNode("task_c")],
      [
        makeEdge(START_NODE_ID, "task_a"),
        makeEdge("task_a", "task_c"),
      ],
    );

    const diff = computeGraphDiff(before, after);
    const merged = buildDiffGraph(before, after, diff);

    const mergedNodeIds = merged.nodes.map((n) => n.id);
    expect(mergedNodeIds).toContain("task_b");
    expect(merged.nodes.length).toBe(after.nodes.length + 1);
  });

  test("removed edges are present in merged graph", () => {
    const before = makeModel(
      [makeNode("task_a"), makeNode("task_b")],
      [
        makeEdge(START_NODE_ID, "task_a"),
        makeEdge("task_a", "task_b"),
        makeEdge("task_b", END_NODE_ID),
      ],
    );
    const after = makeModel(
      [makeNode("task_a"), makeNode("task_b")],
      [
        makeEdge(START_NODE_ID, "task_a"),
        makeEdge("task_a", "task_b"),
      ],
    );

    const diff = computeGraphDiff(before, after);
    const merged = buildDiffGraph(before, after, diff);

    expect(merged.edges.length).toBe(after.edges.length + 1);
  });

  test("added nodes are present in merged graph", () => {
    const before = makeModel(
      [makeNode("task_a")],
      [makeEdge(START_NODE_ID, "task_a")],
    );
    const after = makeModel(
      [makeNode("task_a"), makeNode("task_b")],
      [makeEdge(START_NODE_ID, "task_a"), makeEdge("task_a", "task_b")],
    );

    const diff = computeGraphDiff(before, after);
    const merged = buildDiffGraph(before, after, diff);

    const mergedNodeIds = merged.nodes.map((n) => n.id);
    expect(mergedNodeIds).toContain("task_b");
  });

  test("uses after graph document metadata", () => {
    const before = makeModel([makeNode("task_a")], []);
    const after: WorkflowGraphModel = {
      ...makeModel([makeNode("task_a")], []),
      document: { dsl: "2.0.0", namespace: "prod", name: "updated", version: "1.0.0" },
    };

    const diff = computeGraphDiff(before, after);
    const merged = buildDiffGraph(before, after, diff);

    expect(merged.document.name).toBe("updated");
    expect(merged.document.version).toBe("1.0.0");
  });

  test("empty before (generate scenario) — all nodes present", () => {
    const emptyModel: WorkflowGraphModel = {
      document: { dsl: "1.0.0", namespace: "test", name: "test", version: "0.0.1" },
      nodes: [],
      edges: [],
    };
    const after = makeModel(
      [makeNode("task_a"), makeNode("task_b")],
      [makeEdge(START_NODE_ID, "task_a"), makeEdge("task_a", "task_b")],
    );

    const diff = computeGraphDiff(emptyModel, after);
    const merged = buildDiffGraph(emptyModel, after, diff);

    expect(merged.nodes.length).toBe(after.nodes.length);
    expect(merged.edges.length).toBe(after.edges.length);
  });
});
