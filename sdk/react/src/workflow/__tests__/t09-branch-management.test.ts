import { describe, it, expect } from "vitest";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphModel, WorkflowGraphNode } from "../workflow-graph-model";
import {
  RemoveSwitchCaseCommand,
  ReorderSwitchCasesCommand,
  RemoveForkBranchCommand,
  ReorderForkBranchesCommand,
  RenameForkBranchCommand,
  SetForkCompeteCommand,
  UpdateCatchConfigCommand,
  RemoveCatchBlockCommand,
  UpdateForEachConfigCommand,
  AddNestedTaskCommand,
  RemoveNestedTaskCommand,
  ReorderNestedTasksCommand,
} from "../graph-commands";

function makeModel(overrides?: Partial<WorkflowGraphModel>): WorkflowGraphModel {
  return {
    document: { dsl: "1.0", namespace: "test", name: "test-wf", version: "1" },
    nodes: [],
    edges: [],
    ...overrides,
  };
}

function makeNode(id: string, kind: number, config: Record<string, unknown>): WorkflowGraphNode {
  return {
    id,
    taskName: id,
    kind: kind as any,
    category: "control_flow" as const,
    config: config as unknown as JsonObject,
    position: { x: 0, y: 0 },
  };
}

// ===========================================================================
// RemoveSwitchCaseCommand
// ===========================================================================

describe("RemoveSwitchCaseCommand", () => {
  const switchNode = makeNode("route", 5, {
    cases: [
      { name: "critical", when: '$.severity == "critical"' },
      { name: "high", when: '$.severity == "high"' },
      { name: "default" },
    ],
  });

  it("removes the specified case from config", () => {
    const model = makeModel({
      nodes: [switchNode],
      edges: [{ id: "e1", source: "route", target: "handle_critical", sourceHandle: "case_critical" }],
    });
    const cmd = new RemoveSwitchCaseCommand("route", "critical");

    const result = cmd.apply(model);
    const cases = (result.nodes[0].config as any).cases;

    expect(cases).toHaveLength(2);
    expect(cases[0].name).toBe("high");
    expect(cases[1].name).toBe("default");
  });

  it("removes associated edges by sourceHandle", () => {
    const model = makeModel({
      nodes: [switchNode],
      edges: [
        { id: "e1", source: "route", target: "handle_critical", sourceHandle: "case_critical" },
        { id: "e2", source: "route", target: "handle_high", sourceHandle: "case_high" },
      ],
    });
    const cmd = new RemoveSwitchCaseCommand("route", "critical");

    const result = cmd.apply(model);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].id).toBe("e2");
  });

  it("undo restores the case at original position", () => {
    const model = makeModel({
      nodes: [switchNode],
      edges: [{ id: "e1", source: "route", target: "handle_critical", sourceHandle: "case_critical" }],
    });
    const cmd = new RemoveSwitchCaseCommand("route", "critical");

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    const cases = (undone.nodes[0].config as any).cases;

    expect(cases).toHaveLength(3);
    expect(cases[0].name).toBe("critical");
    expect(undone.edges).toHaveLength(1);
  });

  it("handles non-existent case gracefully", () => {
    const model = makeModel({ nodes: [switchNode] });
    const cmd = new RemoveSwitchCaseCommand("route", "nonexistent");

    const result = cmd.apply(model);
    const cases = (result.nodes[0].config as any).cases;
    expect(cases).toHaveLength(3);
  });
});

// ===========================================================================
// ReorderSwitchCasesCommand
// ===========================================================================

describe("ReorderSwitchCasesCommand", () => {
  const switchNode = makeNode("route", 5, {
    cases: [
      { name: "a", when: "$.x" },
      { name: "b", when: "$.y" },
      { name: "c" },
    ],
  });

  it("reorders cases to the specified order", () => {
    const model = makeModel({ nodes: [switchNode] });
    const cmd = new ReorderSwitchCasesCommand("route", ["c", "a", "b"]);

    const result = cmd.apply(model);
    const cases = (result.nodes[0].config as any).cases;

    expect(cases[0].name).toBe("c");
    expect(cases[1].name).toBe("a");
    expect(cases[2].name).toBe("b");
  });

  it("undo restores original order", () => {
    const model = makeModel({ nodes: [switchNode] });
    const cmd = new ReorderSwitchCasesCommand("route", ["c", "a", "b"]);

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    const cases = (undone.nodes[0].config as any).cases;

    expect(cases[0].name).toBe("a");
    expect(cases[1].name).toBe("b");
    expect(cases[2].name).toBe("c");
  });
});

