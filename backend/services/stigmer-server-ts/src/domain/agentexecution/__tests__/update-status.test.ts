/**
 * Pins the updateStatus merge engine against Go's
 * update_status_guard_test.go and
 * update_status_recalled_memories_report_test.go case-for-case: the
 * transcript regression guard (shrink + front-truncation-with-append +
 * the terminal exemption), the equal-length approval finalize, and the
 * presence-guarded runner-owned field pattern (recalled_memories_report).
 * These exercise applyUpdateStatusMerge directly on a clone — mirroring
 * the freshly-loaded resource the merge mutates in place inside the
 * updateResource write lock.
 */
import { clone, create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalAction,
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentExecutionUpdateStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

import { createLogger } from "../../../boot/logger.js";
import { findToolCallInExecution } from "../submit-approval.js";
import { applyUpdateStatusMerge } from "../update-status.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/**
 * Applies the merge to a clone of the existing execution and returns the
 * merged result (Go runBuildStep).
 */
function runBuildStep(
  existing: AgentExecution,
  incoming: MessageInitShape<typeof AgentExecutionStatusSchema>,
): AgentExecution {
  const input = create(AgentExecutionUpdateStatusInputSchema, {
    executionId: existing.metadata?.id ?? "",
    status: incoming,
  });
  const merged = clone(AgentExecutionSchema, existing);
  applyUpdateStatusMerge(merged, input, silentLogger);
  return merged;
}

function messages(...contents: string[]): AgentMessage[] {
  return contents.map((c) => create(AgentMessageSchema, { content: c }));
}

function existingWith(
  phase: ExecutionPhase,
  ...msgs: string[]
): AgentExecution {
  return create(AgentExecutionSchema, {
    metadata: { id: "exec-guard", name: "exec-guard" },
    spec: {},
    status: { phase, messages: msgs.map((c) => ({ content: c })) },
  });
}

describe("the transcript regression guard (update_status_guard_test.go)", () => {
  it("rejects a shrinking transcript for a non-terminal execution", () => {
    const merged = runBuildStep(
      existingWith(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL, "m1", "m2", "m3"),
      {
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        messages: [{ content: "only-one" }],
      },
    );
    expect(merged.status?.messages).toHaveLength(3);
    expect(merged.status?.messages[0]?.content).toBe("m1");
  });

  it("accepts the equal-length approval finalize (narration blanked in place) and projects the gate", () => {
    const existing = create(AgentExecutionSchema, {
      metadata: { id: "exec-guard", name: "exec-guard" },
      spec: {},
      status: {
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        messages: [
          { content: "let me create the file" },
          {
            toolCalls: [
              {
                id: "tc-write",
                name: "Write",
                status: ToolCallStatus.TOOL_CALL_FAILED,
                requiresApproval: true,
              },
            ],
          },
          { content: "I could not write the file; approve it when prompted" },
        ],
      },
    });
    const merged = runBuildStep(existing, {
      phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      messages: [
        { content: "let me create the file" },
        {
          toolCalls: [
            {
              id: "tc-write",
              name: "Write",
              status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
              requiresApproval: true,
            },
          ],
        },
        { content: "" },
      ],
    });

    expect(
      merged.status?.messages,
      "append-only finalize keeps all 3 messages (narration blanked, not removed)",
    ).toHaveLength(3);
    expect(merged.status?.messages[2]?.content).toBe("");
    expect(
      merged.status?.pendingApprovals,
      "the gated WAITING_APPROVAL call projects exactly one pending approval",
    ).toHaveLength(1);
    expect(merged.status?.pendingApprovals[0]?.toolCallId).toBe("tc-write");
  });

  it("rejects a shrinking WAITING_FOR_APPROVAL finalize (no phase carve-out)", () => {
    const merged = runBuildStep(
      existingWith(ExecutionPhase.EXECUTION_IN_PROGRESS, "m1", "m2", "m3"),
      {
        phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
        messages: [{ content: "m1" }, { content: "m2" }],
      },
    );
    expect(merged.status?.messages).toHaveLength(3);
  });

  it("accepts a growing transcript (the normal streaming case)", () => {
    const merged = runBuildStep(
      existingWith(ExecutionPhase.EXECUTION_IN_PROGRESS, "m1", "m2"),
      {
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        messages: [{ content: "m1" }, { content: "m2" }, { content: "m3" }],
      },
    );
    expect(merged.status?.messages).toHaveLength(3);
  });

  it("accepts an equal-length replacement (in-place mutation of the same turns)", () => {
    const merged = runBuildStep(
      existingWith(ExecutionPhase.EXECUTION_IN_PROGRESS, "m1", "m2"),
      {
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        messages: [{ content: "m1-updated" }, { content: "m2-updated" }],
      },
    );
    expect(merged.status?.messages).toHaveLength(2);
    expect(merged.status?.messages[0]?.content).toBe("m1-updated");
  });

  it("rejects front-truncation-with-append (the gap a count-only guard cannot see)", () => {
    const existing = create(AgentExecutionSchema, {
      metadata: { id: "exec-guard", name: "exec-guard" },
      spec: {},
      status: {
        phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
        messages: [
          {
            type: MessageType.MESSAGE_THINKING,
            content: "planning the self-DM",
          },
          {
            type: MessageType.MESSAGE_AI,
            toolCalls: [
              {
                id: "tc-getappstate",
                name: "getAppState",
                status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
                requiresApproval: true,
                approvalAction: ApprovalAction.APPROVE_ALL,
                mcpServerSlug: "open-computer-use",
              },
            ],
          },
        ],
      },
    });
    // Regressed resume transcript: leading thinking + getAppState gone,
    // later leased tools appended. len(incoming)=3 >= existing=2, so a
    // count-only guard would not fire.
    const merged = runBuildStep(existing, {
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages: [
        {
          type: MessageType.MESSAGE_AI,
          toolCalls: [
            { id: "tc-click", name: "click", status: ToolCallStatus.TOOL_CALL_COMPLETED },
          ],
        },
        {
          type: MessageType.MESSAGE_AI,
          toolCalls: [
            { id: "tc-scroll", name: "scroll", status: ToolCallStatus.TOOL_CALL_COMPLETED },
          ],
        },
        { type: MessageType.MESSAGE_AI, content: "done" },
      ],
    });

    const hasThinking = merged.status?.messages.some(
      (m) =>
        m.type === MessageType.MESSAGE_THINKING &&
        m.content === "planning the self-DM",
    );
    expect(
      hasThinking,
      "the leading thinking block must survive a front-truncated-but-appended update",
    ).toBe(true);
    expect(
      findToolCallInExecution(merged, "tc-getappstate"),
      "the first tool call must survive a front-truncated-but-appended update",
    ).toBeDefined();
  });

  it("allows a shrink for a terminal execution (administrative correction)", () => {
    const merged = runBuildStep(
      existingWith(ExecutionPhase.EXECUTION_COMPLETED, "m1", "m2", "m3"),
      {
        phase: ExecutionPhase.EXECUTION_COMPLETED,
        messages: [{ content: "single" }],
      },
    );
    expect(merged.status?.messages).toHaveLength(1);
  });

  it("keeps the TERMINATED transcript guarded (the narrow transcript-terminal set)", () => {
    // TERMINATED is deliberately absent from the transcript guard's
    // terminal set (phases.ts) — a terminated execution's committed
    // transcript stays protected from free rewrites.
    const merged = runBuildStep(
      existingWith(ExecutionPhase.EXECUTION_TERMINATED, "m1", "m2", "m3"),
      {
        phase: ExecutionPhase.EXECUTION_TERMINATED,
        messages: [{ content: "single" }],
      },
    );
    expect(merged.status?.messages).toHaveLength(3);
  });
});

describe("the phase latch and terminal settle", () => {
  it("latches a terminal phase against a straggler IN_PROGRESS persist and re-settles its rows", () => {
    const existing = create(AgentExecutionSchema, {
      metadata: { id: "exec-latch", name: "exec-latch" },
      spec: {},
      status: {
        phase: ExecutionPhase.EXECUTION_TERMINATED,
        completedAt: "2026-08-24T10:00:00Z",
        messages: [{ content: "m1" }],
      },
    });
    // The straggler carries a live phase and a RUNNING tool call appended
    // to an equal-or-longer transcript.
    const merged = runBuildStep(existing, {
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages: [
        { content: "m1" },
        {
          toolCalls: [
            { id: "tc-live", name: "shell", status: ToolCallStatus.TOOL_CALL_RUNNING },
          ],
        },
      ],
    });

    expect(
      merged.status?.phase,
      "the terminal phase is final (Recover is the sanctioned un-terminalizer)",
    ).toBe(ExecutionPhase.EXECUTION_TERMINATED);
    const straggler = findToolCallInExecution(merged, "tc-live");
    expect(
      straggler?.status,
      "the straggler's RUNNING row re-settles in the same merge (#207)",
    ).toBe(ToolCallStatus.TOOL_CALL_INTERRUPTED);
    expect(straggler?.completedAt).toBe("2026-08-24T10:00:00Z");
  });

  it("clears completed_at when the merged phase is non-terminal (resume defense-in-depth)", () => {
    const existing = create(AgentExecutionSchema, {
      metadata: { id: "exec-resume", name: "exec-resume" },
      spec: {},
      status: {
        phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
        completedAt: "2026-08-24T10:00:00Z",
        messages: [{ content: "m1" }],
      },
    });
    const merged = runBuildStep(existing, {
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages: [{ content: "m1" }],
    });
    expect(merged.status?.completedAt).toBe("");
  });
});

describe("the presence-guarded runner-owned field pattern (recalled_memories_report)", () => {
  function selectionReport(...ids: string[]) {
    return {
      selectionActive: true,
      injectedMemoryIds: ids,
      embeddingModel: "text-embedding-3-small",
    };
  }

  it("stores a runner-sent report", () => {
    const merged = runBuildStep(
      existingWith(ExecutionPhase.EXECUTION_IN_PROGRESS, "m1"),
      {
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        messages: [{ content: "m1" }],
        recalledMemoriesReport: selectionReport("mem_a", "mem_b"),
      },
    );
    const report = merged.status?.recalledMemoriesReport;
    expect(report).toBeDefined();
    expect(report?.selectionActive).toBe(true);
    expect(report?.injectedMemoryIds).toEqual(["mem_a", "mem_b"]);
    expect(report?.embeddingModel).toBe("text-embedding-3-small");
  });

  it("preserves the stored report across report-less writes (incl. the terminal persist)", () => {
    const existing = existingWith(ExecutionPhase.EXECUTION_IN_PROGRESS, "m1");
    (existing.status as AgentExecutionStatus).recalledMemoriesReport = create(
      AgentExecutionStatusSchema,
      { recalledMemoriesReport: selectionReport("mem_a") },
    ).recalledMemoriesReport;

    const merged = runBuildStep(existing, {
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      messages: [{ content: "m1" }, { content: "m2" }],
    });
    expect(merged.status?.recalledMemoriesReport?.injectedMemoryIds).toEqual([
      "mem_a",
    ]);
  });

  it("never invents a report (runner-owned, single writer)", () => {
    const merged = runBuildStep(
      existingWith(ExecutionPhase.EXECUTION_IN_PROGRESS, "m1"),
      {
        phase: ExecutionPhase.EXECUTION_COMPLETED,
        messages: [{ content: "m1" }, { content: "m2" }],
      },
    );
    expect(merged.status?.recalledMemoriesReport).toBeUndefined();
  });
});
