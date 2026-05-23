import { describe, it, expect } from "vitest";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphNode, WorkflowGraphEdge } from "../../workflow-graph-model";
import { computePortAssignments, computeNodePorts } from "../port-assignment";
import { START_NODE_ID, END_NODE_ID } from "../../workflow-graph-model";

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

function makeEdge(source: string, target: string, sourceHandle?: string): WorkflowGraphEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    ...(sourceHandle && { sourceHandle }),
  };
}

describe("port-assignment", () => {
  describe("sentinel nodes", () => {
    it("__start__ has no input ports and one output port on SOUTH", () => {
      const node = makeNode(START_NODE_ID, WorkflowTaskKind.workflow_task_kind_unspecified);
      const result = computeNodePorts(node, []);

      expect(result.inputPorts).toHaveLength(0);
      expect(result.outputPorts).toHaveLength(1);
      expect(result.outputPorts[0].id).toBe(`${START_NODE_ID}__out`);
      expect(result.outputPorts[0].side).toBe("SOUTH");
    });

    it("__end__ has one input port on NORTH and no output ports", () => {
      const node = makeNode(END_NODE_ID, WorkflowTaskKind.workflow_task_kind_unspecified);
      const result = computeNodePorts(node, []);

      expect(result.inputPorts).toHaveLength(1);
      expect(result.inputPorts[0].id).toBe(`${END_NODE_ID}__in`);
      expect(result.inputPorts[0].side).toBe("NORTH");
      expect(result.outputPorts).toHaveLength(0);
    });
  });

  describe("default task kinds", () => {
    it("produces 1 input NORTH and 1 output SOUTH for a regular task", () => {
      const node = makeNode("my_task", WorkflowTaskKind.http_call);
      const result = computeNodePorts(node, []);

      expect(result.inputPorts).toHaveLength(1);
      expect(result.inputPorts[0]).toEqual({ id: "my_task__in", side: "NORTH", index: 0 });
      expect(result.outputPorts).toHaveLength(1);
      expect(result.outputPorts[0]).toEqual({ id: "my_task__out", side: "SOUTH", index: 0 });
    });

    it("produces same result for set_vars, agent_call, llm_call etc.", () => {
      const kinds = [
        WorkflowTaskKind.set_vars,
        WorkflowTaskKind.agent_call,
        WorkflowTaskKind.llm_call,
        WorkflowTaskKind.grpc_call,
        WorkflowTaskKind.transform,
      ];

      for (const kind of kinds) {
        const node = makeNode("task", kind);
        const result = computeNodePorts(node, []);
        expect(result.outputPorts).toHaveLength(1);
        expect(result.outputPorts[0].id).toBe("task__out");
      }
    });
  });

  describe("switch_case", () => {
    it("produces one output port per case, ordered by definition", () => {
      const node = makeNode("route", WorkflowTaskKind.switch_case, {
        cases: [
          { name: "approved", when: "${status == 'ok'}", then: "process" },
          { name: "rejected", when: "${status == 'bad'}", then: "notify" },
          { name: "default", then: "fallback" },
        ],
      });

      const result = computeNodePorts(node, []);

      expect(result.inputPorts).toHaveLength(1);
      expect(result.outputPorts).toHaveLength(3);
      expect(result.outputPorts[0]).toEqual({
        id: "route__case_approved",
        side: "SOUTH",
        index: 0,
        label: "approved",
      });
      expect(result.outputPorts[1]).toEqual({
        id: "route__case_rejected",
        side: "SOUTH",
        index: 1,
        label: "rejected",
      });
      expect(result.outputPorts[2]).toEqual({
        id: "route__case_default",
        side: "SOUTH",
        index: 2,
        label: "default",
      });
    });

    it("falls back to single output when cases array is empty", () => {
      const node = makeNode("route", WorkflowTaskKind.switch_case, { cases: [] });
      const result = computeNodePorts(node, []);

      expect(result.outputPorts).toHaveLength(1);
      expect(result.outputPorts[0].id).toBe("route__out");
    });

    it("falls back to single output when no config", () => {
      const node = makeNode("route", WorkflowTaskKind.switch_case);
      const result = computeNodePorts(node, []);

      expect(result.outputPorts).toHaveLength(1);
      expect(result.outputPorts[0].id).toBe("route__out");
    });
  });

  describe("human_input", () => {
    it("produces one output port per outcome, ordered by definition", () => {
      const node = makeNode("approval", WorkflowTaskKind.human_input, {
        outcomes: [
          { name: "approve" },
          { name: "deny" },
        ],
      });

      const result = computeNodePorts(node, []);

      expect(result.outputPorts).toHaveLength(2);
      expect(result.outputPorts[0]).toEqual({
        id: "approval__outcome_approve",
        side: "SOUTH",
        index: 0,
        label: "approve",
      });
      expect(result.outputPorts[1]).toEqual({
        id: "approval__outcome_deny",
        side: "SOUTH",
        index: 1,
        label: "deny",
      });
    });
  });

  describe("fork", () => {
    it("produces one output port per outgoing edge", () => {
      const node = makeNode("split", WorkflowTaskKind.fork);
      const edges: WorkflowGraphEdge[] = [
        makeEdge("split", "branch_a"),
        makeEdge("split", "branch_b"),
        makeEdge("split", "branch_c"),
      ];

      const result = computeNodePorts(node, edges);

      expect(result.outputPorts).toHaveLength(3);
      expect(result.outputPorts[0].id).toBe("split__branch_0");
      expect(result.outputPorts[1].id).toBe("split__branch_1");
      expect(result.outputPorts[2].id).toBe("split__branch_2");
    });

    it("uses sourceHandle from edge when available", () => {
      const node = makeNode("split", WorkflowTaskKind.fork);
      const edges: WorkflowGraphEdge[] = [
        makeEdge("split", "a", "parallel_a"),
        makeEdge("split", "b", "parallel_b"),
      ];

      const result = computeNodePorts(node, edges);

      expect(result.outputPorts[0].id).toBe("split__parallel_a");
      expect(result.outputPorts[1].id).toBe("split__parallel_b");
    });

    it("falls back to single output when only one outgoing edge", () => {
      const node = makeNode("split", WorkflowTaskKind.fork);
      const edges: WorkflowGraphEdge[] = [makeEdge("split", "target")];

      const result = computeNodePorts(node, edges);
      expect(result.outputPorts).toHaveLength(1);
      expect(result.outputPorts[0].id).toBe("split__out");
    });
  });

  describe("computePortAssignments (batch)", () => {
    it("returns assignments for all nodes in the graph", () => {
      const nodes = [
        makeNode(START_NODE_ID, WorkflowTaskKind.workflow_task_kind_unspecified),
        makeNode("task_a", WorkflowTaskKind.http_call),
        makeNode("task_b", WorkflowTaskKind.set_vars),
        makeNode(END_NODE_ID, WorkflowTaskKind.workflow_task_kind_unspecified),
      ];
      const edges: WorkflowGraphEdge[] = [
        makeEdge(START_NODE_ID, "task_a"),
        makeEdge("task_a", "task_b"),
        makeEdge("task_b", END_NODE_ID),
      ];

      const assignments = computePortAssignments(nodes, edges);

      expect(assignments.size).toBe(4);
      expect(assignments.get(START_NODE_ID)!.outputPorts).toHaveLength(1);
      expect(assignments.get(END_NODE_ID)!.inputPorts).toHaveLength(1);
      expect(assignments.get("task_a")!.inputPorts).toHaveLength(1);
      expect(assignments.get("task_a")!.outputPorts).toHaveLength(1);
    });

    it("produces deterministic results (same input = same output)", () => {
      const nodes = [
        makeNode("a", WorkflowTaskKind.switch_case, {
          cases: [{ name: "x" }, { name: "y" }],
        }),
      ];
      const edges: WorkflowGraphEdge[] = [];

      const result1 = computePortAssignments(nodes, edges);
      const result2 = computePortAssignments(nodes, edges);

      expect(result1.get("a")!.outputPorts).toEqual(result2.get("a")!.outputPorts);
    });
  });
});
