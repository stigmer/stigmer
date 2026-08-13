import { describe, test, expect } from "vitest";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { applyDagreLayout } from "../layout";
import type { WorkflowGraphModel } from "../workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model";
import { toReactFlowElements } from "../workflow-graph-conversions";
import type { CanvasTaskNodeData } from "../workflow-graph-conversions";

// ---------------------------------------------------------------------------
// Overview graph pipeline (mirrors useWorkflowOverviewGraph data flow)
// ---------------------------------------------------------------------------

const threeNodeGraph: WorkflowGraphModel = {
  document: { name: "test-wf", dsl: "1.0.0", namespace: "default", version: "0.0.1" },
  nodes: [
    { id: START_NODE_ID, taskName: "Start", kind: WorkflowTaskKind.workflow_task_kind_unspecified, category: "start", config: {}, position: { x: 0, y: 0 } },
    { id: "analyze", taskName: "analyze", kind: WorkflowTaskKind.agent_call, category: "ai", config: { agent: "my-agent" }, position: { x: 0, y: 0 } },
    { id: "notify", taskName: "notify", kind: WorkflowTaskKind.http_call, category: "invocation", config: { url: "https://hooks.example.com", method: "POST" }, position: { x: 0, y: 0 } },
    { id: END_NODE_ID, taskName: "End", kind: WorkflowTaskKind.workflow_task_kind_unspecified, category: "end", config: {}, position: { x: 0, y: 0 } },
  ],
  edges: [
    { id: "e1", source: START_NODE_ID, target: "analyze" },
    { id: "e2", source: "analyze", target: "notify" },
    { id: "e3", source: "notify", target: END_NODE_ID },
  ],
};

describe("Overview graph pipeline", () => {
  test("layout + toReactFlowElements produces correct node count", () => {
    const laid = applyDagreLayout(threeNodeGraph);
    const { nodes, edges } = toReactFlowElements(laid);
    expect(nodes).toHaveLength(4);
    expect(edges).toHaveLength(3);
  });

  test("nodes have positioned coordinates after layout", () => {
    const laid = applyDagreLayout(threeNodeGraph);
    const { nodes } = toReactFlowElements(laid);
    for (const node of nodes) {
      expect(typeof node.position.x).toBe("number");
      expect(typeof node.position.y).toBe("number");
    }
  });

  test("sentinel nodes are flagged with isSentinel", () => {
    const laid = applyDagreLayout(threeNodeGraph);
    const { nodes } = toReactFlowElements(laid);
    const startNode = nodes.find((n) => n.id === START_NODE_ID);
    const taskNode = nodes.find((n) => n.id === "analyze");
    expect((startNode!.data as CanvasTaskNodeData).isSentinel).toBe(true);
    expect((taskNode!.data as CanvasTaskNodeData).isSentinel).toBeFalsy();
  });

  test("sentinel nodes carry the pseudo-kind as kindString, never the enum fallback (oss#581)", () => {
    const laid = applyDagreLayout(threeNodeGraph);
    const { nodes } = toReactFlowElements(laid);
    const startData = nodes.find((n) => n.id === START_NODE_ID)!.data as CanvasTaskNodeData;
    const endData = nodes.find((n) => n.id === END_NODE_ID)!.data as CanvasTaskNodeData;
    expect(startData.kindString).toBe(START_NODE_ID);
    expect(endData.kindString).toBe(END_NODE_ID);
  });

  test("no node's kindString is ever the internal unknown_* fallback", () => {
    const laid = applyDagreLayout(threeNodeGraph);
    const { nodes } = toReactFlowElements(laid);
    for (const node of nodes) {
      expect((node.data as CanvasTaskNodeData).kindString).not.toMatch(/^unknown_/);
    }
  });

  test("task nodes carry correct kindString and category", () => {
    const laid = applyDagreLayout(threeNodeGraph);
    const { nodes } = toReactFlowElements(laid);
    const analyze = nodes.find((n) => n.id === "analyze");
    const analyzeData = analyze!.data as CanvasTaskNodeData;
    expect(analyzeData.kindString).toBe("agent_call");
    expect(analyzeData.category).toBe("ai");
  });

  test("task nodes carry config from graph model", () => {
    const laid = applyDagreLayout(threeNodeGraph);
    const { nodes } = toReactFlowElements(laid);
    const notify = nodes.find((n) => n.id === "notify");
    const data = notify!.data as CanvasTaskNodeData;
    expect((data.config as Record<string, unknown>).url).toBe("https://hooks.example.com");
  });

  test("layout is top-to-bottom (start above tasks above end)", () => {
    const laid = applyDagreLayout(threeNodeGraph);
    const { nodes } = toReactFlowElements(laid);
    const startY = nodes.find((n) => n.id === START_NODE_ID)!.position.y;
    const analyzeY = nodes.find((n) => n.id === "analyze")!.position.y;
    const notifyY = nodes.find((n) => n.id === "notify")!.position.y;
    const endY = nodes.find((n) => n.id === END_NODE_ID)!.position.y;
    expect(startY).toBeLessThan(analyzeY);
    expect(analyzeY).toBeLessThan(notifyY);
    expect(notifyY).toBeLessThan(endY);
  });

  test("empty graph produces no nodes or edges", () => {
    const emptyGraph: WorkflowGraphModel = {
      document: { name: "empty", dsl: "1.0.0", namespace: "default", version: "0.0.1" },
      nodes: [],
      edges: [],
    };
    const { nodes, edges } = toReactFlowElements(emptyGraph);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });
});