// ===========================================================================
// RemoveForkBranchCommand
// ===========================================================================

describe("RemoveForkBranchCommand", () => {
  const forkNode = makeNode("parallel", 7, {
    branches: [
      { name: "branch_a", do: [{ name: "t1", kind: "http_call" }] },
      { name: "branch_b", do: [{ name: "t2", kind: "llm_call" }] },
      { name: "branch_c", do: [] },
    ],
  });

  it("removes the specified branch", () => {
    const model = makeModel({ nodes: [forkNode] });
    const cmd = new RemoveForkBranchCommand("parallel", "branch_c");

    const result = cmd.apply(model);
    const branches = (result.nodes[0].config as any).branches;

    expect(branches).toHaveLength(2);
    expect(branches[0].name).toBe("branch_a");
    expect(branches[1].name).toBe("branch_b");
  });

  it("refuses to remove when only 2 branches remain", () => {
    const twoNode = makeNode("parallel", 7, {
      branches: [
        { name: "branch_a", do: [] },
        { name: "branch_b", do: [] },
      ],
    });
    const model = makeModel({ nodes: [twoNode] });
    const cmd = new RemoveForkBranchCommand("parallel", "branch_a");

    const result = cmd.apply(model);
    const branches = (result.nodes[0].config as any).branches;
    expect(branches).toHaveLength(2);
  });

  it("undo restores the branch at original index", () => {
    const model = makeModel({ nodes: [forkNode] });
    const cmd = new RemoveForkBranchCommand("parallel", "branch_b");

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    const branches = (undone.nodes[0].config as any).branches;

    expect(branches).toHaveLength(3);
    expect(branches[1].name).toBe("branch_b");
    expect(branches[1].do).toHaveLength(1);
  });
});

// ===========================================================================
// ReorderForkBranchesCommand
// ===========================================================================

describe("ReorderForkBranchesCommand", () => {
  const forkNode = makeNode("parallel", 7, {
    branches: [
      { name: "a", do: [] },
      { name: "b", do: [] },
      { name: "c", do: [] },
    ],
  });

  it("reorders branches", () => {
    const model = makeModel({ nodes: [forkNode] });
    const cmd = new ReorderForkBranchesCommand("parallel", ["c", "a", "b"]);

    const result = cmd.apply(model);
    const branches = (result.nodes[0].config as any).branches;
    expect(branches.map((b: any) => b.name)).toEqual(["c", "a", "b"]);
  });

  it("undo restores original order", () => {
    const model = makeModel({ nodes: [forkNode] });
    const cmd = new ReorderForkBranchesCommand("parallel", ["c", "a", "b"]);

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    const branches = (undone.nodes[0].config as any).branches;
    expect(branches.map((b: any) => b.name)).toEqual(["a", "b", "c"]);
  });
});

// ===========================================================================
// RenameForkBranchCommand
// ===========================================================================

describe("RenameForkBranchCommand", () => {
  const forkNode = makeNode("parallel", 7, {
    branches: [
      { name: "old_name", do: [] },
      { name: "other", do: [] },
    ],
  });

  it("renames the branch", () => {
    const model = makeModel({ nodes: [forkNode] });
    const cmd = new RenameForkBranchCommand("parallel", "old_name", "new_name");

    const result = cmd.apply(model);
    const branches = (result.nodes[0].config as any).branches;
    expect(branches[0].name).toBe("new_name");
    expect(branches[1].name).toBe("other");
  });

  it("undo restores old name", () => {
    const model = makeModel({ nodes: [forkNode] });
    const cmd = new RenameForkBranchCommand("parallel", "old_name", "new_name");

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    const branches = (undone.nodes[0].config as any).branches;
    expect(branches[0].name).toBe("old_name");
  });
});

// ===========================================================================
// SetForkCompeteCommand
// ===========================================================================

