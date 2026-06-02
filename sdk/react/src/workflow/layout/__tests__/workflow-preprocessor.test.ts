import { describe, it, expect } from "vitest";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphModel, WorkflowGraphNode, WorkflowGraphEdge } from "../../workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "../../workflow-graph-model";
import { preprocessForElk } from "../workflow-preprocessor";

function makeNode(
  id: string,
  kind: WorkflowTaskKind,
  config: Record<string, unknown> = {},
): WorkflowGraphNode {
  return {
    id,
    taskName: id,
    kind,
    category: "unspecified",
    config: config as JsonObject,
    position: { x: 0, y: 0 },
  };
}

function makeGraph(
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[],
): WorkflowGraphModel {
  return {
    document: { dsl: "1.0.0", namespace: "", name: "test", version: "0.0.1" },
    nodes,
    edges,
  };
}

describe("workflow-preprocessor", () => {
  describe("linear chain", () => {
    it("produces correct ELK children and edges for a 5-node linear workflow", () => {
      const nodes = [
        makeNode(START_NODE_ID, WorkflowTaskKind.workflow_task_kind_unspecified),
        makeNode("a", WorkflowTaskKind.http_call),
        makeNode("b", WorkflowTaskKind.set_vars),
        makeNode("c", WorkflowTaskKind.agent_call),
        makeNode("d", WorkflowTaskKind.transform),
        makeNode("e", WorkflowTaskKind.llm_call),
        makeNode(END_NODE_ID, WorkflowTaskKind.workflow_task_kind_unspecified),
      ];
      const edges: WorkflowGraphEdge[] = [
        { id: "e1", source: START_NODE_ID, target: "a" },
        { id: "e2", source: "a", target: "b" },
        { id: "e3", source: "b", target: "c" },
        { id: "e4", source: "c", target: "d" },
        { id: "e5", source: "d", target: "e" },
        { id: "e6", source: "e", target: END_NODE_ID },
      ];
      const graph = makeGraph(nodes, edges);
      const input = { graph, scope: { type: "whole-graph" as const } };

      const elkGraph = preprocessForElk(input);

      expect(elkGraph.id).toBe("root");
      expect(elkGraph.children).toHaveLength(7);
      expect(elkGraph.edges).toHaveLength(6);
      expect(elkGraph.layoutOptions).toBeDefined();
      expect(elkGraph.layoutOptions!["elk.algorithm"]).toBe("layered");
    });
  });

  describe("switch_case with branches", () => {
    it("produces multi-port node with edges targeting ports", () => {
      const nodes = [
        makeNode(START_NODE_ID, WorkflowTaskKind.workflow_task_kind_unspecified),
        makeNode("router", WorkflowTaskKind.switch_case, {
          cases: [
            { name: "yes", when: "${ok}", then: "handle_yes" },
            { name: "no", when: "${!ok}", then: "handle_no" },
          ],
        }),
        makeNode("handle_yes", WorkflowTaskKind.http_call),
        makeNode("handle_no", WorkflowTaskKind.http_call),
        makeNode(END_NODE_ID, WorkflowTaskKind.workflow_task_kind_unspecified),
      ];
      const edges: WorkflowGraphEdge[] = [
        { id: "e1", source: START_NODE_ID, target: "router" },
        { id: "e2", source: "router", target: "handle_yes", sourceHandle: "case_yes" },
        { id: "e3", source: "router", target: "handle_no", sourceHandle: "case_no" },
        { id: "e4", source: "handle_yes", target: END_NODE_ID },
        { id: "e5", source: "handle_no", target: END_NODE_ID },
      ];
      const graph = makeGraph(nodes, edges);
      const input = { graph, scope: { type: "whole-graph" as const } };

      const elkGraph = preprocessForElk(input);

      const routerNode = elkGraph.children.find((c) => c.id === "router");
      expect(routerNode).toBeDefined();
      expect(routerNode!.ports).toBeDefined();
      expect(routerNode!.ports!.length).toBeGreaterThanOrEqual(3);

      const branchEdge = elkGraph.edges.find((e) => e.id === "e2");
      expect(branchEdge).toBeDefined();
      expect(branchEdge!.sources[0]).toContain("router__case_yes");
    });
  });

  describe("empty graph", () => {
    it("produces valid ELK output with no children", () => {
      const graph = makeGraph([], []);
      const input = { graph, scope: { type: "whole-graph" as const } };

      const elkGraph = preprocessForElk(input);

      expect(elkGraph.id).toBe("root");
      expect(elkGraph.children).toHaveLength(0);
      expect(elkGraph.edges).toHaveLength(0);
    });
  });

  describe("single node (start + task + end)", () => {
    it("produces valid ELK input", () => {
      const nodes = [
        makeNode(START_NODE_ID, WorkflowTaskKind.workflow_task_kind_unspecified),
        makeNode("only_task", WorkflowTaskKind.set_vars),
        makeNode(END_NODE_ID, WorkflowTaskKind.workflow_task_kind_unspecified),
      ];
      const edges: WorkflowGraphEdge[] = [
        { id: "e1", source: START_NODE_ID, target: "only_task" },
        { id: "e2", source: "only_task", target: END_NODE_ID },
      ];
      const graph = makeGraph(nodes, edges);
      const input = { graph, scope: { type: "whole-graph" as const } };

      const elkGraph = preprocessForElk(input);

      expect(elkGraph.children).toHaveLength(3);
      expect(elkGraph.edges).toHaveLength(2);
    });
  });

  describe("node sizing", () => {
    it("uses custom getNodeDimensions when provided", () => {
      const nodes = [makeNode("task", WorkflowTaskKind.http_call)];
      const graph = makeGraph(nodes, []);
      const input = {
        graph,
        scope: { type: "whole-graph" as const },
        getNodeDimensions: () => ({ width: 300, height: 80 }),
      };

      const elkGraph = preprocessForElk(input);

      const child = elkGraph.children[0];
      expect(child.width).toBe(300);
      expect(child.height).toBe(80);
    });
  });

  describe("layout options", () => {
    it("merges custom options with defaults", () => {
      const graph = makeGraph([makeNode("a", WorkflowTaskKind.set_vars)], []);
      const input = { graph, scope: { type: "whole-graph" as const } };

      const elkGraph = preprocessForElk(input, { "elk.direction": "RIGHT" });

      expect(elkGraph.layoutOptions!["elk.direction"]).toBe("RIGHT");
      expect(elkGraph.layoutOptions!["elk.algorithm"]).toBe("layered");
    });
  });
});
