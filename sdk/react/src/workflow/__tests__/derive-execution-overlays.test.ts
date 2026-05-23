import { describe, test, expect } from "vitest";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowGraphNode, WorkflowGraphEdge } from "../workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";
import {
  deriveEdgeExecutionStates,
  deriveForkProgress,
} from "../execution/derive-execution-overlays";
import type { JsonObject } from "@bufbuild/protobuf";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDerivedState(
  taskName: string,
  status: DerivedTaskState["status"],
  overrides?: Partial<DerivedTaskState>,
): DerivedTaskState {
  return {
    taskName,
    taskKind: WorkflowTaskKind.http_call,
    status,
    durationMs: 0,
    costMicros: BigInt(0),
    tokensUsed: BigInt(0),
    attemptNumber: 1,
    error: "",
    childExecutionId: "",
    ...overrides,
  };
}

function makeNode(
  id: string,
  kind: WorkflowTaskKind = WorkflowTaskKind.http_call,
): WorkflowGraphNode {
  return {
    id,
    taskName: id,
    kind,
    category: "invocation",
    config: {} as JsonObject,
    position: { x: 0, y: 0 },
  };
}

function makeSentinelNode(id: typeof START_NODE_ID | typeof END_NODE_ID): WorkflowGraphNode {
  return {
    id,
    taskName: id === START_NODE_ID ? "Start" : "End",
    kind: WorkflowTaskKind.workflow_task_kind_unspecified,
    category: id === START_NODE_ID ? "start" : "end",
    config: {} as JsonObject,
    position: { x: 0, y: 0 },
  };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  opts?: { label?: string; sourceHandle?: string },
): WorkflowGraphEdge {
  return { id, source, target, label: opts?.label, sourceHandle: opts?.sourceHandle };
}

// ---------------------------------------------------------------------------
// deriveEdgeExecutionStates
// ---------------------------------------------------------------------------

