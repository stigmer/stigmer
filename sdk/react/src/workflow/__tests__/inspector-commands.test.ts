import { describe, it, expect } from "vitest";
import type { JsonObject } from "@bufbuild/protobuf";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowGraphModel, WorkflowGraphNode } from "../workflow-graph-model";
import { ToggleNodeDisabledCommand, WrapInTryCatchCommand } from "../graph-commands";
import { taskToYaml } from "../inspector/task-to-yaml";

function makeModel(nodes: WorkflowGraphNode[]): WorkflowGraphModel {
  return {
    document: { dsl: "1.0.0", namespace: "ns", name: "wf", version: "0.1.0" },
    nodes: [
      { id: "__start__", taskName: "__start__", kind: WorkflowTaskKind.workflow_task_kind_unspecified, category: "start", config: {}, position: { x: 0, y: 0 } },
      ...nodes,
      { id: "__end__", taskName: "__end__", kind: WorkflowTaskKind.workflow_task_kind_unspecified, category: "end", config: {}, position: { x: 0, y: 200 } },
    ],
    edges: [
      { id: "e1", source: "__start__", target: nodes[0]?.id ?? "__end__" },
      ...(nodes[0] ? [{ id: "e2", source: nodes[0].id, target: "__end__" }] : []),
    ],
  };
}

function makeNode(overrides?: Partial<WorkflowGraphNode>): WorkflowGraphNode {
  return {
    id: "my_task",
    taskName: "my_task",
    kind: WorkflowTaskKind.agent_call,
    category: "ai",
    config: { agent: "test-agent", message: "Hello" } as unknown as JsonObject,
    position: { x: 100, y: 100 },
    ...overrides,
  };
}

describe("ToggleNodeDisabledCommand", () => {
  it("enables disabled flag on a node without it", () => {
    const node = makeNode();
    const model = makeModel([node]);
    const cmd = new ToggleNodeDisabledCommand("my_task", "my_task");

    const result = cmd.apply(model);
    const updatedNode = result.nodes.find((n) => n.id === "my_task")!;
    expect((updatedNode.config as Record<string, unknown>)["x-stigmer-disabled"]).toBe(true);
  });

  it("disables the flag on a node that has it", () => {
    const node = makeNode({
      config: { agent: "test-agent", "x-stigmer-disabled": true } as unknown as JsonObject,
    });
    const model = makeModel([node]);
    const cmd = new ToggleNodeDisabledCommand("my_task", "my_task");

    const result = cmd.apply(model);
    const updatedNode = result.nodes.find((n) => n.id === "my_task")!;
    expect((updatedNode.config as Record<string, unknown>)["x-stigmer-disabled"]).toBeUndefined();
  });

  it("undo restores the previous state", () => {
    const node = makeNode();
    const model = makeModel([node]);
    const cmd = new ToggleNodeDisabledCommand("my_task", "my_task");

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    const restoredNode = undone.nodes.find((n) => n.id === "my_task")!;
    expect((restoredNode.config as Record<string, unknown>)["x-stigmer-disabled"]).toBeUndefined();
  });
});

describe("WrapInTryCatchCommand", () => {
  it("replaces the target node with a try_catch container", () => {
    const node = makeNode();
    const model = makeModel([node]);
    const cmd = new WrapInTryCatchCommand("my_task", "my_task", "try_catch_1");

    const result = cmd.apply(model);
    expect(result.nodes.find((n) => n.id === "my_task")).toBeUndefined();
    expect(result.nodes.find((n) => n.id === "try_catch_1")).toBeTruthy();
  });

  it("preserves edge connectivity through the container", () => {
    const node = makeNode();
    const model = makeModel([node]);
    const cmd = new WrapInTryCatchCommand("my_task", "my_task", "try_catch_1");

    const result = cmd.apply(model);
    const inbound = result.edges.find((e) => e.target === "try_catch_1");
    const outbound = result.edges.find((e) => e.source === "try_catch_1");
    expect(inbound).toBeTruthy();
    expect(outbound).toBeTruthy();
  });

  it("undo restores the original node and edges", () => {
    const node = makeNode();
    const model = makeModel([node]);
    const cmd = new WrapInTryCatchCommand("my_task", "my_task", "try_catch_1");

    const applied = cmd.apply(model);
    const undone = cmd.undo(applied);
    expect(undone.nodes.find((n) => n.id === "my_task")).toBeTruthy();
    expect(undone.nodes.find((n) => n.id === "try_catch_1")).toBeUndefined();
  });
});

describe("taskToYaml", () => {
  it("serializes a basic agent_call node", () => {
    const node = makeNode();
    const yaml = taskToYaml(node);
    expect(yaml).toContain("name: my_task");
    expect(yaml).toContain("kind: agent_call");
    expect(yaml).toContain("agent: test-agent");
    expect(yaml).toContain("message: Hello");
  });

  it("includes export when present", () => {
    const node = makeNode({ export: { as: "${ . }" } });
    const yaml = taskToYaml(node);
    expect(yaml).toContain("export:");
    expect(yaml).toContain('as: "${ . }"');
  });

  it("includes flow.then when present", () => {
    const node = makeNode({ flow: { then: "next_task" } });
    const yaml = taskToYaml(node);
    expect(yaml).toContain("flow:");
    expect(yaml).toContain("then: next_task");
  });
});
