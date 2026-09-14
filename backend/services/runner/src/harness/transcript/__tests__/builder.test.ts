/**
 * `TranscriptBuilder` (`harness/transcript/builder.ts`), driven with
 * `TranscriptEvent`s directly — one arm per rule the builder's header lists,
 * in the order it lists them. These are the arms a third harness's author
 * reads to learn what a translator's events do to the transcript; the arms
 * that drive the builder through a real translator over a real wire are
 * the translator's own (`execute-deep-agent/__tests__/`, the native
 * translator's integration arms; Q-M2-6).
 *
 * Fence-clean by construction: this file names the proto runtime, the
 * generated protos, `vitest` and the builder — nothing of any engine
 * (`harness/__tests__/transcript-is-engine-free.test.ts`).
 *
 * Opened at S4 M2 C5b with the row rules that are byte-identical on native
 * and therefore have no golden (Q-S4-3(c)(d), the gated `tool_error` stamp);
 * `approval_proposed` and `system_note` joined at C6; the rest of the
 * header's rules land at C9.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalPolicySource,
  MessageType,
  ToolCallStatus,
  ToolCallStreamingSource,
  ToolKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { TranscriptBuilder } from "../builder.js";
import type { TranscriptEvent } from "../events.js";

function builder(): TranscriptBuilder {
  return new TranscriptBuilder("exec-test", create(AgentExecutionStatusSchema, {}));
}

function feed(sb: TranscriptBuilder, events: TranscriptEvent[]): TranscriptBuilder {
  for (const e of events) sb.apply(e);
  return sb;
}

/** A text turn that proposes a tool, then the tool's start. */
function proposedCall(callId = "call-1", name = "read_file"): TranscriptEvent[] {
  return [
    { kind: "message_start", runId: "run-1" },
    { kind: "text_delta", runId: "run-1", text: "Let me look." },
    { kind: "message_finish", runId: "run-1" },
    { kind: "tool_started", callId, name, input: { path: "/x" }, mcpServerSlug: "" },
  ];
}

function rowOf(sb: TranscriptBuilder, callId: string) {
  const row = sb.currentStatus.messages.flatMap((m) => m.toolCalls).find((tc) => tc.id === callId);
  if (!row) throw new Error(`no row ${callId}`);
  return row;
}

describe("TranscriptBuilder — tool_finished and tool_error are upserts (Q-S4-3(c))", () => {
  it("a finish completes the row, stamps completedAt once and stores the result", () => {
    const sb = feed(builder(), [...proposedCall(), { kind: "tool_finished", callId: "call-1", result: "contents" }]);
    const row = rowOf(sb, "call-1");
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(row.result).toBe("contents");
    expect(row.completedAt).toContain("T");
    expect(row.isStreaming).toBe(false);
  });

  it("a second completion never regresses a settled status and never clears a result with an empty one", () => {
    const sb = feed(builder(), [
      ...proposedCall(),
      { kind: "tool_error", callId: "call-1", message: "denied" },
      { kind: "tool_finished", callId: "call-1", result: "" },
    ]);
    const row = rowOf(sb, "call-1");
    expect(row.status, "FAILED stays FAILED").toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(row.error).toBe("denied");
    expect(row.result).toBe("");
  });

  it("a non-empty later result overwrites an earlier one; completedAt keeps its first stamp", () => {
    const sb = feed(builder(), [
      ...proposedCall(),
      { kind: "tool_finished", callId: "call-1", result: "partial" },
      { kind: "tool_finished", callId: "call-1", result: "" },
      { kind: "tool_finished", callId: "call-1", result: "final" },
    ]);
    const row = rowOf(sb, "call-1");
    expect(row.result).toBe("final");
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(row.completedAt).not.toBe("");
  });

  it("an error fails the row with its message; an empty message never clears an earlier one", () => {
    const sb = feed(builder(), [
      ...proposedCall(),
      { kind: "tool_error", callId: "call-1", message: "EACCES" },
      { kind: "tool_error", callId: "call-1", message: "" },
    ]);
    const row = rowOf(sb, "call-1");
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(row.error).toBe("EACCES");
  });

  it("a gated row's error stamps approvalRequestedAt once — the boundary's shape (Cursor)", () => {
    const sb = feed(builder(), [
      { kind: "message_start", runId: "run-1" },
      { kind: "text_delta", runId: "run-1", text: "Running the build." },
      { kind: "tool_started", callId: "sh-1", name: "Shell", input: { command: "make" }, mcpServerSlug: "", gate: { message: "Run command: make" } },
      { kind: "tool_error", callId: "sh-1", message: "Blocked by hook" },
    ]);
    const row = rowOf(sb, "sh-1");
    expect(row.requiresApproval).toBe(true);
    expect(row.approvalMessage).toBe("Run command: make");
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    const stamped = row.approvalRequestedAt;
    expect(stamped).toContain("T");
    sb.apply({ kind: "tool_error", callId: "sh-1", message: "again" });
    expect(rowOf(sb, "sh-1").approvalRequestedAt, "stamped once").toBe(stamped);
  });

  it("an ungated row's error stamps no approvalRequestedAt", () => {
    const sb = feed(builder(), [...proposedCall(), { kind: "tool_error", callId: "call-1", message: "x" }]);
    expect(rowOf(sb, "call-1").approvalRequestedAt).toBe("");
  });

  it("a finish or an error for an unknown call is ignored", () => {
    const sb = feed(builder(), [
      { kind: "tool_finished", callId: "ghost", result: "x" },
      { kind: "tool_error", callId: "ghost", message: "y" },
    ]);
    expect(sb.currentStatus.messages).toHaveLength(0);
  });
});

