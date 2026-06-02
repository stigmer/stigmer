import { describe, expect, it } from "vitest";
import { getVisualSpec, type TaskTypeVisualSpec } from "../task-type-visual-registry";
import { registryNodeDimensions } from "../layout/registry-dimensions";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowGraphNode } from "../workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model";

function makeNode(id: string, kind: WorkflowTaskKind): WorkflowGraphNode {
  return {
    id,
    kind,
    name: id,
    config: {},
    outputs: [],
  } as unknown as WorkflowGraphNode;
}

describe("captionHeight in TaskTypeVisualSpec", () => {
  it("rectangular shapes have captionHeight 0", () => {
    const taskCard = getVisualSpec("agent_call");
    expect(taskCard.captionHeight).toBe(0);

    const subworkflow = getVisualSpec("run_workflow");
    expect(subworkflow.captionHeight).toBe(0);
  });

  it("gate-octagon has captionHeight 24", () => {
    const spec = getVisualSpec("human_input");
    expect(spec.visualClass).toBe("gate-octagon");
    expect(spec.captionHeight).toBe(24);
    expect(spec.defaultHeight).toBe(140);
  });

  it("decision-diamond has captionHeight 24", () => {
    const spec = getVisualSpec("switch_case");
    expect(spec.visualClass).toBe("decision-diamond");
    expect(spec.captionHeight).toBe(24);
    expect(spec.defaultHeight).toBe(120);
  });

  it("event-circle has captionHeight 20", () => {
    const spec = getVisualSpec("wait");
    expect(spec.visualClass).toBe("event-circle");
    expect(spec.captionHeight).toBe(20);
    expect(spec.defaultHeight).toBe(70);
  });

  it("parallel-bar has captionHeight 0 (wide enough for internal text)", () => {
    const spec = getVisualSpec("fork");
    expect(spec.visualClass).toBe("parallel-bar");
    expect(spec.captionHeight).toBe(0);
  });

  it("terminal pill has captionHeight 0", () => {
    const spec = getVisualSpec(START_NODE_ID);
    expect(spec.captionHeight).toBe(0);
  });
});

describe("registryNodeDimensions includes captionHeight", () => {
  it("returns height + captionHeight for human_input (octagon)", () => {
    const node = makeNode("approve_user", WorkflowTaskKind.human_input);
    const dims = registryNodeDimensions(node);
    expect(dims.width).toBe(160);
    expect(dims.height).toBe(140 + 24); // defaultHeight + captionHeight
  });

  it("returns height + captionHeight for switch_case (diamond)", () => {
    const node = makeNode("route_request", WorkflowTaskKind.switch_case);
    const dims = registryNodeDimensions(node);
    expect(dims.width).toBe(140);
    expect(dims.height).toBe(120 + 24);
  });

  it("returns height + captionHeight for wait (circle)", () => {
    const node = makeNode("delay_5s", WorkflowTaskKind.wait);
    const dims = registryNodeDimensions(node);
    expect(dims.width).toBe(80);
    expect(dims.height).toBe(70 + 20);
  });

  it("returns exact defaultHeight for task-card (captionHeight=0)", () => {
    const node = makeNode("call_agent", WorkflowTaskKind.agent_call);
    const dims = registryNodeDimensions(node);
    expect(dims.height).toBe(56); // CANVAS_NODE_HEIGHT, no caption
  });

  it("returns exact defaultHeight for parallel-bar (captionHeight=0)", () => {
    const node = makeNode("parallel_fork", WorkflowTaskKind.fork);
    const dims = registryNodeDimensions(node);
    expect(dims.height).toBe(32);
  });

  it("returns sentinel dimensions for start/end nodes", () => {
    const startNode = makeNode(START_NODE_ID, WorkflowTaskKind.workflow_task_kind_unspecified);
    const endNode = makeNode(END_NODE_ID, WorkflowTaskKind.workflow_task_kind_unspecified);

    const startDims = registryNodeDimensions(startNode);
    const endDims = registryNodeDimensions(endNode);

    expect(startDims.width).toBe(100);
    expect(startDims.height).toBe(36); // SENTINEL_NODE_HEIGHT + 0 captionHeight
    expect(endDims.width).toBe(100);
  });
});