describe("deriveEdgeExecutionStates", () => {
  describe("linear chain", () => {
    const nodes = [
      makeSentinelNode(START_NODE_ID),
      makeNode("A"),
      makeNode("B"),
      makeNode("C"),
      makeSentinelNode(END_NODE_ID),
    ];
    const edges = [
      makeEdge("e0", START_NODE_ID, "A"),
      makeEdge("e1", "A", "B"),
      makeEdge("e2", "B", "C"),
      makeEdge("e3", "C", END_NODE_ID),
    ];

    test("all not_reached when no tasks have run", () => {
      const states = new Map<string, DerivedTaskState>();
      const result = deriveEdgeExecutionStates(edges, nodes, states);

      expect(result.get("e0")).toBe("not_reached");
      expect(result.get("e1")).toBe("not_reached");
      expect(result.get("e2")).toBe("not_reached");
      expect(result.get("e3")).toBe("not_reached");
    });

    test("A completed, B running → e0 taken, e1 active, e2 not_reached", () => {
      const states = new Map([
        ["A", makeDerivedState("A", "completed")],
        ["B", makeDerivedState("B", "running")],
      ]);
      const result = deriveEdgeExecutionStates(edges, nodes, states);

      expect(result.get("e0")).toBe("taken");
      expect(result.get("e1")).toBe("active");
      expect(result.get("e2")).toBe("not_reached");
      expect(result.get("e3")).toBe("not_reached");
    });

    test("all completed → all edges taken including to End", () => {
      const states = new Map([
        ["A", makeDerivedState("A", "completed")],
        ["B", makeDerivedState("B", "completed")],
        ["C", makeDerivedState("C", "completed")],
      ]);
      const result = deriveEdgeExecutionStates(edges, nodes, states);

      expect(result.get("e0")).toBe("taken");
      expect(result.get("e1")).toBe("taken");
      expect(result.get("e2")).toBe("taken");
      expect(result.get("e3")).toBe("taken");
    });

    test("A completed, B failed → e1 taken (failed is terminal)", () => {
      const states = new Map([
        ["A", makeDerivedState("A", "completed")],
        ["B", makeDerivedState("B", "failed")],
      ]);
      const result = deriveEdgeExecutionStates(edges, nodes, states);

      expect(result.get("e0")).toBe("taken");
      expect(result.get("e1")).toBe("taken");
      expect(result.get("e2")).toBe("not_reached");
    });
  });

  describe("switch_case branching", () => {
    const nodes = [
      makeSentinelNode(START_NODE_ID),
      makeNode("classify"),
      makeNode("sw", WorkflowTaskKind.switch_case),
      makeNode("branch_a"),
      makeNode("branch_b"),
      makeNode("branch_c"),
      makeSentinelNode(END_NODE_ID),
    ];
    const edges = [
      makeEdge("e0", START_NODE_ID, "classify"),
      makeEdge("e1", "classify", "sw"),
      makeEdge("sw_a", "sw", "branch_a", { label: "caseA", sourceHandle: "case_caseA" }),
      makeEdge("sw_b", "sw", "branch_b", { label: "caseB", sourceHandle: "case_caseB" }),
      makeEdge("sw_c", "sw", "branch_c", { label: "default", sourceHandle: "case_default" }),
      makeEdge("ea", "branch_a", END_NODE_ID),
      makeEdge("eb", "branch_b", END_NODE_ID),
      makeEdge("ec", "branch_c", END_NODE_ID),
    ];

    test("one branch taken → taken + not_taken + not_taken", () => {
      const states = new Map([
        ["classify", makeDerivedState("classify", "completed")],
        ["sw", makeDerivedState("sw", "completed")],
        ["branch_a", makeDerivedState("branch_a", "completed")],
      ]);
      const result = deriveEdgeExecutionStates(edges, nodes, states);

      expect(result.get("sw_a")).toBe("taken");
      expect(result.get("sw_b")).toBe("not_taken");
      expect(result.get("sw_c")).toBe("not_taken");
      expect(result.get("ea")).toBe("taken");
    });

    test("switch not yet executed → all branch edges not_reached", () => {
      const states = new Map([
        ["classify", makeDerivedState("classify", "running")],
      ]);
      const result = deriveEdgeExecutionStates(edges, nodes, states);

      expect(result.get("sw_a")).toBe("not_reached");
      expect(result.get("sw_b")).toBe("not_reached");
      expect(result.get("sw_c")).toBe("not_reached");
    });

    test("fallthrough: multiple completed targets → all marked taken (DD-T06-003)", () => {
      const states = new Map([
        ["classify", makeDerivedState("classify", "completed")],
        ["sw", makeDerivedState("sw", "completed")],
        ["branch_a", makeDerivedState("branch_a", "completed")],
        ["branch_b", makeDerivedState("branch_b", "completed")],
      ]);
      const result = deriveEdgeExecutionStates(edges, nodes, states);

      expect(result.get("sw_a")).toBe("taken");
      expect(result.get("sw_b")).toBe("taken");
      expect(result.get("sw_c")).toBe("not_taken");
    });

    test("switch completed but all targets not_reached → edges remain not_reached", () => {
      const states = new Map([
        ["classify", makeDerivedState("classify", "completed")],
        ["sw", makeDerivedState("sw", "completed")],
      ]);
      const result = deriveEdgeExecutionStates(edges, nodes, states);

      expect(result.get("sw_a")).toBe("not_reached");
      expect(result.get("sw_b")).toBe("not_reached");
      expect(result.get("sw_c")).toBe("not_reached");
    });

    test("active branch target → edge is active", () => {
      const states = new Map([
        ["classify", makeDerivedState("classify", "completed")],
        ["sw", makeDerivedState("sw", "completed")],
        ["branch_b", makeDerivedState("branch_b", "running")],
      ]);
      const result = deriveEdgeExecutionStates(edges, nodes, states);

      expect(result.get("sw_b")).toBe("active");
      expect(result.get("sw_a")).toBe("not_taken");
      expect(result.get("sw_c")).toBe("not_taken");
    });
  });

  describe("human_input outcomes (same pattern as switch_case)", () => {
    const nodes = [
      makeNode("review", WorkflowTaskKind.human_input),
      makeNode("approve_path"),
      makeNode("reject_path"),
    ];
    const edges = [
      makeEdge("o_approve", "review", "approve_path", {
        label: "approve",
        sourceHandle: "outcome_approve",
      }),
      makeEdge("o_reject", "review", "reject_path", {
        label: "reject",
        sourceHandle: "outcome_reject",
      }),
    ];

    test("approve selected → approve taken, reject not_taken", () => {
      const states = new Map([
        ["review", makeDerivedState("review", "completed")],
        ["approve_path", makeDerivedState("approve_path", "running")],
      ]);
      const result = deriveEdgeExecutionStates(edges, nodes, states);

      expect(result.get("o_approve")).toBe("active");
      expect(result.get("o_reject")).toBe("not_taken");
    });
  });

  describe("sentinel edges", () => {
    const nodes = [
      makeSentinelNode(START_NODE_ID),
      makeNode("first"),
      makeSentinelNode(END_NODE_ID),
    ];
    const edges = [
      makeEdge("start_edge", START_NODE_ID, "first"),
      makeEdge("end_edge", "first", END_NODE_ID),
    ];

    test("Start sentinel always treated as completed → edge taken when first task runs", () => {
      const states = new Map([
        ["first", makeDerivedState("first", "running")],
      ]);
      const result = deriveEdgeExecutionStates(edges, nodes, states);

      expect(result.get("start_edge")).toBe("active");
    });

    test("edge to End is taken when last task completes", () => {
      const states = new Map([
        ["first", makeDerivedState("first", "completed")],
      ]);
      const result = deriveEdgeExecutionStates(edges, nodes, states);

      expect(result.get("start_edge")).toBe("taken");
      expect(result.get("end_edge")).toBe("taken");
    });
  });

  describe("waiting_approval counts as active", () => {
    const nodes = [makeNode("A"), makeNode("B", WorkflowTaskKind.human_input)];
    const edges = [makeEdge("e1", "A", "B")];

    test("target waiting_approval → edge is active", () => {
      const states = new Map([
        ["A", makeDerivedState("A", "completed")],
        ["B", makeDerivedState("B", "waiting_approval")],
      ]);
      const result = deriveEdgeExecutionStates(edges, nodes, states);

      expect(result.get("e1")).toBe("active");
    });
  });

  describe("non-branching sequential edge to not_reached target", () => {
    const nodes = [makeNode("A"), makeNode("B")];
    const edges = [makeEdge("e1", "A", "B")];

    test("source completed, target not_reached, no sourceHandle → not_reached (not not_taken)", () => {
      const states = new Map([
        ["A", makeDerivedState("A", "completed")],
      ]);
      const result = deriveEdgeExecutionStates(edges, nodes, states);

      expect(result.get("e1")).toBe("not_reached");
    });
  });
});

