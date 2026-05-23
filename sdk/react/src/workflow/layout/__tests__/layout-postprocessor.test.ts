import { describe, it, expect } from "vitest";
import type { WorkflowGraphModel, WorkflowGraphEdge } from "../../workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "../../workflow-graph-model";
import type { ElkLayoutResult, LayoutScope } from "../types";
import { postprocessElkResult } from "../layout-postprocessor";

function makeGraph(nodeIds: string[], edges: WorkflowGraphEdge[] = []): WorkflowGraphModel {
  return {
    document: { dsl: "1.0.0", namespace: "", name: "test", version: "0.0.1" },
    nodes: nodeIds.map((id) => ({
      id,
      taskName: id,
      kind: 0 as any,
      category: "unspecified" as const,
      config: {} as any,
      position: { x: 0, y: 0 },
    })),
    edges,
  };
}

function makeElkResult(positions: Record<string, { x: number; y: number }>): ElkLayoutResult {
  return {
    id: "root",
    children: Object.entries(positions).map(([id, pos]) => ({
      id,
      x: pos.x,
      y: pos.y,
      width: 220,
      height: 56,
    })),
  };
}

describe("layout-postprocessor", () => {
  describe("position extraction", () => {
    it("maps ELK child positions to result positions", () => {
      const elkResult = makeElkResult({
        a: { x: 10, y: 20 },
        b: { x: 100, y: 200 },
      });
      const graph = makeGraph(["a", "b"]);

      const result = postprocessElkResult(elkResult, { type: "whole-graph" }, graph, 5, "elk");

      expect(result.positions.get("a")).toEqual({ x: 10, y: 20 });
      expect(result.positions.get("b")).toEqual({ x: 100, y: 200 });
    });

    it("includes duration and engine name", () => {
      const elkResult = makeElkResult({ a: { x: 0, y: 0 } });
      const graph = makeGraph(["a"]);

      const result = postprocessElkResult(elkResult, { type: "whole-graph" }, graph, 42, "elk-layered");

      expect(result.durationMs).toBe(42);
      expect(result.engine).toBe("elk-layered");
    });

    it("handles empty ELK result gracefully", () => {
      const elkResult: ElkLayoutResult = { id: "root" };
      const graph = makeGraph(["a"]);

      const result = postprocessElkResult(elkResult, { type: "whole-graph" }, graph, 1, "elk");

      expect(result.positions.size).toBe(0);
    });
  });

  describe("scope: whole-graph", () => {
    it("includes all node positions", () => {
      const elkResult = makeElkResult({
        a: { x: 10, y: 20 },
        b: { x: 30, y: 40 },
        c: { x: 50, y: 60 },
      });
      const graph = makeGraph(["a", "b", "c"]);

      const result = postprocessElkResult(elkResult, { type: "whole-graph" }, graph, 1, "elk");

      expect(result.positions.size).toBe(3);
    });
  });

  describe("scope: selected", () => {
    it("only includes positions for nodes in the selection set", () => {
      const elkResult = makeElkResult({
        a: { x: 10, y: 20 },
        b: { x: 30, y: 40 },
        c: { x: 50, y: 60 },
      });
      const graph = makeGraph(["a", "b", "c"]);
      const scope: LayoutScope = { type: "selected", nodeIds: new Set(["a", "c"]) };

      const result = postprocessElkResult(elkResult, scope, graph, 1, "elk");

      expect(result.positions.size).toBe(2);
      expect(result.positions.has("a")).toBe(true);
      expect(result.positions.has("b")).toBe(false);
      expect(result.positions.has("c")).toBe(true);
    });
  });

  describe("scope: downstream", () => {
    it("includes the starting node and all reachable downstream nodes", () => {
      const edges: WorkflowGraphEdge[] = [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "c" },
        { id: "e3", source: "b", target: "d" },
        { id: "e4", source: "x", target: "y" },
      ];
      const elkResult = makeElkResult({
        a: { x: 0, y: 0 },
        b: { x: 0, y: 60 },
        c: { x: -50, y: 120 },
        d: { x: 50, y: 120 },
        x: { x: 200, y: 0 },
        y: { x: 200, y: 60 },
      });
      const graph = makeGraph(["a", "b", "c", "d", "x", "y"], edges);
      const scope: LayoutScope = { type: "downstream", fromNodeId: "b" };

      const result = postprocessElkResult(elkResult, scope, graph, 1, "elk");

      expect(result.positions.has("b")).toBe(true);
      expect(result.positions.has("c")).toBe(true);
      expect(result.positions.has("d")).toBe(true);
      expect(result.positions.has("a")).toBe(false);
      expect(result.positions.has("x")).toBe(false);
      expect(result.positions.has("y")).toBe(false);
    });

    it("handles a node with no downstream neighbors", () => {
      const edges: WorkflowGraphEdge[] = [{ id: "e1", source: "a", target: "b" }];
      const elkResult = makeElkResult({
        a: { x: 0, y: 0 },
        b: { x: 0, y: 60 },
      });
      const graph = makeGraph(["a", "b"], edges);
      const scope: LayoutScope = { type: "downstream", fromNodeId: "b" };

      const result = postprocessElkResult(elkResult, scope, graph, 1, "elk");

      expect(result.positions.size).toBe(1);
      expect(result.positions.has("b")).toBe(true);
    });
  });
});
