import { describe, it, expect } from "vitest";
import { getDisabledKinds, getHiddenKinds } from "../compatibility";
import type { InsertionContext } from "../insertion-context";
import type { WorkflowGraphModel } from "../../workflow-graph-model";

function makeGraph(overrides?: Partial<WorkflowGraphModel>): WorkflowGraphModel {
  return {
    document: { dsl: "1.0", namespace: "test", name: "test-wf", version: "1" },
    nodes: [],
    edges: [],
    ...overrides,
  };
}

describe("getHiddenKinds", () => {
  it("always hides __start__ and __end__", () => {
    const hidden = getHiddenKinds();
    expect(hidden.has("__start__")).toBe(true);
    expect(hidden.has("__end__")).toBe(true);
  });

  it("does not hide regular task kinds", () => {
    const hidden = getHiddenKinds();
    expect(hidden.has("agent_call")).toBe(false);
    expect(hidden.has("http_call")).toBe(false);
    expect(hidden.has("switch_case")).toBe(false);
  });
});

describe("getDisabledKinds", () => {
  it("returns empty array when no constraints are violated", () => {
    const context: InsertionContext = {
      mode: "edge-splice",
      sourceKind: "http_call",
      sourceNodeId: "http_call_1",
      targetNodeId: "transform_1",
    };

    const graph = makeGraph({
      nodes: [
        { id: "http_call_1", taskName: "http_call_1", kind: 1 as any, category: "invocation", config: {}, position: { x: 0, y: 0 } },
        { id: "transform_1", taskName: "transform_1", kind: 2 as any, category: "data", config: {}, position: { x: 0, y: 100 } },
      ],
      edges: [
        { id: "e1", source: "http_call_1", target: "transform_1" },
      ],
    });

    const disabled = getDisabledKinds(context, graph);
    expect(disabled).toEqual([]);
  });

  it("disables for_each when inside a for_each container", () => {
    const context: InsertionContext = {
      mode: "edge-splice",
      sourceKind: "transform",
      sourceNodeId: "transform_1",
      targetNodeId: "agent_call_1",
      parentContainerKind: "for_each",
    };

    const graph = makeGraph();
    const disabled = getDisabledKinds(context, graph);
    const disabledKinds = disabled.map((d) => d.kind);
    expect(disabledKinds).toContain("for_each");
  });

  it("disables fork in a terminal switch branch", () => {
    const context: InsertionContext = {
      mode: "append-after",
      sourceKind: "agent_call",
      sourceNodeId: "switch_case_1_branch_task",
    };

    const graph = makeGraph({
      nodes: [
        { id: "switch_case_1", taskName: "switch_case_1", kind: 1 as any, category: "control_flow", config: {}, position: { x: 0, y: 0 } },
        { id: "switch_case_1_branch_task", taskName: "switch_case_1_branch_task", kind: 2 as any, category: "ai", config: {}, position: { x: 0, y: 100 } },
        { id: "__end__", taskName: "__end__", kind: 0 as any, category: "end", config: {}, position: { x: 0, y: 200 } },
      ],
      edges: [
        { id: "e1", source: "switch_case_1", target: "switch_case_1_branch_task", sourceHandle: "case_enterprise" },
        { id: "e2", source: "switch_case_1_branch_task", target: "__end__" },
      ],
    });

    const disabled = getDisabledKinds(context, graph);
    const disabledKinds = disabled.map((d) => d.kind);
    expect(disabledKinds).toContain("fork");
  });

  it("each disabled entry has a non-empty reason", () => {
    const context: InsertionContext = {
      mode: "edge-splice",
      sourceKind: "transform",
      sourceNodeId: "transform_1",
      parentContainerKind: "for_each",
    };

    const graph = makeGraph();
    const disabled = getDisabledKinds(context, graph);
    for (const entry of disabled) {
      expect(entry.reason).toBeTruthy();
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });
});
