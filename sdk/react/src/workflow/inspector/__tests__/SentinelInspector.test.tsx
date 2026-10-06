/**
 * Pins SentinelInspector's copy for the two sentinel nodes: the Start node
 * says it is the workflow's entry point, any other sentinel is the End
 * node, which ends the workflow run.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { START_NODE_ID, END_NODE_ID } from "../../workflow-graph-model";
import type { WorkflowGraphNode } from "../../workflow-graph-model";
import { SentinelInspector } from "../SentinelInspector";

afterEach(cleanup);

function sentinel(id: string, category: "start" | "end"): WorkflowGraphNode {
  return {
    id,
    taskName: id,
    kind: WorkflowTaskKind.workflow_task_kind_unspecified,
    category,
    config: {},
    position: { x: 0, y: 0 },
  };
}

describe("SentinelInspector", () => {
  it("describes the Start node as the workflow's entry point", () => {
    render(<SentinelInspector node={sentinel(START_NODE_ID, "start")} />);
    expect(screen.getByRole("heading", { name: "Start" })).toBeTruthy();
    expect(screen.getByText(/Entry point of the workflow/)).toBeTruthy();
  });

  it("describes the End node as the point that ends the workflow run", () => {
    render(<SentinelInspector node={sentinel(END_NODE_ID, "end")} />);
    expect(screen.getByRole("heading", { name: "End" })).toBeTruthy();
    expect(
      screen.getByText("Terminal point. Tasks routing here end the workflow run."),
    ).toBeTruthy();
  });
});
