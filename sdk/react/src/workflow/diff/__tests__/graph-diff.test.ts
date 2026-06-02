import { describe, test, expect } from "vitest";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphModel, WorkflowGraphNode, WorkflowGraphEdge } from "../../workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "../../workflow-graph-model";
import { computeGraphDiff, jsonEqual } from "../graph-diff";

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
// jsonEqual tests
// ---------------------------------------------------------------------------

describe("jsonEqual", () => {
  test("primitive equality", () => {
    expect(jsonEqual(1, 1)).toBe(true);
    expect(jsonEqual("a", "a")).toBe(true);
    expect(jsonEqual(true, true)).toBe(true);
    expect(jsonEqual(null, null)).toBe(true);
  });

  test("primitive inequality", () => {
    expect(jsonEqual(1, 2)).toBe(false);
    expect(jsonEqual("a", "b")).toBe(false);
    expect(jsonEqual(1, "1")).toBe(false);
    expect(jsonEqual(null, undefined)).toBe(false);
  });

  test("array equality", () => {
    expect(jsonEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(jsonEqual([], [])).toBe(true);
  });

  test("array inequality", () => {
    expect(jsonEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
  });

  test("object equality", () => {
    expect(jsonEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(jsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(jsonEqual({}, {})).toBe(true);
  });

  test("object inequality", () => {
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  test("nested objects", () => {
    expect(
      jsonEqual(
        { a: { b: [1, 2], c: "x" } },
        { a: { b: [1, 2], c: "x" } },
      ),
    ).toBe(true);
    expect(
      jsonEqual(
        { a: { b: [1, 2], c: "x" } },
        { a: { b: [1, 3], c: "x" } },
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeGraphDiff tests
// ---------------------------------------------------------------------------

describe("computeGraphDiff", () => {
  test("identical graphs → all unchanged", () => {
    const nodeA = makeNode("task_a");
    const model = makeModel(
      [nodeA],
      [makeEdge(START_NODE_ID, "task_a"), makeEdge("task_a", END_NODE_ID)],
    );

    const diff = computeGraphDiff(model, model);

    expect(diff.summary).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(diff.nodes.get("task_a")?.status).toBe("unchanged");
  });

  test("node added", () => {
    const before = makeModel(
      [makeNode("task_a")],
      [makeEdge(START_NODE_ID, "task_a")],
    );
    const after = makeModel(
      [makeNode("task_a"), makeNode("task_b")],
      [makeEdge(START_NODE_ID, "task_a"), makeEdge("task_a", "task_b")],
    );

    const diff = computeGraphDiff(before, after);

    expect(diff.summary.added).toBe(1);
    expect(diff.nodes.get("task_b")?.status).toBe("added");
    expect(diff.nodes.get("task_a")?.status).toBe("unchanged");
  });

  test("node removed", () => {
    const before = makeModel(
      [makeNode("task_a"), makeNode("task_b")],
      [makeEdge(START_NODE_ID, "task_a"), makeEdge("task_a", "task_b")],
    );
    const after = makeModel(
      [makeNode("task_a")],
      [makeEdge(START_NODE_ID, "task_a")],
    );

    const diff = computeGraphDiff(before, after);

    expect(diff.summary.removed).toBe(1);
    expect(diff.nodes.get("task_b")?.status).toBe("removed");
    expect(diff.nodes.get("task_b")?.beforeNode).toBeDefined();
  });

  test("node modified — config change", () => {
    const before = makeModel(
      [makeNode("task_a", WorkflowTaskKind.http_call, { url: "http://a.com" } as JsonObject)],
      [makeEdge(START_NODE_ID, "task_a")],
    );
    const after = makeModel(
      [makeNode("task_a", WorkflowTaskKind.http_call, { url: "http://b.com" } as JsonObject)],
      [makeEdge(START_NODE_ID, "task_a")],
    );

    const diff = computeGraphDiff(before, after);

    expect(diff.summary.modified).toBe(1);
    expect(diff.nodes.get("task_a")?.status).toBe("modified");
    expect(diff.nodes.get("task_a")?.changedFields).toEqual(["url"]);
  });

  test("node modified — kind change", () => {
    const before = makeModel(
      [makeNode("task_a", WorkflowTaskKind.http_call)],
      [makeEdge(START_NODE_ID, "task_a")],
    );
    const after = makeModel(
      [makeNode("task_a", WorkflowTaskKind.agent_call)],
      [makeEdge(START_NODE_ID, "task_a")],
    );

    const diff = computeGraphDiff(before, after);

    expect(diff.summary.modified).toBe(1);
    expect(diff.nodes.get("task_a")?.status).toBe("modified");
  });

  test("sentinels excluded from diff", () => {
    const model = makeModel(
      [makeNode("task_a")],
      [makeEdge(START_NODE_ID, "task_a"), makeEdge("task_a", END_NODE_ID)],
    );

    const diff = computeGraphDiff(model, model);

    expect(diff.nodes.has(START_NODE_ID)).toBe(false);
    expect(diff.nodes.has(END_NODE_ID)).toBe(false);
  });

  test("edge added by semantic triple", () => {
    const before = makeModel(
      [makeNode("task_a"), makeNode("task_b")],
      [makeEdge(START_NODE_ID, "task_a")],
    );
    const after = makeModel(
      [makeNode("task_a"), makeNode("task_b")],
      [makeEdge(START_NODE_ID, "task_a"), makeEdge("task_a", "task_b")],
    );

    const diff = computeGraphDiff(before, after);

    const addedEdges = [...diff.edges.values()].filter((e) => e.status === "added");
    expect(addedEdges.length).toBe(1);
  });

  test("edge removed by semantic triple", () => {
    const before = makeModel(
      [makeNode("task_a"), makeNode("task_b")],
      [makeEdge(START_NODE_ID, "task_a"), makeEdge("task_a", "task_b")],
    );
    const after = makeModel(
      [makeNode("task_a"), makeNode("task_b")],
      [makeEdge(START_NODE_ID, "task_a")],
    );

    const diff = computeGraphDiff(before, after);

    const removedEdges = [...diff.edges.values()].filter((e) => e.status === "removed");
    expect(removedEdges.length).toBe(1);
  });

  test("branch edges matched by sourceHandle", () => {
    const before = makeModel(
      [makeNode("switch"), makeNode("case_a"), makeNode("case_b")],
      [
        makeEdge(START_NODE_ID, "switch"),
        makeEdge("switch", "case_a", "case_yes"),
        makeEdge("switch", "case_b", "case_no"),
      ],
    );
    const after = makeModel(
      [makeNode("switch"), makeNode("case_a"), makeNode("case_c")],
      [
        makeEdge(START_NODE_ID, "switch"),
        makeEdge("switch", "case_a", "case_yes"),
        makeEdge("switch", "case_c", "case_maybe"),
      ],
    );

    const diff = computeGraphDiff(before, after);

    const removedEdges = [...diff.edges.values()].filter((e) => e.status === "removed");
    const addedEdges = [...diff.edges.values()].filter((e) => e.status === "added");
    expect(removedEdges.length).toBe(1);
    expect(addedEdges.length).toBe(1);
  });

  test("empty before (generate scenario) — all nodes added", () => {
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

    expect(diff.summary.added).toBe(2);
    expect(diff.summary.removed).toBe(0);
    expect(diff.summary.modified).toBe(0);
  });

  test("config deep equality with nested objects and arrays", () => {
    const config1 = {
      cases: [
        { name: "yes", when: "true", then: "next" },
        { name: "no", when: "false", then: "end" },
      ],
    } as JsonObject;
    const config2 = {
      cases: [
        { name: "yes", when: "true", then: "next" },
        { name: "no", when: "false", then: "end" },
      ],
    } as JsonObject;

    const before = makeModel(
      [makeNode("switch", WorkflowTaskKind.switch_case, config1)],
      [makeEdge(START_NODE_ID, "switch")],
    );
    const after = makeModel(
      [makeNode("switch", WorkflowTaskKind.switch_case, config2)],
      [makeEdge(START_NODE_ID, "switch")],
    );

    const diff = computeGraphDiff(before, after);
    expect(diff.nodes.get("switch")?.status).toBe("unchanged");
  });

  test("changedFields lists top-level config keys that differ", () => {
    const before = makeModel(
      [makeNode("task_a", WorkflowTaskKind.http_call, { url: "a", method: "GET", headers: {} } as JsonObject)],
      [],
    );
    const after = makeModel(
      [makeNode("task_a", WorkflowTaskKind.http_call, { url: "b", method: "GET", timeout: 30 } as JsonObject)],
      [],
    );

    const diff = computeGraphDiff(before, after);
    const entry = diff.nodes.get("task_a");
    expect(entry?.status).toBe("modified");
    expect(entry?.changedFields).toContain("url");
    expect(entry?.changedFields).toContain("headers");
    expect(entry?.changedFields).toContain("timeout");
    expect(entry?.changedFields).not.toContain("method");
  });
});
