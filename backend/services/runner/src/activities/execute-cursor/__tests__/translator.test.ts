/**
 * `CursorTranslator` (`../translator.ts`): what each `@cursor/sdk` event and
 * delta becomes on the canonical union, and — through the real
 * `TranscriptBuilder` (`__test-utils__/fold.ts`) — what that does to the
 * transcript. One arm per rule the translator's header states.
 *
 * Opened at S4 M4 B3 with the arms re-keyed from `message-translator.test.ts`
 * (the accumulator's status map, MCP unpacking, sub-agent name extraction and
 * `conversationSteps` parsing), `delta-enricher.test.ts` (the buffering keyed
 * by call id) and `todo-tracker.test.ts` (which events carry todos); the row
 * rules those files also pinned — the by-id upsert, the monotonic merge, the
 * dirty flag — are the builder's and live in
 * `harness/transcript/__tests__/builder.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import type { InteractionUpdate, SDKMessage } from "@cursor/sdk";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction, MessageType, SubAgentStatus, ToolCallStatus, ToolKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { TranscriptEvent } from "../../../harness/transcript/events.js";
import type { MergedToolPolicy } from "../../../shared/approval-policy.js";
import { CursorFold, foldCursorEvents } from "../__test-utils__/fold.js";
import { sdkEvents } from "../__test-utils__/scripted-agent.js";
import { grantToken } from "../approval-state.js";
import { CursorTranslator, extractSubagentName } from "../translator.js";

const RUN = "run-1";
const ev = sdkEvents("agent-1", RUN);

function translator(seeded = create(AgentExecutionStatusSchema, {})): CursorTranslator {
  return new CursorTranslator({ policies: new Map(), leases: { global: false, categories: new Set() }, seeded: seeded.messages });
}

function kinds(events: readonly TranscriptEvent[]): string[] {
  return events.map((e) => e.kind);
}

// ── The stream channel ────────────────────────────────────────────

describe("CursorTranslator — text and thinking stream into segments; a tool call ends one (Q-S4-3(a))", () => {
  it("the first text of a run opens a segment (message_start) and streams into it; later text only streams", () => {
    const t = translator();
    expect(t.translate(ev.assistant("Hello, "))).toEqual([
      { kind: "message_start", runId: `${RUN}:0` },
      { kind: "text_delta", runId: `${RUN}:0`, text: "Hello, " },
    ]);
    expect(t.translate(ev.assistant("world."))).toEqual([{ kind: "text_delta", runId: `${RUN}:0`, text: "world." }]);
  });

  it("thinking and text of one run share a segment; empty chunks are nothing", () => {
    const t = translator();
    expect(kinds(t.translate(ev.thinking("Let me think.")))).toEqual(["message_start", "reasoning_delta"]);
    expect(kinds(t.translate(ev.assistant("Here.")))).toEqual(["text_delta"]);
    expect(t.translate(ev.assistant(""))).toEqual([]);
    expect(t.translate(ev.thinking(""))).toEqual([]);
    expect(t.translate({ type: "assistant", agent_id: "a", run_id: RUN, message: { role: "assistant", content: [{ type: "tool_use", id: "x", name: "read", input: {} }] } })).toEqual([]);
  });

  it("a tool call finishes the open segment, and the text after it opens the next — Cursor's message boundary", () => {
    const t = translator();
    t.translate(ev.assistant("Reading."));
    const atTool = t.translate(ev.toolCall("c1", "read", "running", { path: "a" }));
    expect(kinds(atTool)).toEqual(["message_finish", "tool_started"]);
    expect(atTool[0]).toEqual({ kind: "message_finish", runId: `${RUN}:0` });
    const after = t.translate(ev.assistant("Done."));
    expect(after[0]).toEqual({ kind: "message_start", runId: `${RUN}:1` });
    // Through the builder: two messages, the row on the first.
    const fold = foldCursorEvents([
      ev.assistant("Reading."),
      ev.toolCall("c1", "read", "running", { path: "a" }),
      ev.toolCall("c1", "read", "completed", { path: "a" }, "text"),
      ev.assistant("Done."),
    ]);
    expect(fold.messages.map((m) => [m.content, m.toolCalls.map((tc) => tc.id)])).toEqual([["Reading.", ["c1"]], ["Done.", []]]);
  });

  it("a tool call with no segment open finishes nothing, and still turns the next text into a new message (tool-only-step)", () => {
    const t = translator();
    expect(kinds(t.translate(ev.toolCall("c1", "read", "running", { path: "a" })))).toEqual(["tool_started"]);
    expect(t.translate(ev.assistant("After."))[0]).toEqual({ kind: "message_start", runId: `${RUN}:1` });
    const fold = foldCursorEvents([ev.toolCall("c1", "read", "running", { path: "a" }), ev.assistant("After.")]);
    expect(fold.messages.map((m) => [m.type, m.content, m.toolCalls.length])).toEqual([
      [MessageType.MESSAGE_AI, "", 1],
      [MessageType.MESSAGE_AI, "After.", 0],
    ]);
  });

  it("thinking after a tool call is a new THINKING row, not a continuation of the run's earlier one (Q-S4-6)", () => {
    const fold = foldCursorEvents([
      ev.thinking("First thought."),
      ev.assistant("Reading."),
      ev.toolCall("c1", "read", "running", { path: "a" }),
      ev.thinking("Second thought."),
      ev.assistant("Done."),
    ]);
    expect(fold.messages.map((m) => [m.type, m.content])).toEqual([
      [MessageType.MESSAGE_THINKING, "First thought."],
      [MessageType.MESSAGE_AI, "Reading."],
      [MessageType.MESSAGE_THINKING, "Second thought."],
      [MessageType.MESSAGE_AI, "Done."],
    ]);
  });

  it("runs are independent: a recovery retry's send has its own segments", () => {
    const t = translator();
    const other = sdkEvents("agent-1", "run-2");
    expect(t.translate(ev.assistant("a"))[0]).toEqual({ kind: "message_start", runId: "run-1:0" });
    expect(t.translate(other.assistant("b"))[0]).toEqual({ kind: "message_start", runId: "run-2:0" });
  });
});

describe("CursorTranslator — a tool_call event is the row's start and, when terminal, its outcome", () => {
  it("running → tool_started with the stream's name, its args as input, no server, no gate for a read-only built-in", () => {
    const [started] = translator().translate(ev.toolCall("c1", "read", "running", { path: "a.md" }));
    // No provenance: an ungated built-in is governed by no layer (the `tool-call` golden's row carries none).
    expect(started).toEqual({ kind: "tool_started", callId: "c1", name: "read", input: { path: "a.md" }, mcpServerSlug: "" });
  });

  it("a gated built-in carries the policy's word: the category's message over the args (Q-M4-10)", () => {
    const [started] = translator().translate(ev.toolCall("c1", "shell", "running", { command: "npm test" }));
    expect(started).toMatchObject({ kind: "tool_started", gate: { message: "Run command: npm test" }, provenance: "builtin_category" });
    const fold = foldCursorEvents([ev.toolCall("c1", "shell", "running", { command: "npm test" })]);
    expect(fold.row("c1").requiresApproval).toBe(true);
    expect(fold.row("c1").approvalMessage).toBe("Run command: npm test");
    expect(fold.row("c1").status, "gated but RUNNING: the boundary parks it, never the stream").toBe(ToolCallStatus.TOOL_CALL_RUNNING);
  });

  it("a leased category is still the policy's word (lease-blind, as the accumulator was; the harness difference is S5's — F-M4-14)", () => {
    const t = new CursorTranslator({ policies: new Map(), leases: { global: false, categories: new Set(["shell"]) }, seeded: [] });
    const [started] = t.translate(ev.toolCall("c1", "shell", "running", { command: "ls" }));
    expect(started).toMatchObject({ gate: { message: "Run command: ls" }, provenance: "approval_lease" });
  });

  it("completed → tool_finished with the result rendered to the row's string; a string as-is, an envelope stringified", () => {
    const t = translator();
    t.translate(ev.toolCall("c1", "read", "running", {}));
    expect(t.translate(ev.toolCall("c1", "read", "completed", {}, "plain"))).toEqual([
      { kind: "tool_started", callId: "c1", name: "read", input: {}, mcpServerSlug: "" },
      { kind: "tool_finished", callId: "c1", result: "plain" },
    ]);
    const envelope = { status: "success", value: { exitCode: 0, stdout: "ok\n", stderr: "" } };
    const [, finished] = t.translate(ev.toolCall("c2", "shell", "completed", { command: "make" }, envelope));
    expect(finished).toEqual({ kind: "tool_finished", callId: "c2", result: JSON.stringify(envelope) });
  });

  it("error → tool_error with the failure text (or the generic text for a structured failure); the row carries it as error alone (Q-M4-3)", () => {
    const t = translator();
    expect(t.translate(ev.toolCall("c1", "read", "error", {}, "ENOENT")).at(-1)).toEqual({ kind: "tool_error", callId: "c1", message: "ENOENT" });
    expect(t.translate(ev.toolCall("c2", "read", "error", {}, { code: 1 })).at(-1)).toEqual({ kind: "tool_error", callId: "c2", message: "Tool call failed" });
    const fold = foldCursorEvents([ev.toolCall("c1", "read", "running", { path: "x" }), ev.toolCall("c1", "read", "error", { path: "x" }, "ENOENT")]);
    expect(fold.row("c1").status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(fold.row("c1").error).toBe("ENOENT");
    expect(fold.row("c1").result).toBe("");
  });

  it("a completion with no running before it is a start and a finish in one — startedAt equals completedAt (Q-S4-17)", () => {
    const fold = foldCursorEvents([ev.assistant("Go."), ev.toolCall("c1", "read", "completed", { path: "x" }, "done")]);
    const row = fold.row("c1");
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(row.startedAt).toBe(row.completedAt);
    expect(fold.messages[0].toolCalls.map((tc) => tc.id)).toEqual(["c1"]);
  });

  it("a completion after later text lands on the row where it started, never on the new message (cross-message completion)", () => {
    const fold = foldCursorEvents([
      ev.assistant("Running two things."),
      ev.toolCall("a", "read", "running", { path: "a" }),
      ev.toolCall("b", "shell", "running", { command: "ls" }),
      ev.assistant("Meanwhile…"),
      ev.toolCall("b", "shell", "completed", { command: "ls" }, "files"),
      ev.toolCall("a", "read", "completed", { path: "a" }, "text"),
      ev.assistant("Both done."),
    ]);
    expect(fold.messages.map((m) => [m.content, m.toolCalls.map((tc) => [tc.id, tc.status, tc.result])])).toEqual([
      ["Running two things.", [["a", ToolCallStatus.TOOL_CALL_COMPLETED, "text"], ["b", ToolCallStatus.TOOL_CALL_COMPLETED, "files"]]],
      ["Meanwhile…", []],
      ["Both done.", []],
    ]);
  });

  it("a string args payload is parsed when it is JSON, and is nothing when it is not (F-M4-19)", () => {
    const t = translator();
    expect(t.translate(ev.toolCall("c1", "read", "running", '{"path":"a"}'))[0]).toMatchObject({ input: { path: "a" } });
    expect(t.translate(ev.toolCall("c2", "read", "running", '{"path":"tru'))[0]).toMatchObject({ input: {} });
    expect(t.translate(ev.toolCall("c3", "read", "running", undefined))[0]).toMatchObject({ input: {} });
  });

  it("a todo write is an ordinary tool call the builder keys on ToolKind.TODO and projects at completion (Q-S4-7)", () => {
    const TODOS = { todos: [{ content: "Step 1", status: "pending" }] };
    const fold = foldCursorEvents([ev.assistant("Planning."), ev.toolCall("t1", "updateTodos", "running", TODOS)]);
    expect(fold.row("t1").toolKind).toBe(ToolKind.TODO);
    expect(fold.row("t1").requiresApproval).toBe(false);
    expect(fold.status.todos, "a running write projects nothing: its args may be incomplete").toEqual({});
    fold.event(ev.toolCall("t1", "updateTodos", "completed", TODOS, "ok"));
    expect(Object.keys(fold.status.todos)).toEqual(["todo-0"]);
    // The legacy name projects too; a write that errors, and a tool that is not a todo tool, never do.
    fold.event(ev.toolCall("t2", "TodoWrite", "completed", { todos: [{ id: "x", content: "Legacy", status: "completed" }], merge: true }, "ok"));
    expect(Object.keys(fold.status.todos).sort()).toEqual(["todo-0", "x"]);
    fold.event(ev.toolCall("t3", "updateTodos", "error", { todos: [] }, "boom"));
    fold.event(ev.toolCall("t4", "write_notes", "completed", { todos: [] }, "ok"));
    expect(Object.keys(fold.status.todos).sort()).toEqual(["todo-0", "x"]);
    // A JSON-string args payload (the SDK's other shape) projects like an object.
    fold.event(ev.toolCall("t5", "updateTodos", "completed", JSON.stringify({ todos: [{ content: "From a string", status: "pending" }] }), "ok"));
    expect(Object.keys(fold.status.todos)).toEqual(["todo-0"]);
    expect(fold.status.todos["todo-0"].content).toBe("From a string");
  });

  it("the task SDK event is a system_note; an empty one, the system/status/user/request/usage events, are nothing", () => {
    const t = translator();
    expect(t.translate(ev.task("Scanning the workspace."))).toEqual([{ kind: "system_note", text: "Scanning the workspace." }]);
    expect(t.translate(ev.task(""))).toEqual([]);
    expect(t.translate(ev.init())).toEqual([]);
    expect(t.translate(ev.status("RUNNING"))).toEqual([]);
    expect(t.translate({ type: "user", agent_id: "a", run_id: RUN, message: { role: "user", content: [{ type: "text", text: "hi" }] } })).toEqual([]);
    expect(t.translate({ type: "request", agent_id: "a", run_id: RUN, request_id: "r" })).toEqual([]);
    expect(t.translate({ type: "usage", agent_id: "a", run_id: RUN, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 2 } })).toEqual([]);
  });
});

describe("CursorTranslator — the MCP envelope is unwrapped to the inner tool", () => {
  const MCP_ARGS = { providerIdentifier: "planton", toolName: "search_services", args: { query: "db" } };
  const policies = new Map<string, MergedToolPolicy>([
    ["planton/search_services", { toolName: "search_services", mcpServerSlug: "planton", requiresApproval: true, approvalMessage: "Search {{args.query}} on {{tool_name}}", source: "pinned_override" }],
  ]);

  it("name is the inner tool, the server its provider, the input the inner args; auto-approved without a policy (classifier_default)", () => {
    const [started] = translator().translate(ev.toolCall("m1", "mcp", "running", MCP_ARGS));
    expect(started).toEqual({ kind: "tool_started", callId: "m1", name: "search_services", input: { query: "db" }, mcpServerSlug: "planton", provenance: "classifier_default" });
  });

  it("a policy that requires approval is the gate, its message resolved over the inner args", () => {
    const t = new CursorTranslator({ policies, leases: { global: false, categories: new Set() }, seeded: [] });
    const [started] = t.translate(ev.toolCall("m1", "mcp", "running", MCP_ARGS));
    expect(started).toMatchObject({ gate: { message: "Search db on search_services" }, provenance: "pinned_override" });
    const fold = new CursorFold({ policies }).events(ev.toolCall("m1", "mcp", "running", MCP_ARGS));
    expect(fold.row("m1").toolKind).toBe(ToolKind.MCP);
    expect(fold.row("m1").argsPreview, "the row's own args, never the envelope (Q-S4-16)").toBe(JSON.stringify({ query: "db" }));
  });

  it("an mcp event with no toolName is an ordinary tool named mcp, and is never gated by a built-in category", () => {
    const [started] = translator().translate(ev.toolCall("m1", "mcp", "running", { providerIdentifier: "x" }));
    expect(started).toMatchObject({ name: "mcp", mcpServerSlug: "", input: { providerIdentifier: "x" } });
    expect((started as { gate?: unknown }).gate).toBeUndefined();
  });
});

// ── Sub-agents ────────────────────────────────────────────────────

describe("CursorTranslator — a task tool call is a sub-agent (Q-S4-4), its transcript delivered at completion", () => {
  const TASK_ARGS = { subagentType: "helper", description: "Read README.md", prompt: "Read README.md and report." };
  const STEPS = {
    status: "success",
    value: {
      conversationSteps: [
        { assistantMessage: { text: "Looking." } },
        { toolCall: { toolCallId: "sub-read-1", readToolCall: { args: { path: "README.md" }, result: { success: { content: "# Hi" } } } } },
        { assistantMessage: { text: "It says hi." } },
      ],
    },
  };

  it("running → sub_agent_started (name, subject, input from the args) BEFORE the row's tool_started; a duplicate running re-announces nothing", () => {
    const t = translator();
    expect(t.translate(ev.toolCall("task-1", "task", "running", TASK_ARGS))).toEqual([
      { kind: "sub_agent_started", subAgentId: "task-1", name: "helper", subject: "Read README.md", input: "Read README.md and report." },
      { kind: "tool_started", callId: "task-1", name: "task", input: TASK_ARGS, mcpServerSlug: "" },
    ]);
    expect(kinds(t.translate(ev.toolCall("task-1", "task", "running", TASK_ARGS)))).toEqual(["tool_started"]);
  });

  it("completed → the row's finish, the child's scoped events, then sub_agent_finished with the same output string", () => {
    const t = translator();
    t.translate(ev.toolCall("task-1", "task", "running", TASK_ARGS));
    const out = t.translate(ev.toolCall("task-1", "task", "completed", TASK_ARGS, STEPS));
    expect(kinds(out)).toEqual([
      "tool_started", "tool_finished",
      "message_start", "text_delta", "message_finish",
      "tool_started", "tool_finished",
      "message_start", "text_delta", "message_finish",
      "sub_agent_finished",
    ]);
    expect(out.slice(2, -1).every((e) => "subAgentId" in e && e.subAgentId === "task-1")).toBe(true);
    expect(out.at(-1)).toEqual({ kind: "sub_agent_finished", subAgentId: "task-1", output: JSON.stringify(STEPS) });
    expect(out[1]).toEqual({ kind: "tool_finished", callId: "task-1", result: JSON.stringify(STEPS) });
  });

  it("through the builder: the row is SUBAGENT kind, the sub-agent COMPLETED, and the child's tool joins the assistant step that proposed it (Q-S4-5)", () => {
    const fold = foldCursorEvents([
      ev.assistant("Delegating."),
      ev.toolCall("task-1", "task", "running", TASK_ARGS),
      ev.toolCall("task-1", "task", "completed", TASK_ARGS, STEPS),
    ]).finalize();
    expect(fold.row("task-1").toolKind).toBe(ToolKind.SUBAGENT);
    const sub = fold.status.subAgentExecutions[0];
    expect(sub.id).toBe("task-1");
    expect(sub.status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);
    expect(sub.output).toBe(JSON.stringify(STEPS));
    expect(sub.messages.map((m) => [m.type, m.content, m.toolCalls.map((tc) => tc.id), m.isStreaming])).toEqual([
      [MessageType.MESSAGE_AI, "Looking.", ["sub-read-1"], false],
      [MessageType.MESSAGE_AI, "It says hi.", [], false],
    ]);
    const read = sub.messages[0].toolCalls[0];
    expect(read.name).toBe("read");
    expect(read.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(read.result).toBe(JSON.stringify({ content: "# Hi" }));
    expect(read.argsPreview).toBe(JSON.stringify({ path: "README.md" }));
  });

  it("a completion with no running before it still opens the sub-agent and delivers its transcript (F-M4-9)", () => {
    const fold = foldCursorEvents([ev.toolCall("task-1", "task", "completed", TASK_ARGS, STEPS)]);
    expect(fold.status.subAgentExecutions[0].status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);
    expect(fold.status.subAgentExecutions[0].messages).toHaveLength(2);
  });

  it("error → the row's error then sub_agent_failed with the same text", () => {
    const t = translator();
    t.translate(ev.toolCall("task-1", "task", "running", TASK_ARGS));
    expect(t.translate(ev.toolCall("task-1", "task", "error", TASK_ARGS, "child crashed")).slice(1)).toEqual([
      { kind: "tool_error", callId: "task-1", message: "child crashed" },
      { kind: "sub_agent_failed", subAgentId: "task-1", error: "child crashed" },
    ]);
  });

  it("the child's steps: legacy type-envelope form, direct-keyed tool steps, failure oneofs, thinking, and skipped malformed or empty steps", () => {
    const fold = foldCursorEvents([
      ev.toolCall("task-1", "task", "completed", TASK_ARGS, {
        status: "success",
        value: {
          conversationSteps: [
            { type: "thinkingMessage", message: { text: "Let me look." } },
            { type: "assistantMessage", message: { text: "" } },
            { toolCall: { toolCallId: "glob-1", globToolCall: { args: { pattern: "*.md" }, result: { success: { files: ["README.md"] } } } } },
            { toolCall: { toolCallId: "sh-1", shellToolCall: { args: { command: "rm -rf /" }, result: { permissionDenied: { error: "blocked by approval gate" } } } } },
            { toolCall: { toolCallId: "sh-2", shellToolCall: { args: {}, result: { rejected: { reason: "user rejected" } } } } },
            { toolCall: { toolCallId: "malformed" } },
            { toolCall: { readToolCall: { args: { path: "x" } } } },
            { unknownStep: {} },
            { type: "assistantMessage", message: { text: "Found it." } },
          ],
        },
      }),
    ]).finalize();
    const sub = fold.status.subAgentExecutions[0];
    expect(sub.messages.map((m) => [m.type, m.content, m.toolCalls.map((tc) => [tc.id, tc.status, tc.error])])).toEqual([
      [MessageType.MESSAGE_THINKING, "Let me look.", []],
      // Four tool steps with no assistant step before them share one empty message (A5's rule).
      [MessageType.MESSAGE_AI, "", [
        ["glob-1", ToolCallStatus.TOOL_CALL_COMPLETED, ""],
        ["sh-1", ToolCallStatus.TOOL_CALL_FAILED, JSON.stringify({ error: "blocked by approval gate" })],
        ["sh-2", ToolCallStatus.TOOL_CALL_FAILED, JSON.stringify({ reason: "user rejected" })],
        ["sub-read-6", ToolCallStatus.TOOL_CALL_COMPLETED, ""],
      ]],
      [MessageType.MESSAGE_AI, "Found it.", []],
    ]);
    expect(sub.messages[1].toolCalls[0].toolKind).toBe(ToolKind.SEARCH);
    expect(sub.messages[1].toolCalls[0].result).toBe(JSON.stringify({ files: ["README.md"] }));
  });

  it("a result without conversationSteps, or not an object, yields an empty child transcript", () => {
    for (const result of [undefined, "just text", { status: "success", value: {} }, { status: "success", value: { conversationSteps: [] } }]) {
      const fold = foldCursorEvents([ev.toolCall("task-1", "task", "completed", TASK_ARGS, result)]);
      expect(fold.status.subAgentExecutions[0].messages).toHaveLength(0);
    }
  });

  it("extractSubagentName: string, object with name, object with kind, unspecified kind, description fallback, generic", () => {
    expect(extractSubagentName({ subagentType: "explorer" })).toBe("explorer");
    expect(extractSubagentName({ subagentType: { kind: "generalPurpose", name: "researcher" } })).toBe("researcher");
    expect(extractSubagentName({ subagentType: { kind: "generalPurpose" } })).toBe("generalPurpose");
    expect(extractSubagentName({ subagentType: { kind: "unspecified" }, description: "Find the config" })).toBe("Find the config");
    expect(extractSubagentName({ description: "Find the config" })).toBe("Find the config");
    expect(extractSubagentName({})).toBe("task");
    expect(extractSubagentName(null)).toBe("task");
  });
});

// ── The resumed agent's re-issued call ────────────────────────────

describe("CursorTranslator — a resumed agent's re-run lands on its seeded WAITING row by identity (Q-S4-9)", () => {
  function seededStatus(rows: Array<{ id: string; action?: ApprovalAction; path?: string }>) {
    return create(AgentExecutionStatusSchema, {
      messages: [
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          content: "I'll edit the notes.",
          toolCalls: rows.map((r) => create(ToolCallSchema, {
            id: r.id,
            name: "edit",
            status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requiresApproval: true,
            approvalAction: r.action ?? ApprovalAction.APPROVE,
            args: { path: r.path ?? "notes.md", content: "A\n" },
            argsPreview: JSON.stringify({ path: r.path ?? "notes.md", content: "A\n" }),
          })),
        }),
      ],
    });
  }

  it("the fresh call id's start is emitted with the SEEDED id, and its later events follow the alias", () => {
    const status = seededStatus([{ id: "seeded-1" }]);
    const fold = new CursorFold({ status }).events(
      ev.toolCall("fresh-1", "edit", "running", { path: "notes.md", content: "A\n" }),
      ev.toolCall("fresh-1", "edit", "completed", { path: "notes.md", content: "A\n" }, "ok"),
    );
    expect(fold.rows().map((tc) => tc.id), "one row, the seeded one").toEqual(["seeded-1"]);
    expect(fold.row("seeded-1").status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(fold.row("seeded-1").result).toBe("ok");
    expect(fold.row("seeded-1").approvalAction, "the decision is kept for audit").toBe(ApprovalAction.APPROVE);
  });

  it("a declined seeded row is a closed gate: a same-identity call is a NEW row (S2 M4 F9)", () => {
    const status = seededStatus([{ id: "declined-1", action: ApprovalAction.REJECT }]);
    const fold = new CursorFold({ status }).events(ev.toolCall("fresh-1", "edit", "running", { path: "notes.md", content: "A\n" }));
    expect(fold.rows().map((tc) => tc.id)).toEqual(["declined-1", "fresh-1"]);
    expect(fold.row("declined-1").status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });

  it("two co-pending seeded rows of one identity are consumed in transcript order; a third call is fresh", () => {
    const status = seededStatus([{ id: "seeded-1" }, { id: "seeded-2" }]);
    const fold = new CursorFold({ status }).events(
      ev.toolCall("fresh-1", "edit", "running", { path: "notes.md", content: "A\n" }),
      ev.toolCall("fresh-2", "edit", "running", { path: "notes.md", content: "A\n" }),
      ev.toolCall("fresh-3", "edit", "running", { path: "notes.md", content: "A\n" }),
    );
    expect(fold.rows().map((tc) => [tc.id, tc.status])).toEqual([
      ["seeded-1", ToolCallStatus.TOOL_CALL_RUNNING],
      ["seeded-2", ToolCallStatus.TOOL_CALL_RUNNING],
      ["fresh-3", ToolCallStatus.TOOL_CALL_RUNNING],
    ]);
  });

  it("a different content for the same file is a different identity and never rides the seeded row", () => {
    const status = seededStatus([{ id: "seeded-1" }]);
    const fold = new CursorFold({ status }).events(ev.toolCall("fresh-1", "edit", "running", { path: "notes.md", content: "B\n" }));
    expect(fold.rows().map((tc) => tc.id)).toEqual(["seeded-1", "fresh-1"]);
  });

  it("the identity is the hook's token space: a seeded shell row matches a re-run of the same command", () => {
    const status = create(AgentExecutionStatusSchema, {
      messages: [create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        content: "Building.",
        toolCalls: [create(ToolCallSchema, { id: "sh-seeded", name: "shell", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, args: { command: "make" }, approvalAction: ApprovalAction.APPROVE })],
      })],
    });
    expect(grantToken("shell", "make")).toBeTruthy();
    const fold = new CursorFold({ status }).events(ev.toolCall("sh-new", "shell", "running", { command: "make" }));
    expect(fold.rows().map((tc) => tc.id)).toEqual(["sh-seeded"]);
  });
});

// ── The delta channel ─────────────────────────────────────────────

describe("CursorTranslator — the delta channel is queued, held for unannounced calls, and stamps its own instant", () => {
  const MODEL_CALL = "mc-1";
  const started = (callId: string): InteractionUpdate => ({ type: "tool-call-started", callId, modelCallId: MODEL_CALL, toolCall: { type: "shell", args: { command: "make" } } });
  const output = (callId: string | undefined, data: string): InteractionUpdate => ({ type: "shell-output-delta", event: callId ? { callId, type: "stdout", data } : { type: "stdout", data } });
  const completed = (callId: string): InteractionUpdate => ({
    type: "tool-call-completed", callId, modelCallId: MODEL_CALL,
    toolCall: { type: "shell", args: { command: "make" }, result: { status: "success", value: { exitCode: 0, signal: "", stdout: "ok", stderr: "", executionTime: 5 } } },
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("observeDelta applies nothing; drainDeltas returns what was queued, in order, and empties", () => {
    const t = translator();
    t.translate(ev.toolCall("c1", "shell", "running", { command: "make" }));
    t.observeDelta(output("c1", "a"));
    t.observeDelta(output("c1", "b"));
    expect(t.drainDeltas()).toEqual([
      { kind: "tool_output_delta", callId: "c1", delta: "a" },
      { kind: "tool_output_delta", callId: "c1", delta: "b" },
    ]);
    expect(t.drainDeltas()).toEqual([]);
  });

  it("an output delta before the stream announces its call is held and replayed after the tool_started (F-M4-7)", () => {
    const t = translator();
    t.observeDelta(output("c1", "early "));
    expect(t.drainDeltas(), "nothing to apply: no row yet").toEqual([]);
    t.translate(ev.toolCall("c1", "shell", "running", { command: "make" }));
    expect(t.drainDeltas()).toEqual([{ kind: "tool_output_delta", callId: "c1", delta: "early " }]);
    // Through the builder, in the loop's order: nothing is lost.
    const fold = new CursorFold()
      .delta(output("c1", "early "))
      .event(ev.toolCall("c1", "shell", "running", { command: "make" }))
      .delta(output("c1", "late"))
      .event(ev.assistant("Done."));
    expect(fold.row("c1").result).toBe("early late");
  });

  it("an output delta naming no call belongs to the last shell the delta channel started", () => {
    const t = translator();
    t.translate(ev.toolCall("c1", "shell", "running", { command: "make" }));
    t.observeDelta(started("c1"));
    t.observeDelta(output(undefined, "out"));
    expect(t.drainDeltas()).toEqual([{ kind: "tool_output_delta", callId: "c1", delta: "out" }]);
    // No shell started yet and no call named: nowhere to put it.
    const fresh = translator();
    fresh.observeDelta(output(undefined, "orphan"));
    expect(fresh.drainDeltas()).toEqual([]);
  });

  it("the completion delta is a tool_finished with no result and the instant it was OBSERVED, not applied (Q-M4-14)", () => {
    const t = translator();
    t.translate(ev.toolCall("c1", "shell", "running", { command: "make" }));
    vi.setSystemTime(new Date("2026-01-01T00:00:07.000Z"));
    t.observeDelta(completed("c1"));
    vi.setSystemTime(new Date("2026-01-01T00:00:20.000Z"));
    expect(t.drainDeltas()).toEqual([{ kind: "tool_finished", callId: "c1", result: "", observedAt: "2026-01-01T00:00:07.000Z" }]);
    // Through the builder: completedAt is the delta's instant; the stream's later completion supplies the result and moves no stamp.
    const fold = new CursorFold().event(ev.toolCall("c2", "shell", "running", { command: "make" }));
    vi.setSystemTime(new Date("2026-01-01T00:00:07.000Z"));
    fold.delta(completed("c2"));
    vi.setSystemTime(new Date("2026-01-01T00:00:20.000Z"));
    fold.event(ev.thinking("Hmm."));
    expect(fold.row("c2").status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(fold.row("c2").completedAt).toBe("2026-01-01T00:00:07.000Z");
    fold.event(ev.toolCall("c2", "shell", "completed", { command: "make" }, "ok"));
    expect(fold.row("c2").result).toBe("ok");
    expect(fold.row("c2").completedAt).toBe("2026-01-01T00:00:07.000Z");
  });

  it("a completion delta whose result status is error is a tool_error at the observed instant; the stream's text follows (Q-M4-5)", () => {
    const failedDelta: InteractionUpdate = {
      type: "tool-call-completed", callId: "c1", modelCallId: MODEL_CALL,
      toolCall: { type: "shell", args: { command: "make" }, result: { status: "error", error: "command not found" } },
    };
    const t = translator();
    t.translate(ev.toolCall("c1", "shell", "running", { command: "make" }));
    vi.setSystemTime(new Date("2026-01-01T00:00:07.000Z"));
    t.observeDelta(failedDelta);
    expect(t.drainDeltas()).toEqual([{ kind: "tool_error", callId: "c1", message: "", observedAt: "2026-01-01T00:00:07.000Z" }]);
    // Through the builder: FAILED from the delta's instant; a completion delta
    // whose result is absent is a success.
    const fold = new CursorFold().event(ev.toolCall("c2", "shell", "running", { command: "make" }));
    vi.setSystemTime(new Date("2026-01-01T00:00:07.000Z"));
    fold.delta({ ...failedDelta, callId: "c2" });
    vi.setSystemTime(new Date("2026-01-01T00:00:20.000Z"));
    fold.event(ev.thinking("It failed."));
    expect(fold.row("c2").status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(fold.row("c2").completedAt).toBe("2026-01-01T00:00:07.000Z");
    expect(fold.row("c2").approvalRequestedAt, "a gated shell").toBe("2026-01-01T00:00:07.000Z");
    fold.event(ev.toolCall("c2", "shell", "error", { command: "make" }, "sh: make: command not found"));
    expect(fold.row("c2").error).toBe("sh: make: command not found");
    expect(fold.row("c2").status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    const noResult = new CursorFold().event(ev.toolCall("c3", "read", "running", { path: "x" }));
    noResult.delta({ type: "tool-call-completed", callId: "c3", modelCallId: MODEL_CALL, toolCall: { type: "read", args: { path: "x" } } }).drain();
    expect(noResult.row("c3").status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });

  it("a held completion for a resumed agent's re-run is re-targeted at the seeded row it aliases to", () => {
    const status = create(AgentExecutionStatusSchema, {
      messages: [create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI, content: "Building.",
        toolCalls: [create(ToolCallSchema, { id: "sh-seeded", name: "shell", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, args: { command: "make" }, approvalAction: ApprovalAction.APPROVE })],
      })],
    });
    const fold = new CursorFold({ status })
      .delta(output("sh-new", "building…"))
      .event(ev.toolCall("sh-new", "shell", "running", { command: "make" }));
    expect(fold.rows().map((tc) => tc.id)).toEqual(["sh-seeded"]);
    expect(fold.row("sh-seeded").result).toBe("building…");
  });

  it("turn-ended, thinking-completed, text and thinking deltas carry no transcript fact", () => {
    const t = translator();
    t.translate(ev.toolCall("c1", "shell", "running", { command: "make" }));
    t.observeDelta({ type: "turn-ended", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    t.observeDelta({ type: "thinking-completed", thinkingDurationMs: 12 });
    t.observeDelta({ type: "text-delta", text: "tok" });
    t.observeDelta({ type: "thinking-delta", text: "tok" });
    expect(t.drainDeltas()).toEqual([]);
  });

  it("shell output text is read from data, output or text; anything else is nothing", () => {
    const t = translator();
    t.translate(ev.toolCall("c1", "shell", "running", { command: "make" }));
    t.observeDelta({ type: "shell-output-delta", event: { callId: "c1", output: "via output" } });
    t.observeDelta({ type: "shell-output-delta", event: { call_id: "c1", text: "via text" } });
    t.observeDelta({ type: "shell-output-delta", event: { id: "c1", data: "via data" } });
    t.observeDelta({ type: "shell-output-delta", event: { callId: "c1", bytes: 12 } });
    expect(t.drainDeltas().map((e) => (e as { delta: string }).delta)).toEqual(["via output", "via text", "via data"]);
  });
});
