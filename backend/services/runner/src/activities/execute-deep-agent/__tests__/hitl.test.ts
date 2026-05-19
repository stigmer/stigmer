import { describe, it, expect, vi } from "vitest";
import { Command } from "@langchain/langgraph";
import { resolveResumeInput, reconcileToolCallStatuses } from "../hitl.js";
import { ApprovalAction, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { create } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { GraphStateSnapshot } from "../hitl.js";

function makeExecution(
  toolCalls: Array<{
    id: string;
    status: ToolCallStatus;
    approvalAction: ApprovalAction;
  }>,
): AgentExecution {
  const msg = create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: "test",
    toolCalls: toolCalls.map(tc =>
      create(ToolCallSchema, {
        id: tc.id,
        name: "test_tool",
        status: tc.status,
        approvalAction: tc.approvalAction,
      }),
    ),
  });

  return {
    $typeName: "ai.stigmer.agentic.agentexecution.v1.AgentExecution",
    $unknown: undefined,
    metadata: undefined,
    spec: {
      $typeName: "ai.stigmer.agentic.agentexecution.v1.AgentExecutionSpec",
      $unknown: undefined,
      sessionId: "session-1",
      agentId: "agent-1",
      message: "test message",
      executionConfig: undefined,
      workspaceFileRefs: [],
      callbackToken: new Uint8Array(),
      autoApproveAll: false,
      parentWorkflowId: "",
    },
    status: create(AgentExecutionStatusSchema, {
      messages: [msg],
    }),
  } as unknown as AgentExecution;
}

function makeGraphState(
  interrupts: Array<{ taskId: string; toolCallId: string; hasResume?: boolean }>,
): GraphStateSnapshot {
  return {
    values: {},
    tasks: interrupts.map(i => ({
      id: i.taskId,
      interrupts: [{
        value: { tool_call_id: i.toolCallId, message: "Approval needed" },
        ...(i.hasResume ? { resumeValue: { action: "approve" } } : {}),
      }],
    })),
  };
}

function makeAgentGraph(state: GraphStateSnapshot) {
  return {
    getState: vi.fn().mockResolvedValue(state),
  };
}

describe("resolveResumeInput", () => {
  it("returns fresh input when no interrupts exist", async () => {
    const execution = makeExecution([]);
    const graph = makeAgentGraph({ values: {}, tasks: [] });
    const config = { configurable: { thread_id: "t1" } };

    const result = await resolveResumeInput(execution, graph, config, "hello");

    expect(result.isResumeFromApproval).toBe(false);
    expect(result.hasRejection).toBe(false);
    expect(result.graphInput).toEqual({
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("returns fresh input when interrupts exist but no decisions", async () => {
    const execution = makeExecution([]);
    const state = makeGraphState([{ taskId: "task-1", toolCallId: "call-1" }]);
    const graph = makeAgentGraph(state);

    const result = await resolveResumeInput(
      execution, graph, { configurable: { thread_id: "t1" } }, "hello",
    );

    expect(result.isResumeFromApproval).toBe(false);
  });

  it("builds Command(resume) when interrupts match decisions", async () => {
    const execution = makeExecution([{
      id: "call-1",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.APPROVE,
    }]);

    const state = makeGraphState([{ taskId: "task-1", toolCallId: "call-1" }]);
    const graph = makeAgentGraph(state);

    const result = await resolveResumeInput(
      execution, graph, { configurable: { thread_id: "t1" } }, "hello",
    );

    expect(result.isResumeFromApproval).toBe(true);
    expect(result.hasRejection).toBe(false);
    expect(result.graphInput).toBeInstanceOf(Command);
  });

  it("detects rejection when a decision is REJECT", async () => {
    const execution = makeExecution([{
      id: "call-1",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.REJECT,
    }]);

    const state = makeGraphState([{ taskId: "task-1", toolCallId: "call-1" }]);
    const graph = makeAgentGraph(state);

    const result = await resolveResumeInput(
      execution, graph, { configurable: { thread_id: "t1" } }, "hello",
    );

    expect(result.isResumeFromApproval).toBe(true);
    expect(result.hasRejection).toBe(true);
    expect(result.rejectionReason).toContain("Rejected by user");
  });

  it("handles multiple interrupts with mixed decisions", async () => {
    const execution = makeExecution([
      {
        id: "call-1",
        status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
        approvalAction: ApprovalAction.APPROVE,
      },
      {
        id: "call-2",
        status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
        approvalAction: ApprovalAction.SKIP,
      },
    ]);

    const state = makeGraphState([
      { taskId: "task-1", toolCallId: "call-1" },
      { taskId: "task-2", toolCallId: "call-2" },
    ]);
    const graph = makeAgentGraph(state);

    const result = await resolveResumeInput(
      execution, graph, { configurable: { thread_id: "t1" } }, "hello",
    );

    expect(result.isResumeFromApproval).toBe(true);
    expect(result.hasRejection).toBe(false);
  });

  it("skips already-resumed interrupts", async () => {
    const execution = makeExecution([{
      id: "call-1",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.APPROVE,
    }]);

    const state = makeGraphState([
      { taskId: "task-1", toolCallId: "call-1", hasResume: true },
    ]);
    const graph = makeAgentGraph(state);

    const result = await resolveResumeInput(
      execution, graph, { configurable: { thread_id: "t1" } }, "hello",
    );

    expect(result.isResumeFromApproval).toBe(false);
  });
});

describe("reconcileToolCallStatuses", () => {
  it("updates APPROVE to RUNNING", () => {
    const tc = create(ToolCallSchema, {
      id: "call-1",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    });
    const toolCalls = new Map<string, ToolCall>([["call-1", tc]]);
    const decisions = new Map([
      ["call-1", { action: ApprovalAction.APPROVE, comment: "" }],
    ]);

    reconcileToolCallStatuses(toolCalls, decisions);
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
  });

  it("updates SKIP to SKIPPED", () => {
    const tc = create(ToolCallSchema, {
      id: "call-2",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    });
    const toolCalls = new Map<string, ToolCall>([["call-2", tc]]);
    const decisions = new Map([
      ["call-2", { action: ApprovalAction.SKIP, comment: "" }],
    ]);

    reconcileToolCallStatuses(toolCalls, decisions);
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
  });

  it("updates REJECT to FAILED with error message", () => {
    const tc = create(ToolCallSchema, {
      id: "call-3",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    });
    const toolCalls = new Map<string, ToolCall>([["call-3", tc]]);
    const decisions = new Map([
      ["call-3", { action: ApprovalAction.REJECT, comment: "too risky" }],
    ]);

    reconcileToolCallStatuses(toolCalls, decisions);
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(tc.error).toContain("too risky");
  });

  it("ignores tool calls not in the map", () => {
    const toolCalls = new Map<string, ToolCall>();
    const decisions = new Map([
      ["call-missing", { action: ApprovalAction.APPROVE, comment: "" }],
    ]);

    expect(() => reconcileToolCallStatuses(toolCalls, decisions)).not.toThrow();
  });
});