describe("SetForkCompeteCommand", () => {
  const forkNode = makeNode("parallel", 7, { branches: [] });

  it("enables compete mode", () => {
    const model = makeModel({ nodes: [forkNode] });
    const cmd = new SetForkCompeteCommand("parallel", true);

    const result = cmd.apply(model);
    expect((result.nodes[0].config as any).compete).toBe(true);
  });

  it("disables compete mode", () => {
    const competeNode = makeNode("parallel", 7, { branches: [], compete: true });
    const model = makeModel({ nodes: [competeNode] });
    const cmd = new SetForkCompeteCommand("parallel", false);

    const result = cmd.apply(model);
    expect((result.nodes[0].config as any).compete).toBeUndefined();
  });

  it("undo restores previous state", () => {
    const model = makeModel({ nodes: [forkNode] });
    const cmd = new SetForkCompeteCommand("parallel", true);

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    expect((undone.nodes[0].config as any).compete).toBeUndefined();
  });
});

// ===========================================================================
// UpdateCatchConfigCommand
// ===========================================================================

describe("UpdateCatchConfigCommand", () => {
  const tryCatchNode = makeNode("safe_call", 8, {
    try: [{ name: "risky", kind: "http_call" }],
    catch: { as: "error", do: [{ name: "log", kind: "set_vars" }] },
  });

  it("updates the error variable name", () => {
    const model = makeModel({ nodes: [tryCatchNode] });
    const cmd = new UpdateCatchConfigCommand("safe_call", { as: "callError" });

    const result = cmd.apply(model);
    const catchBlock = (result.nodes[0].config as any).catch;
    expect(catchBlock.as).toBe("callError");
    expect(catchBlock.do).toHaveLength(1);
  });

  it("sets compensate flag", () => {
    const model = makeModel({ nodes: [tryCatchNode] });
    const cmd = new UpdateCatchConfigCommand("safe_call", { compensate: true });

    const result = cmd.apply(model);
    const catchBlock = (result.nodes[0].config as any).catch;
    expect(catchBlock.compensate).toBe(true);
  });

  it("undo restores previous values", () => {
    const model = makeModel({ nodes: [tryCatchNode] });
    const cmd = new UpdateCatchConfigCommand("safe_call", { as: "callError", compensate: true });

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    const catchBlock = (undone.nodes[0].config as any).catch;
    expect(catchBlock.as).toBe("error");
    expect(catchBlock.compensate).toBeUndefined();
  });
});

// ===========================================================================
// RemoveCatchBlockCommand
// ===========================================================================

describe("RemoveCatchBlockCommand", () => {
  const tryCatchNode = makeNode("safe_call", 8, {
    try: [{ name: "risky", kind: "http_call" }],
    catch: { as: "error", do: [] },
  });

  it("removes the catch block from config", () => {
    const model = makeModel({ nodes: [tryCatchNode] });
    const cmd = new RemoveCatchBlockCommand("safe_call");

    const result = cmd.apply(model);
    expect((result.nodes[0].config as any).catch).toBeUndefined();
    expect((result.nodes[0].config as any).try).toBeDefined();
  });

  it("undo restores the catch block", () => {
    const model = makeModel({ nodes: [tryCatchNode] });
    const cmd = new RemoveCatchBlockCommand("safe_call");

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    const catchBlock = (undone.nodes[0].config as any).catch;
    expect(catchBlock).toBeDefined();
    expect(catchBlock.as).toBe("error");
  });
});

// ===========================================================================
// UpdateForEachConfigCommand
// ===========================================================================

describe("UpdateForEachConfigCommand", () => {
  const forEachNode = makeNode("batch", 6, {
    each: "item",
    in: "${ $data.items }",
    do: [{ name: "process", kind: "http_call" }],
    max_parallelism: 0,
  });

  it("updates max_parallelism", () => {
    const model = makeModel({ nodes: [forEachNode] });
    const cmd = new UpdateForEachConfigCommand("batch", { max_parallelism: 5 });

    const result = cmd.apply(model);
    expect((result.nodes[0].config as any).max_parallelism).toBe(5);
  });

  it("updates multiple fields at once", () => {
    const model = makeModel({ nodes: [forEachNode] });
    const cmd = new UpdateForEachConfigCommand("batch", {
      max_parallelism: 10,
      batch_size: 3,
      on_error: "FOR_EACH_CONTINUE",
    });

    const result = cmd.apply(model);
    const config = result.nodes[0].config as any;
    expect(config.max_parallelism).toBe(10);
    expect(config.batch_size).toBe(3);
    expect(config.on_error).toBe("FOR_EACH_CONTINUE");
  });

  it("preserves unrelated config fields", () => {
    const model = makeModel({ nodes: [forEachNode] });
    const cmd = new UpdateForEachConfigCommand("batch", { max_parallelism: 3 });

    const result = cmd.apply(model);
    const config = result.nodes[0].config as any;
    expect(config.each).toBe("item");
    expect(config.in).toBe("${ $data.items }");
    expect(config.do).toHaveLength(1);
  });

  it("undo restores previous values", () => {
    const model = makeModel({ nodes: [forEachNode] });
    const cmd = new UpdateForEachConfigCommand("batch", { max_parallelism: 5 });

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    expect((undone.nodes[0].config as any).max_parallelism).toBe(0);
  });
});

