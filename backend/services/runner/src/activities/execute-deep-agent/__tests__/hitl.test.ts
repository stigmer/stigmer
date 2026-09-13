import { describe, it, expect } from "vitest";
import { Command } from "@langchain/langgraph";
import { detectPendingInterrupts, resolveResumeInput, reconcileUnattendedSkips } from "../hitl.js";
import { ApprovalAction, ApprovalPolicySource, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { create } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { GraphStateSnapshot } from "../hitl.js";

/** The runtime's reading of the adjudicated rows (`approvalDecisionsOf`): a decision per WAITING tool-call id. */
function makeDecisions(
  toolCalls: Array<{ id: string; status: ToolCallStatus; approvalAction: ApprovalAction }>,
): ReadonlyMap<string, ApprovalAction> {
  const decisions = new Map<string, ApprovalAction>();
  for (const tc of toolCalls) {
    if (tc.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL && tc.approvalAction !== ApprovalAction.UNSPECIFIED) {
      decisions.set(tc.id, tc.approvalAction);
    }
  }
  return decisions;
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
  it("reports not-a-resume when no interrupts exist (the caller sends the turn's user message)", () => {
    const decisions = makeDecisions([]);
    const state: GraphStateSnapshot = { values: {}, tasks: [] };

    const result = resolveResumeInput(decisions, state);

    expect(result.isResumeFromApproval).toBe(false);
    // No graphInput on this branch — the turn's user message has exactly ONE
    // construction site (the caller's), never a second copy here.
    expect("graphInput" in result).toBe(false);
  });

  it("reports not-a-resume when interrupts exist but no decisions", () => {
    const decisions = makeDecisions([]);
    const state = makeGraphState([{ taskId: "task-1", toolCallId: "call-1" }]);

    const result = resolveResumeInput(decisions, state);

    expect(result.isResumeFromApproval).toBe(false);
  });

  it("builds Command(resume) when interrupts match decisions", () => {
    const decisions = makeDecisions([{
      id: "call-1",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.APPROVE,
    }]);

    const state = makeGraphState([{ taskId: "task-1", toolCallId: "call-1" }]);

    const result = resolveResumeInput(decisions, state);

    if (!result.isResumeFromApproval) throw new Error("expected an approval resume");
    expect(result.graphInput).toBeInstanceOf(Command);
  });

  it("builds a resume Command for a REJECT decision (denies the tool, does not fail the run)", () => {
    const decisions = makeDecisions([{
      id: "call-1",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.REJECT,
    }]);

    const state = makeGraphState([{ taskId: "task-1", toolCallId: "call-1" }]);

    const result = resolveResumeInput(decisions, state);

    // REJECT resumes the gate like any other decision — the gate returns a
    // denial ToolMessage and the run continues. There is no execution-level
    // "rejection" flag any more; the terminal tool status is set by
    // reconcileNonExecutingDecisions.
    if (!result.isResumeFromApproval) throw new Error("expected an approval resume");
    expect(result.graphInput).toBeInstanceOf(Command);
  });

  it("handles multiple interrupts with mixed decisions", () => {
    const decisions = makeDecisions([
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

    const result = resolveResumeInput(decisions, state);

    expect(result.isResumeFromApproval).toBe(true);
  });

  it("skips already-resumed interrupts", () => {
    const decisions = makeDecisions([{
      id: "call-1",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.APPROVE,
    }]);

    const state = makeGraphState([
      { taskId: "task-1", toolCallId: "call-1", hasResume: true },
    ]);

    const result = resolveResumeInput(decisions, state);

    expect(result.isResumeFromApproval).toBe(false);
  });
});

describe("detectPendingInterrupts", () => {
  it("normalizes each un-resumed interrupt into a pending approval and skips resumed ones", () => {
    const state: GraphStateSnapshot = {
      values: {},
      tasks: [
        {
          id: "task-1",
          interrupts: [{
            value: { tool_call_id: "call-1", tool_name: "shell", mcp_server_slug: "", message: "Run it?", policy_source: "classifier_default" },
          }],
        },
        {
          id: "task-2",
          interrupts: [{ value: { tool_call_id: "call-2", tool_name: "write_file", message: "Write?" }, resumeValue: { action: "approve" } }],
        },
      ],
    };

    expect(detectPendingInterrupts(state)).toEqual([
      { toolCallId: "call-1", toolName: "shell", mcpServerSlug: "", message: "Run it?", policySource: "classifier_default" },
    ]);
  });

  it("reads an absent policy source as undefined", () => {
    const state: GraphStateSnapshot = {
      values: {},
      tasks: [{ id: "task-1", interrupts: [{ value: { tool_call_id: "call-1", tool_name: "shell", message: "Run it?" } }] }],
    };
    expect(detectPendingInterrupts(state)[0].policySource).toBeUndefined();
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
