import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WorkflowSummaryPanel } from "../inspector/WorkflowSummaryPanel";
import type { WorkflowGraphModel } from "../workflow-graph-model";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";

afterEach(cleanup);

function makeGraph(overrides?: Partial<WorkflowGraphModel>): WorkflowGraphModel {
  return {
    document: {
      dsl: "1.0.0",
      namespace: "test-ns",
      name: "my-workflow",
      version: "0.1.0",
      description: "A test workflow",
    },
    nodes: [
      { id: "__start__", taskName: "__start__", kind: WorkflowTaskKind.workflow_task_kind_unspecified, category: "start", config: {}, position: { x: 0, y: 0 } },
      { id: "__end__", taskName: "__end__", kind: WorkflowTaskKind.workflow_task_kind_unspecified, category: "end", config: {}, position: { x: 0, y: 200 } },
      { id: "fetch_data", taskName: "fetch_data", kind: WorkflowTaskKind.http_call, category: "invocation", config: {}, position: { x: 0, y: 100 } },
      { id: "analyze", taskName: "analyze", kind: WorkflowTaskKind.agent_call, category: "ai", config: {}, position: { x: 0, y: 150 } },
    ],
    edges: [],
    ...overrides,
  };
}

describe("WorkflowSummaryPanel", () => {
  it("renders workflow name, namespace, and version", () => {
    render(<WorkflowSummaryPanel graph={makeGraph()} />);
    expect(screen.getByText("my-workflow")).toBeTruthy();
    expect(screen.getByText(/test-ns/)).toBeTruthy();
    expect(screen.getByText(/v0\.1\.0/)).toBeTruthy();
  });

  it("renders workflow description", () => {
    render(<WorkflowSummaryPanel graph={makeGraph()} />);
    expect(screen.getByText("A test workflow")).toBeTruthy();
  });

  it("shows task count excluding sentinels", () => {
    render(<WorkflowSummaryPanel graph={makeGraph()} />);
    expect(screen.getByText("2 tasks")).toBeTruthy();
  });

  it("shows category distribution badges", () => {
    render(<WorkflowSummaryPanel graph={makeGraph()} />);
    expect(screen.getByText(/Invocation \(1\)/)).toBeTruthy();
    expect(screen.getByText(/AI \(1\)/)).toBeTruthy();
  });

  it("shows environment variables when present", () => {
    const graph = makeGraph({
      env: {
        API_KEY: { isSecret: true, description: "External API key" },
        DEBUG: { optional: true },
      },
    });
    render(<WorkflowSummaryPanel graph={graph} />);
    expect(screen.getByText("API_KEY")).toBeTruthy();
    expect(screen.getByText("secret")).toBeTruthy();
    expect(screen.getByText("DEBUG")).toBeTruthy();
    expect(screen.getByText("optional")).toBeTruthy();
  });

  it("does not show env section when no env vars", () => {
    render(<WorkflowSummaryPanel graph={makeGraph()} />);
    expect(screen.queryByText("Environment variables")).toBeNull();
  });

  it("shows budget when present", () => {
    const graph = makeGraph({
      budget: { maxCostMicros: 5_000_000, maxTotalTokens: 500_000, maxDurationSeconds: 3600 },
    });
    render(<WorkflowSummaryPanel graph={graph} />);
    expect(screen.getByText("$5.00")).toBeTruthy();
    expect(screen.getByText("500,000")).toBeTruthy();
    expect(screen.getByText("60m 0s")).toBeTruthy();
  });

  it("shows validation error count when present", () => {
    const errors = new Map<string, readonly string[]>([
      ["fetch_data", ["Missing required field: endpoint"]],
      ["analyze", ["Agent not found", "Message is empty"]],
    ]);
    render(<WorkflowSummaryPanel graph={makeGraph()} validationErrors={errors} />);
    expect(screen.getByText("3 issues")).toBeTruthy();
  });

  it("does not show validation section when no errors", () => {
    render(<WorkflowSummaryPanel graph={makeGraph()} />);
    expect(screen.queryByText(/issue/)).toBeNull();
  });
});
