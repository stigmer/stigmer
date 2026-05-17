import { describe, it, expect } from "vitest";
import { STARTER_WORKFLOW_YAML } from "../starter-workflow-yaml";
import { yamlToGraph, graphToYaml } from "../workflow-graph-conversions";
import { parseWorkflowYaml } from "../serialize-workflow-yaml";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model";

describe("STARTER_WORKFLOW_YAML", () => {
  it("parses via yamlToGraph without throwing", () => {
    const graph = yamlToGraph(STARTER_WORKFLOW_YAML);

    expect(graph.document.namespace).toBe("default");
    expect(graph.document.name).toBe("my-workflow");
    expect(graph.document.version).toBe("0.1.0");
    expect(graph.document.dsl).toBe("1.0.0");
    expect(graph.description).toBe("A new workflow");

    const taskNodes = graph.nodes.filter(
      (n) => n.id !== START_NODE_ID && n.id !== END_NODE_ID,
    );
    expect(taskNodes).toHaveLength(1);
    expect(taskNodes[0].taskName).toBe("step_1");
  });

  it("parses via parseWorkflowYaml without throwing", () => {
    const input = parseWorkflowYaml(STARTER_WORKFLOW_YAML, "test-org");

    expect(input.name).toBe("my-workflow");
    expect(input.org).toBe("test-org");
    expect(input.document?.namespace).toBe("default");
    expect(input.document?.name).toBe("my-workflow");
    expect(input.document?.version).toBe("0.1.0");
    expect(input.tasks).toBeDefined();
    expect(input.tasks).toHaveLength(1);
    expect(input.tasks![0].name).toBe("step_1");
  });

  it("round-trips through graphToYaml -> yamlToGraph", () => {
    const original = yamlToGraph(STARTER_WORKFLOW_YAML);
    const serialized = graphToYaml(original);
    const roundTripped = yamlToGraph(serialized);

    expect(roundTripped.document.namespace).toBe(original.document.namespace);
    expect(roundTripped.document.name).toBe(original.document.name);
    expect(roundTripped.document.version).toBe(original.document.version);
    expect(roundTripped.document.dsl).toBe(original.document.dsl);

    const originalTasks = original.nodes.filter(
      (n) => n.id !== START_NODE_ID && n.id !== END_NODE_ID,
    );
    const roundTrippedTasks = roundTripped.nodes.filter(
      (n) => n.id !== START_NODE_ID && n.id !== END_NODE_ID,
    );
    expect(roundTrippedTasks).toHaveLength(originalTasks.length);
    expect(roundTrippedTasks[0].taskName).toBe(originalTasks[0].taskName);
    expect(roundTrippedTasks[0].kind).toBe(originalTasks[0].kind);
  });
});
