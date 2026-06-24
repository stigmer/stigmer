/**
 * Integration-style tests for the full HITL approval cycle.
 *
 * These tests exercise the interaction between multiple modules:
 * - ApprovalGateMiddleware (interrupt on tool call)
 * - StatusBuilder (WAITING_FOR_APPROVAL phase + tool call status)
 * - Streaming loop (detect WAITING_FOR_APPROVAL after stream)
 * - HITL resume (resolve decisions, build Command)
 * - Post-stream (skip when waiting)
 */

import { describe, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ToolMessage } from "@langchain/core/messages";
import {
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ToolCallSchema,
  AgentMessageSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ExecutionPhase,
  ToolCallStatus,
  MessageType,
  ApprovalAction,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StatusBuilder } from "../status-builder.js";
import type { StreamEvent } from "../status-builder.js";

describe("HITL approval integration", () => {
  describe("StatusBuilder with approval provider", () => {
    it("sets WAITING_FOR_APPROVAL on tool start when policy matches", () => {
      const status = create(AgentExecutionStatusSchema, {});
      const sb = new StatusBuilder("exec-1", status);

      sb.setApprovalProvider({
        policies: new Map([
          ["my-server/dangerous_tool", {
            toolName: "dangerous_tool",
            mcpServerSlug: "my-server",
            requiresApproval: true,
            approvalMessage: "Execute dangerous_tool",
            source: "classifier_default",
          }],
        ]),
        toolServerMap: new Map([["dangerous_tool", "my-server"]]),
        globalBypass: false,
      });

      sb.processEvent({
        event: "on_chat_model_stream",
        run_id: "llm-1",
        data: { chunk: { content: "I'll use the tool" } },
      });
      sb.processEvent({
        event: "on_chat_model_end",
        run_id: "llm-1",
        data: {},
      });

      sb.processEvent({
        event: "on_tool_start",
        name: "dangerous_tool",
        run_id: "tool-1",
        data: { input: { target: "prod" } },
      });

      expect(status.phase).toBe(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL);

      const msg = status.messages.find(m => m.toolCalls.length > 0);
      expect(msg).toBeDefined();
      const tc = msg!.toolCalls[0];
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
      expect(tc.requiresApproval).toBe(true);
      expect(tc.approvalMessage).toBe("Execute dangerous_tool");
      expect(tc.approvalRequestedAt).toBeTruthy();
    });

    it("does NOT set WAITING_FOR_APPROVAL for tools without policy", () => {
      const status = create(AgentExecutionStatusSchema, {});
      const sb = new StatusBuilder("exec-2", status);

      sb.setApprovalProvider({
        policies: new Map(),
        toolServerMap: new Map([["safe_tool", "my-server"]]),
        globalBypass: false,
      });

      sb.processEvent({
        event: "on_chat_model_stream",
        run_id: "llm-1",
        data: { chunk: { content: "Using safe tool" } },
      });
      sb.processEvent({
        event: "on_chat_model_end",
        run_id: "llm-1",
        data: {},
      });

      sb.processEvent({
        event: "on_tool_start",
        name: "safe_tool",
        run_id: "tool-1",
        data: { input: {} },
      });

      expect(status.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
      const tc = status.messages.find(m => m.toolCalls.length > 0)?.toolCalls[0];
      expect(tc?.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
      expect(tc?.requiresApproval).toBe(false);
    });

    it("does NOT set WAITING_FOR_APPROVAL under the global bypass", () => {
      const status = create(AgentExecutionStatusSchema, {});
      const sb = new StatusBuilder("exec-3", status);

      sb.setApprovalProvider({
        policies: new Map([
          ["srv/tool", {
            toolName: "tool",
            mcpServerSlug: "srv",
            requiresApproval: true,
            approvalMessage: "msg",
            source: "classifier_default",
          }],
        ]),
        toolServerMap: new Map([["tool", "srv"]]),
        globalBypass: true,
      });

      sb.processEvent({
        event: "on_chat_model_stream",
        run_id: "llm-1",
        data: { chunk: { content: "test" } },
      });
      sb.processEvent({
        event: "on_chat_model_end",
        run_id: "llm-1",
        data: {},
      });

      sb.processEvent({
        event: "on_tool_start",
        name: "tool",
        run_id: "tool-1",
        data: { input: {} },
      });

      expect(status.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    });

    it("populates argsPreview with redacted sensitive fields", () => {
      const status = create(AgentExecutionStatusSchema, {});
      const sb = new StatusBuilder("exec-4", status);

      sb.setApprovalProvider({
        policies: new Map([
          ["srv/tool_x", {
            toolName: "tool_x",
            mcpServerSlug: "srv",
            requiresApproval: true,
            approvalMessage: "Run tool_x",
            source: "classifier_default",
          }],
        ]),
        toolServerMap: new Map([["tool_x", "srv"]]),
        globalBypass: false,
      });

      sb.processEvent({
        event: "on_chat_model_stream",
        run_id: "llm-1",
        data: { chunk: { content: "test" } },
      });
      sb.processEvent({
        event: "on_chat_model_end",
        run_id: "llm-1",
        data: {},
      });

      sb.processEvent({
        event: "on_tool_start",
        name: "tool_x",
        run_id: "tool-1",
        data: {
          input: {
            url: "https://example.com",
            api_key: "sk-12345",
            query: "SELECT *",
          },
        },
      });

      const tc = status.messages.find(m => m.toolCalls.length > 0)?.toolCalls[0];
      expect(tc?.argsPreview).toContain("example.com");
      expect(tc?.argsPreview).toContain("[REDACTED]");
      expect(tc?.argsPreview).not.toContain("sk-12345");
    });
  });

  describe("Post-stream skip on WAITING_FOR_APPROVAL", () => {
    it("processPostStream returns early when phase is WAITING_FOR_APPROVAL", async () => {
      const { processPostStream } = await import("../post-stream.js");

      const status = create(AgentExecutionStatusSchema, {
        phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      });

      const mockPublisher = {
        publish: vi.fn(),
      };

      await processPostStream({
        status,
        inlinePublisher: mockPublisher as any,
        writebackCoordinator: null,
        pendingPublishPromises: [],
        pendingWritebackPromises: [],
        executionId: "exec-test",
      });

      expect(mockPublisher.publish).not.toHaveBeenCalled();
    });
  });
});