// ---------------------------------------------------------------------------
// deriveForkProgress
// ---------------------------------------------------------------------------

describe("deriveForkProgress", () => {
  test("2 branches, 0 complete", () => {
    const config = {
      branches: [
        { name: "b1", do: [{ name: "task1" }] },
        { name: "b2", do: [{ name: "task2" }] },
      ],
    } as unknown as JsonObject;

    const result = deriveForkProgress(config, new Map());

    expect(result).toEqual({ completed: 0, total: 2, compete: false });
  });

  test("2 branches, 1 complete", () => {
    const config = {
      branches: [
        { name: "b1", do: [{ name: "task1" }] },
        { name: "b2", do: [{ name: "task2" }] },
      ],
    } as unknown as JsonObject;
    const states = new Map([
      ["task1", makeDerivedState("task1", "completed")],
      ["task2", makeDerivedState("task2", "running")],
    ]);

    const result = deriveForkProgress(config, states);

    expect(result).toEqual({ completed: 1, total: 2, compete: false });
  });

  test("2 branches, all complete", () => {
    const config = {
      branches: [
        { name: "b1", do: [{ name: "task1" }] },
        { name: "b2", do: [{ name: "task2" }] },
      ],
    } as unknown as JsonObject;
    const states = new Map([
      ["task1", makeDerivedState("task1", "completed")],
      ["task2", makeDerivedState("task2", "completed")],
    ]);

    const result = deriveForkProgress(config, states);

    expect(result).toEqual({ completed: 2, total: 2, compete: false });
  });

  test("compete mode passes through", () => {
    const config = {
      branches: [
        { name: "b1", do: [{ name: "t1" }] },
        { name: "b2", do: [{ name: "t2" }] },
      ],
      compete: true,
    } as unknown as JsonObject;

    const result = deriveForkProgress(config, new Map());

    expect(result).toEqual({ completed: 0, total: 2, compete: true });
  });

  test("branch with multiple inner tasks — complete only when ALL done", () => {
    const config = {
      branches: [
        { name: "b1", do: [{ name: "step1" }, { name: "step2" }] },
        { name: "b2", do: [{ name: "step3" }] },
      ],
    } as unknown as JsonObject;
    const states = new Map([
      ["step1", makeDerivedState("step1", "completed")],
      ["step2", makeDerivedState("step2", "running")],
      ["step3", makeDerivedState("step3", "completed")],
    ]);

    const result = deriveForkProgress(config, states);

    expect(result).toEqual({ completed: 1, total: 2, compete: false });
  });

  test("missing branches → null", () => {
    const result = deriveForkProgress({} as JsonObject, new Map());
    expect(result).toBeNull();
  });

  test("empty branches array → null", () => {
    const config = { branches: [] } as unknown as JsonObject;
    const result = deriveForkProgress(config, new Map());
    expect(result).toBeNull();
  });
});
