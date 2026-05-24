import { describe, it, expect } from "vitest";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphNode } from "../../workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "../../workflow-graph-model";
import { registryNodeDimensions } from "../registry-dimensions";
import {
  SENTINEL_NODE_WIDTH,
  SENTINEL_NODE_HEIGHT,
  CANVAS_NODE_WIDTH,
  CANVAS_NODE_HEIGHT,
} from "../../canvas-constants";

function makeNode(
  id: string,
  kind: WorkflowTaskKind,
): WorkflowGraphNode {
  return {
    id,
    taskName: id,
    kind,
    category: "unspecified",
    config: {} as JsonObject,
    position: { x: 0, y: 0 },
  };
}

describe("registryNodeDimensions", () => {
  describe("sentinel nodes", () => {
    it("returns terminal-pill dimensions for __start__", () => {
      const node = makeNode(START_NODE_ID, WorkflowTaskKind.workflow_task_kind_unspecified);
      const dims = registryNodeDimensions(node);

      expect(dims.width).toBe(SENTINEL_NODE_WIDTH);
      expect(dims.height).toBe(SENTINEL_NODE_HEIGHT);
    });

    it("returns terminal-pill dimensions for __end__", () => {
      const node = makeNode(END_NODE_ID, WorkflowTaskKind.workflow_task_kind_unspecified);
      const dims = registryNodeDimensions(node);

      expect(dims.width).toBe(SENTINEL_NODE_WIDTH);
      expect(dims.height).toBe(SENTINEL_NODE_HEIGHT);
    });
  });

  describe("task-card shapes (default dimensions)", () => {
    const cardKinds = [
      WorkflowTaskKind.http_call,
      WorkflowTaskKind.grpc_call,
      WorkflowTaskKind.agent_call,
      WorkflowTaskKind.llm_call,
      WorkflowTaskKind.activity_call,
      WorkflowTaskKind.set_vars,
      WorkflowTaskKind.transform,
      WorkflowTaskKind.validate,
    ] as const;

    for (const kind of cardKinds) {
      it(`returns card dimensions for ${WorkflowTaskKind[kind]}`, () => {
        const node = makeNode(`test_${kind}`, kind);
        const dims = registryNodeDimensions(node);

        expect(dims.width).toBe(CANVAS_NODE_WIDTH);
        expect(dims.height).toBe(CANVAS_NODE_HEIGHT);
      });
    }
  });

  describe("non-card shapes", () => {
    it("returns diamond dimensions for switch_case (140x144 with caption)", () => {
      const node = makeNode("my_switch", WorkflowTaskKind.switch_case);
      const dims = registryNodeDimensions(node);

      expect(dims.width).toBe(140);
      expect(dims.height).toBe(120 + 24); // defaultHeight + captionHeight
    });

    it("returns parallel-bar dimensions for fork (260x32)", () => {
      const node = makeNode("my_fork", WorkflowTaskKind.fork);
      const dims = registryNodeDimensions(node);

      expect(dims.width).toBe(260);
      expect(dims.height).toBe(32);
    });

    it("returns event-circle dimensions for wait (80x90 with caption)", () => {
      const node = makeNode("my_wait", WorkflowTaskKind.wait);
      const dims = registryNodeDimensions(node);

      expect(dims.width).toBe(80);
      expect(dims.height).toBe(70 + 20); // defaultHeight + captionHeight
    });

    it("returns event-circle dimensions for listen (80x90 with caption)", () => {
      const node = makeNode("my_listen", WorkflowTaskKind.listen);
      const dims = registryNodeDimensions(node);

      expect(dims.width).toBe(80);
      expect(dims.height).toBe(70 + 20); // defaultHeight + captionHeight
    });

    it("returns gate-octagon dimensions for human_input (160x164 with caption)", () => {
      const node = makeNode("my_gate", WorkflowTaskKind.human_input);
      const dims = registryNodeDimensions(node);

      expect(dims.width).toBe(160);
      expect(dims.height).toBe(140 + 24); // defaultHeight + captionHeight
    });

    it("returns container dimensions for for_each (280x120)", () => {
      const node = makeNode("my_loop", WorkflowTaskKind.for_each);
      const dims = registryNodeDimensions(node);

      expect(dims.width).toBe(280);
      expect(dims.height).toBe(120);
    });

    it("returns container dimensions for try_catch (280x120)", () => {
      const node = makeNode("my_try", WorkflowTaskKind.try_catch);
      const dims = registryNodeDimensions(node);

      expect(dims.width).toBe(280);
      expect(dims.height).toBe(120);
    });
  });

  describe("fallback behavior", () => {
    it("returns default spec dimensions for an unknown kind", () => {
      const node = makeNode("unknown_task", 9999 as WorkflowTaskKind);
      const dims = registryNodeDimensions(node);

      expect(dims.width).toBe(CANVAS_NODE_WIDTH);
      expect(dims.height).toBe(CANVAS_NODE_HEIGHT);
    });
  });
});
