/**
 * Unit tests for the turn-recovery digest (issue #366).
 *
 * The digest is the replacement agent's only account of the work its lost
 * predecessor did, so these pins cover the three doctrine properties it
 * inherits from the DD-013 bridge composer — bounded lines, drop-oldest
 * budget enforcement with disclosure, never-throw — plus the rendering
 * contract per message/tool-call kind.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
  type AgentMessage,
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { composeTurnRecoveryDigest, formatTurnRecoveryText } from "../turn-recovery.js";

function aiMessage(content: string, toolCalls: ToolCall[] = []): AgentMessage {
  return create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content, toolCalls });
}

type ToolCallFields = Partial<
  Pick<ToolCall, "name" | "argsPreview" | "approvalMessage" | "status" | "error">
>;

function toolCall(overrides: ToolCallFields): ToolCall {
  return create(ToolCallSchema, {
    id: "tc-1",
    name: "Shell",
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    ...overrides,
  });
}

describe("composeTurnRecoveryDigest", () => {
  it("renders assistant text and tool calls oldest-first", () => {
    const digest = composeTurnRecoveryDigest([
      aiMessage("Let me check the config first.", [
        toolCall({ name: "Read", argsPreview: '{"path":"config.yaml"}' }),
      ]),
      aiMessage("The port is wrong — fixing it."),
    ]);
    expect(digest).toBe(
      [
        "Assistant: Let me check the config first.",
        'Tool: Read({"path":"config.yaml"}) — completed',
        "Assistant: The port is wrong — fixing it.",
      ].join("\n"),
    );
  });

  it("prefers the resolved approval message for a tool line — the same description the user approved against", () => {
    const digest = composeTurnRecoveryDigest([
      aiMessage("", [
        toolCall({
          approvalMessage: "Write file: gated.txt",
          argsPreview: '{"path":"gated.txt","content":"..."}',
          status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
        }),
      ]),
    ]);
    expect(digest).toBe("Tool: Write file: gated.txt — paused for user approval");
  });

  it("maps each terminal status honestly and treats in-flight calls as interrupted", () => {
    const digest = composeTurnRecoveryDigest([
      aiMessage("", [
        toolCall({ name: "A", status: ToolCallStatus.TOOL_CALL_COMPLETED }),
        toolCall({ name: "B", status: ToolCallStatus.TOOL_CALL_FAILED, error: "exit 1" }),
        toolCall({ name: "C", status: ToolCallStatus.TOOL_CALL_FAILED }),
        toolCall({ name: "D", status: ToolCallStatus.TOOL_CALL_SKIPPED }),
        toolCall({ name: "E", status: ToolCallStatus.TOOL_CALL_RUNNING }),
        toolCall({ name: "F", status: ToolCallStatus.TOOL_CALL_PENDING }),
      ]),
    ]);
    expect(digest).toBe(
      [
        "Tool: A — completed",
        "Tool: B — failed: exit 1",
        "Tool: C — failed",
        "Tool: D — skipped",
        "Tool: E — interrupted before it finished",
        "Tool: F — interrupted before it finished",
      ].join("\n"),
    );
  });

  it("keeps system notices but skips human messages (already in <user_request>), thinking, and blanks", () => {
    const digest = composeTurnRecoveryDigest([
      create(AgentMessageSchema, { type: MessageType.MESSAGE_HUMAN, content: "Fix the build" }),
      create(AgentMessageSchema, { type: MessageType.MESSAGE_SYSTEM, content: "Budget warning: 80% used" }),
      create(AgentMessageSchema, { type: MessageType.MESSAGE_THINKING, content: "hmm, maybe the lockfile" }),
      aiMessage("   "),
    ]);
    expect(digest).toBe("System: Budget warning: 80% used");
  });

  it("returns undefined when nothing renders", () => {
    expect(composeTurnRecoveryDigest([])).toBeUndefined();
    expect(
      composeTurnRecoveryDigest([
        create(AgentMessageSchema, { type: MessageType.MESSAGE_HUMAN, content: "only the request" }),
      ]),
    ).toBeUndefined();
  });

  it("truncates a long assistant line at the per-line budget with an ellipsis", () => {
    const digest = composeTurnRecoveryDigest([aiMessage("x".repeat(1000))]);
    expect(digest).toBe(`Assistant: ${"x".repeat(400)}\u2026`);
  });

  it("drops the OLDEST lines when over the whole-digest budget and discloses the omission", () => {
    // 30 lines of ~311 chars each (~9.6k total) against the 4000-char budget:
    // the newest lines must survive, the oldest go, and the notice leads.
    const messages = Array.from({ length: 30 }, (_, i) =>
      aiMessage(`step ${String(i).padStart(2, "0")} ${"y".repeat(300)}`),
    );
    const digest = composeTurnRecoveryDigest(messages);
    expect(digest).toBeDefined();
    expect(digest!.length).toBeLessThanOrEqual(4000);
    const lines = digest!.split("\n");
    expect(lines[0]).toBe("[\u2026 earlier activity in this turn omitted for length]");
    // Recency wins: the last line is the newest entry, the first entries are gone.
    expect(lines[lines.length - 1]).toContain("step 29");
    expect(digest).not.toContain("step 00");
  });

  it("never throws — a malformed message degrades to no digest, not a failed recovery", () => {
    // Force the internal iteration to blow up: content getter that throws.
    const poison = new Proxy(aiMessage("ok"), {
      get(target, prop, receiver) {
        if (prop === "content") throw new Error("corrupt row");
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(composeTurnRecoveryDigest([poison as AgentMessage])).toBeUndefined();
  });
});

describe("formatTurnRecoveryText", () => {
  it("frames a digest with the work-already-done preamble", () => {
    const text = formatTurnRecoveryText("Assistant: did things");
    expect(text).toContain("session holding that conversation was lost");
    expect(text).toContain("do not start the task over");
    expect(text.endsWith("Assistant: did things")).toBe(true);
  });

  it("still discloses the state loss when there is no transcript — without it the appended decisions would read as reactions to proposals this agent never made", () => {
    for (const empty of [undefined, "", "   "]) {
      const text = formatTurnRecoveryText(empty);
      expect(text).toContain("session holding that conversation was lost");
      expect(text).toContain("no transcript of your progress is available");
    }
  });
});