// ===========================================================================
// AddNestedTaskCommand
// ===========================================================================

describe("AddNestedTaskCommand", () => {
  const forkNode = makeNode("parallel", 7, {
    branches: [
      { name: "a", do: [{ name: "existing", kind: "http_call" }] },
      { name: "b", do: [] },
    ],
  });

  it("adds a task to a nested do array", () => {
    const model = makeModel({ nodes: [forkNode] });
    const cmd = new AddNestedTaskCommand("parallel", "branches.0.do", {
      name: "new_task",
      kind: "llm_call",
    });

    const result = cmd.apply(model);
    const branch = (result.nodes[0].config as any).branches[0];
    expect(branch.do).toHaveLength(2);
    expect(branch.do[1].name).toBe("new_task");
  });

  it("undo removes the last added task", () => {
    const model = makeModel({ nodes: [forkNode] });
    const cmd = new AddNestedTaskCommand("parallel", "branches.0.do", {
      name: "new_task",
      kind: "llm_call",
    });

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    const branch = (undone.nodes[0].config as any).branches[0];
    expect(branch.do).toHaveLength(1);
  });
});

// ===========================================================================
// RemoveNestedTaskCommand
// ===========================================================================

describe("RemoveNestedTaskCommand", () => {
  const tryCatchNode = makeNode("safe", 8, {
    try: [
      { name: "first", kind: "http_call" },
      { name: "second", kind: "llm_call" },
      { name: "third", kind: "transform" },
    ],
  });

  it("removes a task at the specified index", () => {
    const model = makeModel({ nodes: [tryCatchNode] });
    const cmd = new RemoveNestedTaskCommand("safe", "try", 1);

    const result = cmd.apply(model);
    const tasks = (result.nodes[0].config as any).try;
    expect(tasks).toHaveLength(2);
    expect(tasks[0].name).toBe("first");
    expect(tasks[1].name).toBe("third");
  });

  it("undo restores the task at original index", () => {
    const model = makeModel({ nodes: [tryCatchNode] });
    const cmd = new RemoveNestedTaskCommand("safe", "try", 1);

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    const tasks = (undone.nodes[0].config as any).try;
    expect(tasks).toHaveLength(3);
    expect(tasks[1].name).toBe("second");
  });
});

// ===========================================================================
// ReorderNestedTasksCommand
// ===========================================================================

describe("ReorderNestedTasksCommand", () => {
  const forEachNode = makeNode("batch", 6, {
    each: "item",
    in: "${ $data.items }",
    do: [
      { name: "a", kind: "http_call" },
      { name: "b", kind: "transform" },
      { name: "c", kind: "set_vars" },
    ],
  });

  it("moves a task from one position to another", () => {
    const model = makeModel({ nodes: [forEachNode] });
    const cmd = new ReorderNestedTasksCommand("batch", "do", 0, 2);

    const result = cmd.apply(model);
    const tasks = (result.nodes[0].config as any).do;
    expect(tasks[0].name).toBe("b");
    expect(tasks[1].name).toBe("c");
    expect(tasks[2].name).toBe("a");
  });

  it("undo restores original order", () => {
    const model = makeModel({ nodes: [forEachNode] });
    const cmd = new ReorderNestedTasksCommand("batch", "do", 0, 2);

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    const tasks = (undone.nodes[0].config as any).do;
    expect(tasks[0].name).toBe("a");
    expect(tasks[1].name).toBe("b");
    expect(tasks[2].name).toBe("c");
  });
});
