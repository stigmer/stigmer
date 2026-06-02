import { describe, it, expect } from "vitest";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphModel } from "../workflow-graph-model";
import {
  AddSwitchCaseCommand,
  AddParallelBranchCommand,
  AddCatchHandlerCommand,
} from "../graph-commands";

function makeModel(overrides?: Partial<WorkflowGraphModel>): WorkflowGraphModel {
  return {
    document: { dsl: "1.0", namespace: "test", name: "test-wf", version: "1" },
    nodes: [],
    edges: [],
    ...overrides,
  };
}

describe("AddSwitchCaseCommand", () => {
  const switchNode = {
    id: "classify",
    taskName: "classify",
    kind: 5 as any,
    category: "control_flow" as const,
    config: { cases: [{ name: "enterprise", when: '$.plan == "enterprise"' }] } as unknown as JsonObject,
    position: { x: 0, y: 0 },
  };

  it("adds a case to the switch node config", () => {
    const model = makeModel({ nodes: [switchNode] });
    const cmd = new AddSwitchCaseCommand("classify", "free", '$.plan == "free"');

    const result = cmd.apply(model);
    const updatedNode = result.nodes.find((n) => n.id === "classify")!;
    const cases = (updatedNode.config as any).cases;

    expect(cases).toHaveLength(2);
    expect(cases[1].name).toBe("free");
    expect(cases[1].when).toBe('$.plan == "free"');
  });

  it("undo removes the added case", () => {
    const model = makeModel({ nodes: [switchNode] });
    const cmd = new AddSwitchCaseCommand("classify", "free", '$.plan == "free"');

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    const node = undone.nodes.find((n) => n.id === "classify")!;
    const cases = (node.config as any).cases;

    expect(cases).toHaveLength(1);
    expect(cases[0].name).toBe("enterprise");
  });

  it("handles switch node with no existing cases", () => {
    const emptySwitch = { ...switchNode, config: {} as JsonObject };
    const model = makeModel({ nodes: [emptySwitch] });
    const cmd = new AddSwitchCaseCommand("classify", "first_case", "$.x > 0");

    const result = cmd.apply(model);
    const node = result.nodes.find((n) => n.id === "classify")!;
    const cases = (node.config as any).cases;

    expect(cases).toHaveLength(1);
    expect(cases[0].name).toBe("first_case");
  });

  it("creates a child node and edge when provided", () => {
    const model = makeModel({ nodes: [switchNode] });
    const childNode = {
      id: "handle_free",
      taskName: "handle_free",
      kind: 1 as any,
      category: "ai" as const,
      config: {} as JsonObject,
      position: { x: 100, y: 200 },
    };
    const childEdge = {
      id: "e_free",
      source: "classify",
      target: "handle_free",
      sourceHandle: "case_free",
    };
    const cmd = new AddSwitchCaseCommand("classify", "free", "", childNode, childEdge);

    const result = cmd.apply(model);
    expect(result.nodes.find((n) => n.id === "handle_free")).toBeTruthy();
    expect(result.edges.find((e) => e.id === "e_free")).toBeTruthy();
  });
});

describe("AddParallelBranchCommand", () => {
  const forkNode = {
    id: "parallel_enrich",
    taskName: "parallel_enrich",
    kind: 6 as any,
    category: "control_flow" as const,
    config: { branches: [{ name: "crm", do: [] }] } as unknown as JsonObject,
    position: { x: 0, y: 0 },
  };

  it("adds a branch to the fork node config", () => {
    const model = makeModel({ nodes: [forkNode] });
    const cmd = new AddParallelBranchCommand("parallel_enrich", "linkedin");

    const result = cmd.apply(model);
    const node = result.nodes.find((n) => n.id === "parallel_enrich")!;
    const branches = (node.config as any).branches;

    expect(branches).toHaveLength(2);
    expect(branches[1].name).toBe("linkedin");
    expect(branches[1].do).toEqual([]);
  });

  it("undo removes the added branch", () => {
    const model = makeModel({ nodes: [forkNode] });
    const cmd = new AddParallelBranchCommand("parallel_enrich", "linkedin");

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    const node = undone.nodes.find((n) => n.id === "parallel_enrich")!;
    const branches = (node.config as any).branches;

    expect(branches).toHaveLength(1);
    expect(branches[0].name).toBe("crm");
  });

  it("handles fork node with no existing branches", () => {
    const emptyFork = { ...forkNode, config: {} as JsonObject };
    const model = makeModel({ nodes: [emptyFork] });
    const cmd = new AddParallelBranchCommand("parallel_enrich", "first_branch");

    const result = cmd.apply(model);
    const node = result.nodes.find((n) => n.id === "parallel_enrich")!;
    const branches = (node.config as any).branches;

    expect(branches).toHaveLength(1);
    expect(branches[0].name).toBe("first_branch");
  });
});

describe("AddCatchHandlerCommand", () => {
  const tryCatchNode = {
    id: "risky_op",
    taskName: "risky_op",
    kind: 7 as any,
    category: "control_flow" as const,
    config: { try: [{ name: "do_something" }] } as unknown as JsonObject,
    position: { x: 0, y: 0 },
  };

  it("adds a catch handler to the try_catch node config", () => {
    const model = makeModel({ nodes: [tryCatchNode] });
    const cmd = new AddCatchHandlerCommand("risky_op", "timeout");

    const result = cmd.apply(model);
    const node = result.nodes.find((n) => n.id === "risky_op")!;
    const catchConfig = (node.config as any).catch;

    expect(catchConfig).toBeDefined();
    expect(catchConfig.as).toBe("timeout");
    expect(catchConfig.do).toEqual([]);
  });

  it("undo removes the catch handler", () => {
    const model = makeModel({ nodes: [tryCatchNode] });
    const cmd = new AddCatchHandlerCommand("risky_op", "timeout");

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    const node = undone.nodes.find((n) => n.id === "risky_op")!;

    expect((node.config as any).catch).toBeUndefined();
  });

  it("uses 'error' as default error type when empty string provided", () => {
    const model = makeModel({ nodes: [tryCatchNode] });
    const cmd = new AddCatchHandlerCommand("risky_op", "");

    const result = cmd.apply(model);
    const node = result.nodes.find((n) => n.id === "risky_op")!;
    const catchConfig = (node.config as any).catch;

    expect(catchConfig.as).toBe("error");
  });

  it("preserves previous catch config on undo", () => {
    const nodeWithCatch = {
      ...tryCatchNode,
      config: {
        try: [{ name: "do_something" }],
        catch: { as: "original_error", do: [{ name: "handle" }] },
      } as unknown as JsonObject,
    };
    const model = makeModel({ nodes: [nodeWithCatch] });
    const cmd = new AddCatchHandlerCommand("risky_op", "new_error");

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    const node = undone.nodes.find((n) => n.id === "risky_op")!;
    const catchConfig = (node.config as any).catch;

    expect(catchConfig.as).toBe("original_error");
    expect(catchConfig.do).toEqual([{ name: "handle" }]);
  });
});
