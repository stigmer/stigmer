import { describe, it, expect } from "vitest";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphModel, WorkflowGraphNode, WorkflowGraphEdge } from "../../workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "../../workflow-graph-model";
import { createDagreLayoutEngine } from "../dagre-layout-engine";

function makeLinearGraph(count: number): WorkflowGraphModel {
  const nodes: WorkflowGraphNode[] = [
    {
      id: START_NODE_ID,
      taskName: "Start",
      kind: WorkflowTaskKind.workflow_task_kind_unspecified,
      category: "start",
      config: {} as JsonObject,
      position: { x: 0, y: 0 },
    },
  ];

  const edges: WorkflowGraphEdge[] = [];

  let prev: string = START_NODE_ID;
  for (let i = 0; i < count; i++) {
    const id = `task_${i}`;
    nodes.push({
      id,
      taskName: id,
      kind: WorkflowTaskKind.http_call,
      category: "invocation",
      config: {} as JsonObject,
      position: { x: 0, y: 0 },
    });
    edges.push({ id: `e_${prev}_${id}`, source: prev, target: id });
    prev = id;
  }

  nodes.push({
    id: END_NODE_ID,
    taskName: "End",
    kind: WorkflowTaskKind.workflow_task_kind_unspecified,
    category: "end",
    config: {} as JsonObject,
    position: { x: 0, y: 0 },
  });
  edges.push({ id: `e_${prev}_end`, source: prev, target: END_NODE_ID });

  return {
    document: { dsl: "1.0.0", namespace: "", name: "test", version: "0.0.1" },
    nodes,
    edges,
  };
}

describe("dagre-layout-engine", () => {
  it("produces positions for all nodes in a linear graph", async () => {
    const engine = createDagreLayoutEngine();
    const graph = makeLinearGraph(5);

    const result = await engine.layout({ graph, scope: { type: "whole-graph" } });

    expect(result.positions.size).toBe(7); // start + 5 tasks + end
    expect(result.engine).toBe("dagre");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("produces no overlapping nodes", async () => {
    const engine = createDagreLayoutEngine();
    const graph = makeLinearGraph(10);

    const result = await engine.layout({ graph, scope: { type: "whole-graph" } });

    const positions = Array.from(result.positions.entries()).map(([id, pos]) => ({
      id,
      ...pos,
      width: 220,
      height: 56,
    }));

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i];
        const b = positions[j];
        const overlapX = a.x < b.x + b.width && a.x + a.width > b.x;
        const overlapY = a.y < b.y + b.height && a.y + a.height > b.y;
        expect(
          overlapX && overlapY,
          `Nodes "${a.id}" and "${b.id}" overlap`,
        ).toBe(false);
      }
    }
  });

  it("is deterministic (two runs produce identical results)", async () => {
    const engine = createDagreLayoutEngine();
    const graph = makeLinearGraph(5);

    const result1 = await engine.layout({ graph, scope: { type: "whole-graph" } });
    const result2 = await engine.layout({ graph, scope: { type: "whole-graph" } });

    for (const [id, pos1] of result1.positions) {
      const pos2 = result2.positions.get(id);
      expect(pos2).toBeDefined();
      expect(pos1.x).toBeCloseTo(pos2!.x, 5);
      expect(pos1.y).toBeCloseTo(pos2!.y, 5);
    }
  });

  it("respects custom node dimensions via vertical spacing", async () => {
    const engine = createDagreLayoutEngine();
    const graph = makeLinearGraph(3);

    const small = await engine.layout({
      graph,
      scope: { type: "whole-graph" },
      getNodeDimensions: () => ({ width: 100, height: 30 }),
    });
    const large = await engine.layout({
      graph,
      scope: { type: "whole-graph" },
      getNodeDimensions: () => ({ width: 400, height: 100 }),
    });

    const smallGap = small.positions.get("task_1")!.y - small.positions.get("task_0")!.y;
    const largeGap = large.positions.get("task_1")!.y - large.positions.get("task_0")!.y;
    expect(largeGap).toBeGreaterThan(smallGap);
  });
});
