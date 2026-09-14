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
 * `approval_proposed` and `system_note` joined at C6, the every-row preview
 * at C7, the todo projection at C8, and the rest of the header's rules —
 * the row per id, the message boundary, the thinking row, the sub-agent
 * rows, finalize, artifacts and write-backs, the dirty flag, the error
 * guard — at C9.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalAction,
  ApprovalPolicySource,
  MessageType,
  SubAgentStatus,
  TodoStatus,
  ToolCallStatus,
  ToolCallStreamingSource,
  ToolKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { WorkspaceWriteBackSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
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

describe("TranscriptBuilder — every row with args carries an elided, redacted argsPreview (Q-S4-16)", () => {
  it("an ungated row's preview is its args, secret keys redacted", () => {
    const sb = feed(builder(), [
      { kind: "tool_started", callId: "c-1", name: "connect", input: { host: "localhost", password: "super-secret" }, mcpServerSlug: "db" },
    ]);
    expect(JSON.parse(rowOf(sb, "c-1").argsPreview)).toEqual({ host: "localhost", password: "[REDACTED]" });
  });

  it("a long non-salient value is elided in place; a salient one (the command) survives verbatim", () => {
    const command = "echo " + "x".repeat(400);
    const sb = feed(builder(), [
      { kind: "tool_started", callId: "sh-1", name: "execute", input: { command, notes: "y".repeat(400) }, mcpServerSlug: "" },
    ]);
    const preview = JSON.parse(rowOf(sb, "sh-1").argsPreview);
    expect(preview.command).toBe(command);
    expect(preview.notes).toBe("[400 chars]");
  });

  it("a row with no args carries no preview", () => {
    const sb = feed(builder(), [{ kind: "tool_started", callId: "n-1", name: "ls", input: {}, mcpServerSlug: "" }]);
    expect(rowOf(sb, "n-1").argsPreview).toBe("");
    expect(rowOf(sb, "n-1").args).toBeUndefined();
  });

  it("unserializable args leave the preview unset instead of failing the row", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sb = feed(builder(), [{ kind: "tool_started", callId: "cy-1", name: "read", input: cyclic, mcpServerSlug: "" }]);
    expect(rowOf(sb, "cy-1").status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
    expect(rowOf(sb, "cy-1").argsPreview).toBe("");
  });

  it("a sub-agent's row carries a preview too — every row, every scope", () => {
    const sb = feed(builder(), [
      { kind: "sub_agent_started", subAgentId: "task-1", name: "helper", subject: "s", input: "s" },
      { kind: "tool_started", subAgentId: "task-1", callId: "g-1", name: "grep", input: { pattern: "x" }, mcpServerSlug: "" },
    ]);
    const row = sb.currentStatus.subAgentExecutions[0].messages[0].toolCalls[0];
    expect(row.argsPreview).toBe(JSON.stringify({ pattern: "x" }));
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

  it("a known row's reopen takes the proposal's args and re-derives the preview when carried; keeps its own when not (Q-M4-7)", () => {
    const sb = feed(builder(), [
      { kind: "message_start", runId: "run-1" },
      { kind: "text_delta", runId: "run-1", text: "Editing notes." },
      { kind: "tool_started", callId: "ed-1", name: "edit", input: { path: "notes.md", content: "partial" }, mcpServerSlug: "", gate: { message: "Write file: notes.md" } },
      { kind: "tool_error", callId: "ed-1", message: "Blocked by hook" },
    ]);
    // The boundary's overlay carries the hook's captured input — the whole
    // proposed change, where the stream had only what streamed before the cancel.
    sb.apply(proposal("ed-1", { name: "edit", message: "Write file: notes.md", args: { path: "notes.md", content: "the whole file" } }));
    const row = rowOf(sb, "ed-1");
    expect(row.args).toEqual({ path: "notes.md", content: "the whole file" });
    expect(row.argsPreview).toBe(JSON.stringify({ path: "notes.md", content: "the whole file" }));
    // A proposal with no args leaves the row's own in place.
    sb.apply(proposal("ed-1", { name: "edit", message: "Write file: notes.md" }));
    expect(rowOf(sb, "ed-1").args).toEqual({ path: "notes.md", content: "the whole file" });
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

describe("TranscriptBuilder — a completed TODO call is projected into status.todos (Q-S4-7)", () => {
  const todoCall = (callId: string, name: string, args: Record<string, unknown>): TranscriptEvent[] => [
    { kind: "tool_started", callId, name, input: args, mcpServerSlug: "" },
    { kind: "tool_finished", callId, result: "ok" },
  ];

  it("a full write replaces the list, keyed todo-<i>; the row stays in the transcript", () => {
    const sb = feed(builder(), todoCall("t-1", "write_todos", { todos: [{ content: "a", status: "pending" }, { content: "b", status: "in_progress" }] }));
    expect(Object.keys(sb.currentStatus.todos).sort()).toEqual(["todo-0", "todo-1"]);
    expect(sb.currentStatus.todos["todo-1"].status).toBe(TodoStatus.TODO_IN_PROGRESS);
    expect(rowOf(sb, "t-1").toolKind).toBe(ToolKind.TODO);
  });

  it("a second full write replaces; a write with merge: true keeps what it does not name (Cursor's updateTodos)", () => {
    const sb = feed(builder(), [
      ...todoCall("t-1", "updateTodos", { todos: [{ id: "x", content: "first", status: "pending" }, { id: "y", content: "second", status: "pending" }] }),
      ...todoCall("t-2", "updateTodos", { todos: [{ id: "y", content: "second", status: "completed" }], merge: true }),
    ]);
    expect(Object.keys(sb.currentStatus.todos).sort()).toEqual(["x", "y"]);
    expect(sb.currentStatus.todos["y"].status).toBe(TodoStatus.TODO_COMPLETED);
    sb.apply({ kind: "tool_started", callId: "t-3", name: "updateTodos", input: { todos: [{ id: "z", content: "only", status: "pending" }] }, mcpServerSlug: "" });
    sb.apply({ kind: "tool_finished", callId: "t-3", result: "ok" });
    expect(Object.keys(sb.currentStatus.todos), "no merge flag: a full replace").toEqual(["z"]);
  });

  it("projects nothing before the call completes, and nothing for a sub-agent's write", () => {
    const sb = feed(builder(), [
      { kind: "tool_started", callId: "t-1", name: "write_todos", input: { todos: [{ content: "a", status: "pending" }] }, mcpServerSlug: "" },
    ]);
    expect(Object.keys(sb.currentStatus.todos)).toEqual([]);
    feed(sb, [
      { kind: "sub_agent_started", subAgentId: "task-1", name: "helper", subject: "s", input: "s" },
      ...todoCall("s-1", "write_todos", { todos: [{ content: "sub", status: "pending" }] }).map((e) => ({ ...e, subAgentId: "task-1" })),
    ]);
    expect(Object.keys(sb.currentStatus.todos), "a sub-agent's list is its own").toEqual([]);
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

// ═══════════════════════════════════════════════════════════════════
// The header's rules, in its order (S4 M2 C9)
// ═══════════════════════════════════════════════════════════════════

describe("TranscriptBuilder — a row per callId, reconciled in place, never duplicated", () => {
  it("a re-emitted start for a known row is a no-op on the row's identity; a WAITING row flips to RUNNING and takes the args it lacked", () => {
    const status = create(AgentExecutionStatusSchema, {
      messages: [
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          content: "I'll call the gated tool.",
          toolCalls: [
            create(ToolCallSchema, {
              id: "gated-1",
              name: "dangerous_tool",
              status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
              requiresApproval: true,
              approvalAction: ApprovalAction.APPROVE,
              mcpServerSlug: "my-server",
            }),
          ],
        }),
      ],
    });
    const sb = new TranscriptBuilder("exec-resume", status);
    // The durable checkpoint re-emits the SAME id now that approval is granted.
    feed(sb, [
      { kind: "tool_started", callId: "gated-1", name: "dangerous_tool", input: { target: "prod" }, mcpServerSlug: "my-server" },
      { kind: "tool_finished", callId: "gated-1", result: "tool executed ok" },
      { kind: "message_start", runId: "after" },
      { kind: "text_delta", runId: "after", text: "All done." },
    ]);
    const rows = sb.currentStatus.messages.flatMap((m) => m.toolCalls).filter((tc) => tc.id === "gated-1");
    expect(rows, "exactly one copy").toHaveLength(1);
    expect(rows[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(rows[0].args, "the resumed start fills the args the seed lacked").toEqual({ target: "prod" });
    expect(rows[0].approvalAction, "the decision is kept for audit").toBe(ApprovalAction.APPROVE);
    expect(sb.currentStatus.messages.map((m) => m.content)).toEqual(["I'll call the gated tool.", "All done."]);
    expect(sb.awaitingApproval, "a resumed tool never re-gates").toBe(false);
  });

  it("a re-emitted start advances a seeded INTERRUPTED row to RUNNING — the recovery replay's supersede (Q-M4-8) — and previews the args it fills", () => {
    const status = create(AgentExecutionStatusSchema, {
      messages: [
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          content: "Running the build.",
          toolCalls: [
            create(ToolCallSchema, { id: "sh-1", name: "shell", status: ToolCallStatus.TOOL_CALL_INTERRUPTED, error: "interrupted by the server" }),
            create(ToolCallSchema, { id: "done-1", name: "read", status: ToolCallStatus.TOOL_CALL_COMPLETED, result: "kept" }),
          ],
        }),
      ],
    });
    const sb = new TranscriptBuilder("exec-recover", status);
    feed(sb, [
      { kind: "tool_started", callId: "sh-1", name: "shell", input: { command: "make" }, mcpServerSlug: "" },
      { kind: "tool_started", callId: "done-1", name: "read", input: { path: "/x" }, mcpServerSlug: "" },
    ]);
    const replayed = rowOf(sb, "sh-1");
    expect(replayed.status, "live execution evidence outranks the interruption marker").toBe(ToolCallStatus.TOOL_CALL_RUNNING);
    expect(replayed.args).toEqual({ command: "make" });
    expect(replayed.argsPreview, "the filled args are previewed").toBe(JSON.stringify({ command: "make" }));
    const settled = rowOf(sb, "done-1");
    expect(settled.status, "a settled row keeps its outcome").toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(settled.result).toBe("kept");
    sb.apply({ kind: "tool_finished", callId: "sh-1", result: "built" });
    expect(rowOf(sb, "sh-1").status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });

  it("a duplicate start for a row created this turn adds nothing", () => {
    const sb = feed(builder(), [...proposedCall(), { kind: "tool_started", callId: "call-1", name: "read_file", input: { path: "/x" }, mcpServerSlug: "" }]);
    expect(sb.currentStatus.messages.flatMap((m) => m.toolCalls)).toHaveLength(1);
  });

  it("two parallel rows on one message settle independently, out of order", () => {
    const sb = feed(builder(), [
      { kind: "message_start", runId: "r" },
      { kind: "text_delta", runId: "r", text: "Both files." },
      { kind: "tool_started", callId: "a", name: "read_file", input: { path: "/a" }, mcpServerSlug: "" },
      { kind: "tool_started", callId: "b", name: "read_file", input: { path: "/b" }, mcpServerSlug: "" },
      { kind: "tool_finished", callId: "b", result: "B" },
      { kind: "tool_finished", callId: "a", result: "A" },
    ]);
    const [msg] = sb.currentStatus.messages;
    expect(msg.toolCalls.map((tc) => [tc.id, tc.result])).toEqual([["a", "A"], ["b", "B"]]);
  });

  it("tool_arg_delta accumulates JSON into args once it parses", () => {
    const sb = feed(builder(), [
      { kind: "tool_started", callId: "t", name: "think", input: {}, mcpServerSlug: "" },
      { kind: "tool_arg_delta", callId: "t", argsChunk: '{"thought":' },
      { kind: "tool_arg_delta", callId: "t", argsChunk: '"test"}' },
    ]);
    expect(rowOf(sb, "t").args).toEqual({ thought: "test" });
  });

  it("classifies the row by name and server: a built-in, an MCP tool, the todo tool, the delegation tool", () => {
    const sb = feed(builder(), [
      { kind: "tool_started", callId: "a", name: "read_file", input: { path: "/x" }, mcpServerSlug: "" },
      { kind: "tool_started", callId: "b", name: "create_issue", input: { title: "t" }, mcpServerSlug: "github" },
      { kind: "tool_started", callId: "c", name: "write_todos", input: { todos: [] }, mcpServerSlug: "" },
      { kind: "tool_started", callId: "d", name: "task", input: { description: "x" }, mcpServerSlug: "" },
    ]);
    expect(rowOf(sb, "a").toolKind).toBe(ToolKind.FILE_READ);
    expect(rowOf(sb, "b").toolKind).toBe(ToolKind.MCP);
    expect(rowOf(sb, "b").mcpServerSlug).toBe("github");
    expect(rowOf(sb, "c").toolKind).toBe(ToolKind.TODO);
    expect(rowOf(sb, "d").toolKind).toBe(ToolKind.SUBAGENT);
  });

  it("stamps provenance and the engine version when the translator attributes the call; leaves them unset when it cannot", () => {
    const sb = feed(builder(), [
      { kind: "tool_started", callId: "a", name: "execute", input: { command: "ls" }, mcpServerSlug: "", provenance: "approval_lease" },
      { kind: "tool_started", callId: "b", name: "read_file", input: { path: "/x" }, mcpServerSlug: "" },
    ]);
    expect(rowOf(sb, "a").approvalPolicySource).toBe(ApprovalPolicySource.APPROVAL_LEASE);
    expect(rowOf(sb, "a").policyEngineVersion).toBe("phase-7");
    expect(rowOf(sb, "b").approvalPolicySource).toBe(ApprovalPolicySource.UNSPECIFIED);
    expect(rowOf(sb, "b").policyEngineVersion).toBe("");
  });
});

describe("TranscriptBuilder — the AI-message boundary (Q-S4-5): a row joins the text that proposed it", () => {
  it("a tool row attaches to the scope's current AI message; the next run's text is a new message", () => {
    const sb = feed(builder(), [
      ...proposedCall("c-1"),
      { kind: "tool_finished", callId: "c-1", result: "ok" },
      { kind: "message_start", runId: "run-2" },
      { kind: "text_delta", runId: "run-2", text: "Here is what I found." },
      { kind: "message_finish", runId: "run-2" },
    ]);
    expect(sb.currentStatus.messages.map((m) => [m.content, m.toolCalls.map((tc) => tc.id)])).toEqual([
      ["Let me look.", ["c-1"]],
      ["Here is what I found.", []],
    ]);
  });

  it("a text-less run's tool still attaches to the latest message WITH text — the message boundary is text, not runs", () => {
    const sb = feed(builder(), [
      { kind: "message_start", runId: "run-1" },
      { kind: "text_delta", runId: "run-1", text: "Reading two files." },
      { kind: "message_finish", runId: "run-1" },
      { kind: "tool_started", callId: "a", name: "read_file", input: { path: "/a" }, mcpServerSlug: "" },
      { kind: "tool_finished", callId: "a", result: "A" },
      { kind: "message_start", runId: "run-2" },
      { kind: "message_finish", runId: "run-2" },
      { kind: "tool_started", callId: "b", name: "read_file", input: { path: "/b" }, mcpServerSlug: "" },
    ]);
    expect(sb.currentStatus.messages).toHaveLength(1);
    expect(sb.currentStatus.messages[0].toolCalls.map((tc) => tc.id)).toEqual(["a", "b"]);
  });

  it("a tool start with no AI message in the scope gets an empty one that later rows share", () => {
    const sb = feed(builder(), [
      { kind: "tool_started", callId: "orphan", name: "read", input: {}, mcpServerSlug: "" },
      { kind: "tool_started", callId: "orphan-2", name: "read", input: {}, mcpServerSlug: "" },
    ]);
    expect(sb.currentStatus.messages.map((m) => [m.type, m.content, m.toolCalls.length])).toEqual([[MessageType.MESSAGE_AI, "", 2]]);
    expect(sb.currentStatus.messages[0].isStreaming).toBe(false);
  });

  it("over a seeded transcript the first fresh row joins the seed's last AI message (Q-M2-2)", () => {
    const status = create(AgentExecutionStatusSchema, {
      messages: [
        create(AgentMessageSchema, { type: MessageType.MESSAGE_THINKING, content: "hm" }),
        create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content: "I will run the two commands." }),
      ],
    });
    const sb = new TranscriptBuilder("exec-resume", status);
    sb.apply({ kind: "tool_started", callId: "b", name: "execute", input: { command: "b" }, mcpServerSlug: "" });
    expect(status.messages).toHaveLength(2);
    expect(status.messages[1].toolCalls.map((tc) => tc.id)).toEqual(["b"]);
  });

  it("a thinking row never hosts a tool row", () => {
    const sb = feed(builder(), [
      { kind: "message_start", runId: "run-1" },
      { kind: "reasoning_delta", runId: "run-1", text: "Let me think." },
      { kind: "tool_started", callId: "t", name: "read", input: {}, mcpServerSlug: "" },
    ]);
    expect(sb.currentStatus.messages.map((m) => [m.type, m.toolCalls.length])).toEqual([
      [MessageType.MESSAGE_THINKING, 0],
      [MessageType.MESSAGE_AI, 1],
    ]);
  });
});

describe("TranscriptBuilder — a THINKING row and a text message per runId; a new run closes the previous message", () => {
  it("thinking streams into its own row before the run's text, and the run's finish closes both (Q-M4-6)", () => {
    const sb = feed(builder(), [
      { kind: "message_start", runId: "run-1" },
      { kind: "reasoning_delta", runId: "run-1", text: "Let me analyze " },
      { kind: "reasoning_delta", runId: "run-1", text: "this." },
    ]);
    expect(sb.currentStatus.messages[0].isStreaming, "thinking streams while the run is open").toBe(true);
    feed(sb, [
      { kind: "text_delta", runId: "run-1", text: "Based on " },
      { kind: "text_delta", runId: "run-1", text: "that." },
      { kind: "message_finish", runId: "run-1" },
    ]);
    // A finished run's thinking is finished (until S4 M4 B1 the THINKING row
    // spun until finalize — a live spinner on a block the model had left).
    expect(sb.currentStatus.messages.map((m) => [m.type, m.content, m.isStreaming])).toEqual([
      [MessageType.MESSAGE_THINKING, "Let me analyze this.", false],
      [MessageType.MESSAGE_AI, "Based on that.", false],
    ]);
  });

  it("a run with thinking and no text: its finish closes the THINKING row alone", () => {
    const sb = feed(builder(), [
      { kind: "message_start", runId: "run-1" },
      { kind: "reasoning_delta", runId: "run-1", text: "Hmm." },
      { kind: "message_finish", runId: "run-1" },
    ]);
    expect(sb.currentStatus.messages.map((m) => [m.type, m.isStreaming])).toEqual([[MessageType.MESSAGE_THINKING, false]]);
  });

  it("a second run's thinking is a second THINKING row (Q-S4-6), and its start closes the first run's text", () => {
    const sb = feed(builder(), [
      { kind: "message_start", runId: "run-1" },
      { kind: "reasoning_delta", runId: "run-1", text: "one" },
      { kind: "text_delta", runId: "run-1", text: "First." },
      { kind: "message_start", runId: "run-2" },
      { kind: "reasoning_delta", runId: "run-2", text: "two" },
      { kind: "text_delta", runId: "run-2", text: "Second." },
    ]);
    const m = sb.currentStatus.messages;
    expect(m.map((x) => [x.type, x.content])).toEqual([
      [MessageType.MESSAGE_THINKING, "one"],
      [MessageType.MESSAGE_AI, "First."],
      [MessageType.MESSAGE_THINKING, "two"],
      [MessageType.MESSAGE_AI, "Second."],
    ]);
    expect(m[1].isStreaming, "closed by the next run's start").toBe(false);
    expect(m[3].isStreaming, "still streaming").toBe(true);
  });

  it("two runs' tokens never interleave: each streams into its own message", () => {
    const sb = feed(builder(), [
      { kind: "message_start", runId: "a" },
      { kind: "text_delta", runId: "a", text: "A1 " },
      { kind: "message_start", runId: "b" },
      { kind: "text_delta", runId: "b", text: "B1 " },
      { kind: "text_delta", runId: "a", text: "A2" },
      { kind: "text_delta", runId: "b", text: "B2" },
    ]);
    expect(sb.currentStatus.messages.map((m) => m.content)).toEqual(["A1 A2", "B1 B2"]);
  });
});

describe("TranscriptBuilder — a sub-agent row per subAgentId with a transcript of its own (Q-S4-4)", () => {
  const open: TranscriptEvent = { kind: "sub_agent_started", subAgentId: "task-1", name: "helper", subject: "Look it up.", input: "Look it up." };

  it("opens IN_PROGRESS with the translator's name and subject, and folds scoped events into its own messages", () => {
    const sb = feed(builder(), [
      { kind: "message_start", runId: "root-1" },
      { kind: "text_delta", runId: "root-1", text: "Delegating." },
      open,
      { kind: "tool_started", callId: "task-1", name: "task", input: { subagent_type: "helper" }, mcpServerSlug: "" },
      { kind: "message_start", runId: "sub-1", subAgentId: "task-1" },
      { kind: "text_delta", runId: "sub-1", text: "Working.", subAgentId: "task-1" },
      { kind: "tool_started", callId: "g", name: "grep", input: { pattern: "x" }, mcpServerSlug: "", subAgentId: "task-1" },
      { kind: "tool_finished", callId: "g", result: "found", subAgentId: "task-1" },
    ]);
    const [row] = sb.currentStatus.subAgentExecutions;
    expect([row.id, row.name, row.subject, row.input, row.status]).toEqual(["task-1", "helper", "Look it up.", "Look it up.", SubAgentStatus.SUB_AGENT_IN_PROGRESS]);
    expect(row.startedAt).toContain("T");
    expect(row.messages.map((m) => [m.content, m.toolCalls.map((tc) => [tc.id, tc.result])])).toEqual([["Working.", [["g", "found"]]]]);
    expect(sb.currentStatus.messages.map((m) => [m.content, m.toolCalls.map((tc) => tc.id)]), "the root keeps only the task row").toEqual([["Delegating.", ["task-1"]]]);
  });

  it("closes COMPLETED with the output, its streaming flags cleared; FAILED with the error", () => {
    const sb = feed(builder(), [
      open,
      { kind: "text_delta", runId: "sub-1", text: "still streaming", subAgentId: "task-1" },
      { kind: "sub_agent_finished", subAgentId: "task-1", output: "forty-two" },
      { kind: "sub_agent_started", subAgentId: "task-2", name: "w", subject: "s", input: "s" },
      { kind: "sub_agent_failed", subAgentId: "task-2", error: "boom" },
    ]);
    const [a, b] = sb.currentStatus.subAgentExecutions;
    expect([a.status, a.output, a.completedAt !== "", a.messages[0].isStreaming]).toEqual([SubAgentStatus.SUB_AGENT_COMPLETED, "forty-two", true, false]);
    expect([b.status, b.error, b.completedAt !== ""]).toEqual([SubAgentStatus.SUB_AGENT_FAILED, "boom", true]);
  });

  it("a known id is never re-opened — a seeded row re-announced by a replayed engine is reconciled onto, not duplicated", () => {
    const status = create(AgentExecutionStatusSchema, {});
    status.subAgentExecutions.push(create(SubAgentExecutionSchema, { id: "task-1", name: "helper", status: SubAgentStatus.SUB_AGENT_IN_PROGRESS }));
    const sb = new TranscriptBuilder("exec-resume", status);
    feed(sb, [open, { kind: "text_delta", runId: "sub-1", text: "resumed", subAgentId: "task-1" }]);
    expect(status.subAgentExecutions).toHaveLength(1);
    expect(status.subAgentExecutions[0].messages.map((m) => m.content)).toEqual(["resumed"]);
  });

  it("two sub-agents keep separate transcripts; the status's own array is pushed into, never replaced", () => {
    const status = create(AgentExecutionStatusSchema, {});
    const arrayBefore = status.subAgentExecutions;
    const sb = new TranscriptBuilder("exec", status);
    feed(sb, [
      open,
      { kind: "sub_agent_started", subAgentId: "task-2", name: "other", subject: "s", input: "s" },
      { kind: "text_delta", runId: "s1", text: "one", subAgentId: "task-1" },
      { kind: "text_delta", runId: "s2", text: "two", subAgentId: "task-2" },
    ]);
    expect(status.subAgentExecutions).toBe(arrayBefore);
    expect(status.subAgentExecutions.map((r) => r.messages.map((m) => m.content))).toEqual([["one"], ["two"]]);
  });

  it("an event for an unknown sub-agent is dropped and logged, never folded into the root", () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (msg: unknown) => { errors.push(String(msg)); };
    try {
      const sb = feed(builder(), [{ kind: "text_delta", runId: "r", text: "lost", subAgentId: "nobody" }]);
      expect(sb.currentStatus.messages).toHaveLength(0);
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("unknown sub-agent nobody");
  });

  it("CANCELLED is not the builder's: a stopped turn's rows are left IN_PROGRESS for the shared cancel act", () => {
    const sb = feed(builder(), [open, { kind: "text_delta", runId: "s", text: "mid", subAgentId: "task-1" }]);
    sb.finalize();
    expect(sb.currentStatus.subAgentExecutions[0].status).toBe(SubAgentStatus.SUB_AGENT_IN_PROGRESS);
    expect(sb.currentStatus.subAgentExecutions[0].messages[0].isStreaming, "but its streaming flags are cleared").toBe(false);
  });
});

describe("TranscriptBuilder — finalize() clears every streaming flag in every scope", () => {
  it("messages and rows, root and sub-agents", () => {
    const sb = feed(builder(), [
      { kind: "message_start", runId: "r" },
      { kind: "text_delta", runId: "r", text: "root streaming" },
      { kind: "reasoning_delta", runId: "r2", text: "thinking" },
      { kind: "sub_agent_started", subAgentId: "task-1", name: "h", subject: "s", input: "s" },
      { kind: "text_delta", runId: "s", text: "sub streaming", subAgentId: "task-1" },
      { kind: "tool_started", callId: "o", name: "execute", input: { command: "tail" }, mcpServerSlug: "", subAgentId: "task-1" },
      { kind: "tool_output_delta", callId: "o", delta: "…", subAgentId: "task-1" },
    ]);
    const streaming = () => [
      ...sb.currentStatus.messages.map((m) => m.isStreaming),
      ...sb.currentStatus.subAgentExecutions[0].messages.flatMap((m) => [m.isStreaming, ...m.toolCalls.map((tc) => tc.isStreaming)]),
    ];
    expect(streaming().some(Boolean)).toBe(true);
    sb.finalize();
    expect(streaming().some(Boolean)).toBe(false);
  });
});

describe("TranscriptBuilder — artifacts and write-backs (the ExecutionStatusWriter face, Q-S4-8)", () => {
  const artifact = (sandboxPath: string, contentHash: string) =>
    create(ExecutionArtifactSchema, { sandboxPath, contentHash, storageKey: `k/${contentHash}` });

  it("appends a new artifact and forces the next persist; the same path with the same hash is a no-op", () => {
    const sb = builder();
    sb.addArtifact(artifact("out/a.txt", "h1"));
    expect(sb.currentStatus.artifacts.map((a) => a.contentHash)).toEqual(["h1"]);
    expect(sb.forceNextUpdate).toBe(true);
    sb.clearForceFlag();
    sb.addArtifact(artifact("out/a.txt", "h1"));
    expect(sb.currentStatus.artifacts).toHaveLength(1);
    expect(sb.forceNextUpdate, "nothing changed, nothing to flush").toBe(false);
  });

  it("the same path with a new hash replaces in place", () => {
    const sb = builder();
    sb.addArtifact(artifact("out/a.txt", "h1"));
    sb.addArtifact(artifact("out/a.txt", "h2"));
    expect(sb.currentStatus.artifacts.map((a) => [a.sandboxPath, a.contentHash])).toEqual([["out/a.txt", "h2"]]);
  });

  it("write-backs upsert by workspace entry name", () => {
    const sb = builder();
    sb.addWriteBack(create(WorkspaceWriteBackSchema, { workspaceEntryName: "repo", branchName: "b1" }));
    sb.addWriteBack(create(WorkspaceWriteBackSchema, { workspaceEntryName: "repo", branchName: "b2" }));
    sb.addWriteBack(create(WorkspaceWriteBackSchema, { workspaceEntryName: "docs", branchName: "d" }));
    expect(sb.currentStatus.workspaceWriteBacks.map((w) => [w.workspaceEntryName, w.branchName])).toEqual([["repo", "b2"], ["docs", "d"]]);
    expect(sb.forceNextUpdate).toBe(true);
  });
});

describe("TranscriptBuilder — the dirty flag and the error guard", () => {
  it("a discrete change (a row's start or finish, a sub-agent opening) forces the next persist; tokens do not", () => {
    const sb = feed(builder(), [{ kind: "message_start", runId: "r" }, { kind: "text_delta", runId: "r", text: "tok" }]);
    expect(sb.forceNextUpdate, "text rides the cadence").toBe(false);
    sb.apply({ kind: "tool_started", callId: "t", name: "read", input: {}, mcpServerSlug: "" });
    expect(sb.forceNextUpdate).toBe(true);
    sb.clearForceFlag();
    sb.apply({ kind: "tool_finished", callId: "t", result: "ok" });
    expect(sb.forceNextUpdate).toBe(true);
    sb.clearForceFlag();
    sb.apply({ kind: "sub_agent_started", subAgentId: "s", name: "n", subject: "s", input: "s" });
    expect(sb.forceNextUpdate).toBe(true);
  });

  it("a settled re-emit that changes nothing forces no persist; one that carries a new result or message does (Q-M4-8)", () => {
    const sb = feed(builder(), [...proposedCall(), { kind: "tool_finished", callId: "call-1", result: "" }]);
    sb.clearForceFlag();
    // Cursor's shape: the timing delta completed the row; the stream's own
    // completion, carrying the result, follows and must flush.
    sb.apply({ kind: "tool_finished", callId: "call-1", result: "contents" });
    expect(sb.forceNextUpdate, "the result is new").toBe(true);
    sb.clearForceFlag();
    sb.apply({ kind: "tool_finished", callId: "call-1", result: "contents" });
    expect(sb.forceNextUpdate, "a redundant terminal re-emit is noise").toBe(false);
    sb.apply({ kind: "tool_finished", callId: "call-1", result: "" });
    expect(sb.forceNextUpdate).toBe(false);
    sb.apply({ kind: "tool_error", callId: "call-1", message: "" });
    expect(sb.forceNextUpdate, "an empty error on a settled row changes nothing").toBe(false);
    expect(rowOf(sb, "call-1").status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });

  it("writes neither the phase nor startedAt nor streamingUsage — the turn runtime owns them", () => {
    const sb = feed(builder(), proposedCall());
    expect(sb.currentStatus.phase).toBe(0);
    expect(sb.currentStatus.startedAt).toBe("");
    expect(sb.currentStatus.streamingUsage).toBeUndefined();
  });

  it("a handler that throws is logged with the execution and the event kind, and never escapes apply", () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (msg: unknown) => { errors.push(String(msg)); };
    try {
      const sb = feed(builder(), proposedCall());
      const poisoned = { kind: "tool_finished", callId: "call-1", get result(): string { throw new Error("property access failed"); } } as TranscriptEvent;
      expect(() => sb.apply(poisoned)).not.toThrow();
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("exec-test");
    expect(errors[0]).toContain("kind=tool_finished");
    expect(errors[0]).toContain("property access failed");
  });
});
