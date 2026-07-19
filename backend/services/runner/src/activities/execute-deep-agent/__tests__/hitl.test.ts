import { describe, it, expect } from "vitest";
import { Command } from "@langchain/langgraph";
import { resolveResumeInput, reconcileNonExecutingDecisions, reconcileUnattendedSkips } from "../hitl.js";
import { ApprovalAction, ApprovalPolicySource, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { create } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
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

describe("resolveResumeInput", () => {
  it("returns fresh input when no interrupts exist", () => {
    const execution = makeExecution([]);
    const state: GraphStateSnapshot = { values: {}, tasks: [] };

    const result = resolveResumeInput(execution, state, "hello");

    expect(result.isResumeFromApproval).toBe(false);
    expect(result.graphInput).toEqual({
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("returns fresh input when interrupts exist but no decisions", () => {
    const execution = makeExecution([]);
    const state = makeGraphState([{ taskId: "task-1", toolCallId: "call-1" }]);

    const result = resolveResumeInput(execution, state, "hello");

    expect(result.isResumeFromApproval).toBe(false);
  });

  it("builds Command(resume) when interrupts match decisions", () => {
    const execution = makeExecution([{
      id: "call-1",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.APPROVE,
    }]);

    const state = makeGraphState([{ taskId: "task-1", toolCallId: "call-1" }]);

    const result = resolveResumeInput(execution, state, "hello");

    expect(result.isResumeFromApproval).toBe(true);
    expect(result.graphInput).toBeInstanceOf(Command);
  });

  it("builds a resume Command for a REJECT decision (denies the tool, does not fail the run)", () => {
    const execution = makeExecution([{
      id: "call-1",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.REJECT,
    }]);

    const state = makeGraphState([{ taskId: "task-1", toolCallId: "call-1" }]);

    const result = resolveResumeInput(execution, state, "hello");

    // REJECT resumes the gate like any other decision — the gate returns a
    // denial ToolMessage and the run continues. There is no execution-level
    // "rejection" flag any more; the terminal tool status is set by
    // reconcileNonExecutingDecisions.
    expect(result.isResumeFromApproval).toBe(true);
    expect(result.graphInput).toBeInstanceOf(Command);
  });

  it("handles multiple interrupts with mixed decisions", () => {
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

    const result = resolveResumeInput(execution, state, "hello");

    expect(result.isResumeFromApproval).toBe(true);
  });

  it("skips already-resumed interrupts", () => {
    const execution = makeExecution([{
      id: "call-1",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.APPROVE,
    }]);

    const state = makeGraphState([
      { taskId: "task-1", toolCallId: "call-1", hasResume: true },
    ]);

    const result = resolveResumeInput(execution, state, "hello");

    expect(result.isResumeFromApproval).toBe(false);
  });
});

describe("reconcileNonExecutingDecisions", () => {
  function statusWith(
    toolCalls: Array<{ id: string; status: ToolCallStatus; approvalAction: ApprovalAction }>,
  ) {
    return create(AgentExecutionStatusSchema, {
      messages: [
        create(AgentMessageSchema, {
          toolCalls: toolCalls.map(tc =>
            create(ToolCallSchema, {
              id: tc.id,
              name: "test_tool",
              status: tc.status,
              approvalAction: tc.approvalAction,
            }),
          ),
        }),
      ],
    });
  }

  it("terminalizes a REJECT decision to SKIPPED with a reason (does not FAIL)", () => {
    const status = statusWith([{
      id: "call-reject",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.REJECT,
    }]);

    reconcileNonExecutingDecisions(status);

    const tc = status.messages[0].toolCalls[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(tc.error).toContain("Rejected by user");
    // The REJECT decision is preserved so the audit trail stays honest.
    expect(tc.approvalAction).toBe(ApprovalAction.REJECT);
  });

  it("terminalizes a SKIP decision to SKIPPED (fixes the stuck-WAITING for skip too)", () => {
    const status = statusWith([{
      id: "call-skip",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.SKIP,
    }]);

    reconcileNonExecutingDecisions(status);

    expect(status.messages[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
  });

  it("leaves APPROVE / APPROVE_ALL untouched (the tool executes)", () => {
    const status = statusWith([
      { id: "call-approve", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, approvalAction: ApprovalAction.APPROVE },
      { id: "call-approve-all", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, approvalAction: ApprovalAction.APPROVE_ALL },
    ]);

    reconcileNonExecutingDecisions(status);

    // Still WAITING — real tool events (not this reconciler) terminalize them.
    expect(status.messages[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(status.messages[0].toolCalls[1].status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });

  it("is a no-op when there are no decided tool calls", () => {
    const status = statusWith([{
      id: "call-pending",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.UNSPECIFIED,
    }]);

    expect(() => reconcileNonExecutingDecisions(status)).not.toThrow();
    expect(status.messages[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });
});

describe("reconcileUnattendedSkips (DD-014)", () => {
  function statusWithCalls(
    toolCalls: Array<{ id: string; status: ToolCallStatus; result?: string }>,
  ) {
    return create(AgentExecutionStatusSchema, {
      messages: [
        create(AgentMessageSchema, {
          toolCalls: toolCalls.map(tc =>
            create(ToolCallSchema, {
              id: tc.id,
              name: "gated_tool",
              status: tc.status,
              result: tc.result ?? "",
            }),
          ),
        }),
      ],
    });
  }

  it("terminalizes a registry-recorded call to SKIPPED with UNATTENDED_SKIP provenance", () => {
    // The stream saw the gate's skip ToolMessage as a normal tool result and
    // marked the call COMPLETED — the reconciler owns the honest terminal shape.
    const status = statusWithCalls([
      { id: "call-1", status: ToolCallStatus.TOOL_CALL_COMPLETED, result: "was skipped" },
    ]);

    reconcileUnattendedSkips(status, new Set(["call-1"]));

    const tc = status.messages[0].toolCalls[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(tc.approvalPolicySource).toBe(ApprovalPolicySource.UNATTENDED_SKIP);
    expect(tc.policyEngineVersion).not.toBe("");
    // Server-owned human-decision fields stay untouched (DD-014 D-e).
    expect(tc.approvalAction).toBe(ApprovalAction.UNSPECIFIED);
    expect(tc.approvedBy).toBe("");
  });

  it("backfills the skip result on a row whose tool events never fired", () => {
    const status = statusWithCalls([
      { id: "call-1", status: ToolCallStatus.TOOL_CALL_RUNNING },
    ]);

    reconcileUnattendedSkips(status, new Set(["call-1"]));

    const tc = status.messages[0].toolCalls[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(tc.result).toContain("skipped automatically");
  });

  it("touches only registry entries and no-ops on an empty/absent registry", () => {
    const status = statusWithCalls([
      { id: "call-1", status: ToolCallStatus.TOOL_CALL_COMPLETED, result: "real result" },
    ]);

    reconcileUnattendedSkips(status, new Set(["other-call"]));
    reconcileUnattendedSkips(status, new Set());
    reconcileUnattendedSkips(status, undefined);

    const tc = status.messages[0].toolCalls[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(tc.result).toBe("real result");
    expect(tc.approvalPolicySource).toBe(ApprovalPolicySource.UNSPECIFIED);
  });

  it("covers sub-agent transcripts (sub-agent gates share the parent registry)", () => {
    const status = create(AgentExecutionStatusSchema, {
      messages: [],
      subAgentExecutions: [{
        messages: [
          create(AgentMessageSchema, {
            toolCalls: [create(ToolCallSchema, {
              id: "sub-call-1",
              name: "gated_tool",
              status: ToolCallStatus.TOOL_CALL_COMPLETED,
            })],
          }),
        ],
      }],
    });

    reconcileUnattendedSkips(status, new Set(["sub-call-1"]));

    const tc = status.subAgentExecutions[0].messages[0].toolCalls[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(tc.approvalPolicySource).toBe(ApprovalPolicySource.UNATTENDED_SKIP);
  });

  it("is idempotent", () => {
    const status = statusWithCalls([
      { id: "call-1", status: ToolCallStatus.TOOL_CALL_COMPLETED },
    ]);

    reconcileUnattendedSkips(status, new Set(["call-1"]));
    const after = JSON.stringify(status.messages[0].toolCalls[0]);
    reconcileUnattendedSkips(status, new Set(["call-1"]));

    expect(JSON.stringify(status.messages[0].toolCalls[0])).toBe(after);
  });
});
