// Tests for the plaintext renderer: AI text to data, terse status lines to
// status, approvals auto-skipped, untracked event kinds silent.

import { describe, expect, it } from "vitest";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { StreamEvent, ToolCallInfo } from "./events.js";
import { PlaintextRenderer } from "./render-plaintext.js";

function toolInfo(overrides: Partial<ToolCallInfo> = {}): ToolCallInfo {
  return { id: "t1", name: "read", status: "completed", result: "", error: "", durationMs: 0, ...overrides };
}

function render(events: StreamEvent[]): { data: string; status: string } {
  let data = "";
  let status = "";
  const r = new PlaintextRenderer({ data: { write: (s) => void (data += s) }, status: { write: (s) => void (status += s) } });
  for (const e of events) r.render(e);
  return { data, status };
}

describe("PlaintextRenderer", () => {
  it("streams AI text to data and finalizes on stream end", () => {
    const { data } = render([
      { kind: "aiStreamDelta", content: "Hello", subAgentId: "" },
      { kind: "aiStreamDelta", content: " world", subAgentId: "" },
      { kind: "aiStreamEnd", content: "Hello world", subAgentId: "", toolCalls: [] },
    ]);
    expect(data).toBe("Hello world\n");
  });

  it("writes tool success and failure lines to status", () => {
    const { status } = render([
      { kind: "toolRunning", toolCallId: "t1", subAgentId: "", toolCall: toolInfo({ status: "running" }) },
      { kind: "toolCompleted", toolCallId: "t1", subAgentId: "", toolCall: toolInfo() },
      { kind: "toolCompleted", toolCallId: "t2", subAgentId: "", toolCall: toolInfo({ name: "shell", error: "exploded" }) },
    ]);
    expect(status).toContain("⠋ read");
    expect(status).toContain("✓ read");
    expect(status).toContain("✗ shell: exploded");
  });

  it("titles shell status lines with the model-authored intent when present (stigmer#276)", () => {
    const { status } = render([
      {
        kind: "toolRunning",
        toolCallId: "t1",
        subAgentId: "",
        toolCall: toolInfo({
          name: "execute",
          status: "running",
          args: { command: "npx vitest run src/parser", description: "Run unit tests for the parser" },
        }),
      },
      {
        kind: "toolCompleted",
        toolCallId: "t1",
        subAgentId: "",
        toolCall: toolInfo({
          name: "execute",
          args: { command: "npx vitest run src/parser", description: "Run unit tests for the parser" },
        }),
      },
    ]);
    expect(status).toContain("⠋ Run unit tests for the parser");
    expect(status).toContain("✓ Run unit tests for the parser");
    expect(status).not.toContain("execute");
  });

  it("keeps the raw tool name when there is no intent, and never titles non-shell tools from description", () => {
    const { status } = render([
      {
        kind: "toolCompleted",
        toolCallId: "t1",
        subAgentId: "",
        toolCall: toolInfo({ name: "execute", args: { command: "ls" } }),
      },
      {
        kind: "toolCompleted",
        toolCallId: "t2",
        subAgentId: "",
        toolCall: toolInfo({
          name: "task",
          args: { description: "general-purpose research", prompt: "Find the docs" },
        }),
      },
    ]);
    // A task tool's description is the sub-agent subject, never a row title.
    expect(status).toContain("✓ execute");
    expect(status).toContain("✓ task");
    expect(status).not.toContain("general-purpose research");
  });

  it("renders an interrupted tool with the neutral glyph, not a checkmark (issue #207)", () => {
    const { status } = render([
      { kind: "toolInterrupted", toolCallId: "t1", subAgentId: "", toolCall: toolInfo({ name: "shell", status: "interrupted" }) },
    ]);
    expect(status).toContain("⊘ shell (interrupted)");
    expect(status).not.toContain("✓");
  });

  it("notes the auto-skip for approvals and resolves to SKIP", () => {
    const r = new PlaintextRenderer({ data: { write: () => {} }, status: { write: () => {} } });
    const action = r.resolveApproval({
      kind: "approvalNeeded", toolCallId: "t1", toolName: "delete", argsPreview: "", message: "", fromSubAgent: false, subAgentName: "",
    });
    expect(action).toBe(ApprovalAction.SKIP);

    const { status } = render([
      { kind: "approvalNeeded", toolCallId: "t1", toolName: "delete", argsPreview: "", message: "", fromSubAgent: false, subAgentName: "" },
    ]);
    expect(status).toContain("Approval needed: delete (auto-skipped in non-TTY mode)");
  });

  it("renders sub-agent and context-compaction lines, stays silent on phase/done", () => {
    const { data, status } = render([
      { kind: "subAgentStarted", id: "s1", name: "researcher", description: "Explore code", input: "" },
      { kind: "subAgentCompleted", id: "s1", status: "SUB_AGENT_COMPLETED", toolCount: 2, output: "" },
      { kind: "contextCompacted", source: "graph_start", tokensBefore: 12000, tokensAfter: 6000, compressionRatio: 0.5, durationMs: 10, messagesBefore: 8, messagesAfter: 3 },
      { kind: "phaseChange", phase: "in_progress", previous: "pending" },
      { kind: "done", phase: "completed", error: "" },
    ]);
    expect(status).toContain("↳ Sub-agent: Explore code");
    expect(status).toContain("✓ Sub-agent completed: s1");
    expect(status).toContain("Context compacted (12K → 6K tokens)");
    expect(data).toBe("");
  });
});