describe("TranscriptBuilder — approval_proposed is the one place a row is ever WAITING (Q-S4-20, Q-S4-3(e))", () => {
  const proposal = (callId: string, extra: Partial<Extract<TranscriptEvent, { kind: "approval_proposed" }>> = {}) =>
    ({
      kind: "approval_proposed",
      callId,
      name: "execute",
      mcpServerSlug: "",
      message: "Execute command: rm -rf build",
      ...extra,
    }) as const satisfies TranscriptEvent;

  it("an unknown call gets a WAITING row on the message whose text proposed it — never a new empty message", () => {
    const sb = feed(builder(), [
      { kind: "message_start", runId: "run-1" },
      { kind: "text_delta", runId: "run-1", text: "I will run the command." },
      { kind: "message_finish", runId: "run-1" },
      proposal("exec-1", { args: { command: "rm -rf build" }, provenance: "builtin_category" }),
    ]);
    expect(sb.currentStatus.messages.map((m) => m.content)).toEqual(["I will run the command."]);
    const row = rowOf(sb, "exec-1");
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(row.requiresApproval).toBe(true);
    expect(row.approvalMessage).toBe("Execute command: rm -rf build");
    expect(row.approvalRequestedAt).toContain("T");
    expect(row.startedAt).toContain("T");
    expect(row.args).toEqual({ command: "rm -rf build" });
    expect(row.argsPreview).toBe(JSON.stringify({ command: "rm -rf build" }));
    expect(row.approvalPolicySource).toBe(ApprovalPolicySource.BUILTIN_CATEGORY);
    expect(row.policyEngineVersion).toBe("phase-7");
    expect(row.toolKind).toBe(ToolKind.SHELL);
    expect(sb.awaitingApproval, "the fact the caller reads").toBe(true);
  });

  it("with no message in the scope yet, the row gets an empty AI message (the boundary's fallback)", () => {
    const sb = feed(builder(), [proposal("exec-1")]);
    expect(sb.currentStatus.messages.map((m) => [m.type, m.content])).toEqual([[MessageType.MESSAGE_AI, ""]]);
    expect(rowOf(sb, "exec-1").status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });

  it("carries the MCP server, and the digest when the harness has one", () => {
    const sb = feed(builder(), [
      proposal("mcp-1", { name: "create_issue", mcpServerSlug: "github", provenance: "agent_override", contentDigest: "sha-1" }),
    ]);
    const row = rowOf(sb, "mcp-1");
    expect(row.mcpServerSlug).toBe("github");
    expect(row.toolKind).toBe(ToolKind.MCP);
    expect(row.approvalContentDigest).toBe("sha-1");
    expect(row.approvalPolicySource).toBe(ApprovalPolicySource.AGENT_OVERRIDE);
  });

  it("a known row REOPENS: WAITING, the outcome fields cleared, approvalRequestedAt stamped once (Cursor's denial overlay)", () => {
    const sb = feed(builder(), [
      { kind: "message_start", runId: "run-1" },
      { kind: "text_delta", runId: "run-1", text: "Running the build." },
      { kind: "tool_started", callId: "sh-1", name: "Shell", input: { command: "make" }, mcpServerSlug: "", gate: { message: "Run command: make" } },
      { kind: "tool_error", callId: "sh-1", message: "Blocked by hook" },
    ]);
    const stamped = rowOf(sb, "sh-1").approvalRequestedAt;
    sb.apply(proposal("sh-1", { name: "Shell", message: "Run command: make", contentDigest: "d-1" }));
    const row = rowOf(sb, "sh-1");
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(row.error).toBe("");
    expect(row.result).toBe("");
    expect(row.completedAt).toBe("");
    expect(row.approvalRequestedAt, "the first stamp stands").toBe(stamped);
    expect(row.approvalContentDigest).toBe("d-1");
    expect(sb.currentStatus.messages.flatMap((m) => m.toolCalls), "no second row").toHaveLength(1);
    expect(sb.awaitingApproval).toBe(true);
  });

  it("proposing a call the stream already showed never duplicates it (F-M2-13)", () => {
    const sb = feed(builder(), [...proposedCall("exec-1", "execute"), proposal("exec-1")]);
    expect(sb.currentStatus.messages.flatMap((m) => m.toolCalls).map((tc) => tc.id)).toEqual(["exec-1"]);
  });

  it("no tool_started ever sets awaitingApproval; only a proposal does", () => {
    const sb = feed(builder(), [
      { kind: "tool_started", callId: "sh-1", name: "Shell", input: {}, mcpServerSlug: "", gate: { message: "Run command" } },
    ]);
    expect(sb.awaitingApproval).toBe(false);
    expect(rowOf(sb, "sh-1").status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
  });
});

describe("TranscriptBuilder — system_note is the harness's line in its own voice (Q-S4-18)", () => {
  it("appends a SYSTEM message to the scope; it hosts no rows and moves no boundary", () => {
    const sb = feed(builder(), [
      { kind: "message_start", runId: "run-1" },
      { kind: "text_delta", runId: "run-1", text: "Working." },
      { kind: "system_note", text: "The agent's changes could not be reviewed." },
      { kind: "tool_started", callId: "t-1", name: "read", input: {}, mcpServerSlug: "" },
    ]);
    expect(sb.currentStatus.messages.map((m) => [m.type, m.content])).toEqual([
      [MessageType.MESSAGE_AI, "Working."],
      [MessageType.MESSAGE_SYSTEM, "The agent's changes could not be reviewed."],
    ]);
    expect(sb.currentStatus.messages[0].toolCalls.map((tc) => tc.id), "the row still joins the AI message").toEqual(["t-1"]);
    expect(sb.currentStatus.messages[1].toolCalls).toHaveLength(0);
  });

  it("lands in a sub-agent's transcript when scoped there", () => {
    const sb = feed(builder(), [
      { kind: "sub_agent_started", subAgentId: "task-1", name: "helper", subject: "s", input: "s" },
      { kind: "system_note", subAgentId: "task-1", text: "note" },
    ]);
    expect(sb.currentStatus.messages).toHaveLength(0);
    expect(sb.currentStatus.subAgentExecutions[0].messages.map((m) => m.content)).toEqual(["note"]);
  });
});

describe("TranscriptBuilder — tool_output_delta streams the row's output (Q-S4-3(d))", () => {
  it("appends the delta and marks the row streaming its OUTPUT", () => {
    const sb = feed(builder(), [
      ...proposedCall("sh-1", "execute"),
      { kind: "tool_output_delta", callId: "sh-1", delta: "line 1\n" },
      { kind: "tool_output_delta", callId: "sh-1", delta: "line 2\n" },
    ]);
    const row = rowOf(sb, "sh-1");
    expect(row.result).toBe("line 1\nline 2\n");
    expect(row.isStreaming).toBe(true);
    expect(row.streamingSource).toBe(ToolCallStreamingSource.OUTPUT);
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
  });

  it("the finish closes the streaming row and clears the source; a non-empty final result replaces the streamed text", () => {
    const sb = feed(builder(), [
      ...proposedCall("sh-1", "execute"),
      { kind: "tool_output_delta", callId: "sh-1", delta: "partial" },
      { kind: "tool_finished", callId: "sh-1", result: "partial and complete" },
    ]);
    const row = rowOf(sb, "sh-1");
    expect(row.isStreaming).toBe(false);
    expect(row.streamingSource).toBe(ToolCallStreamingSource.UNSPECIFIED);
    expect(row.result).toBe("partial and complete");
  });

  it("finalize() closes a row still streaming when the stream ends, and every message with it", () => {
    const sb = feed(builder(), [
      ...proposedCall("sh-1", "execute"),
      { kind: "tool_output_delta", callId: "sh-1", delta: "never finished" },
      { kind: "message_start", runId: "run-2" },
      { kind: "text_delta", runId: "run-2", text: "still streaming" },
    ]);
    sb.finalize();
    const row = rowOf(sb, "sh-1");
    expect(row.isStreaming).toBe(false);
    expect(row.streamingSource).toBe(ToolCallStreamingSource.UNSPECIFIED);
    expect(row.result, "the streamed output is kept").toBe("never finished");
    expect(sb.currentStatus.messages.every((m) => !m.isStreaming)).toBe(true);
    expect(sb.currentStatus.messages.at(-1)?.type).toBe(MessageType.MESSAGE_AI);
  });
});
