/**
 * The native translator's integration arms: raw LangGraph v3 protocol events
 * through `DeepAgentTranslator` and then `TranscriptBuilder`, end to end —
 * the exact path `turn-stream.ts`'s loop takes — asserting the transcript
 * that comes out. Every sequence here is the wire's real shape (the fixtures
 * default to LangGraph's namespaces, F-M2-16), so these arms prove that the
 * translator's reading of the engine and the builder's rules compose into
 * the goldens' shapes.
 *
 * What is NOT here (Q-M2-6): the builder's own rules, driven with
 * `TranscriptEvent`s directly, live in
 * `harness/transcript/__tests__/builder.test.ts`; the translator's own
 * reading of the wire in `translator.test.ts`. This file began as the
 * builder's unit suite when the builder was the native adapter's
 * (`v3-status-builder.test.ts`, S3 M2b) and became what it always was in
 * truth at S4 M2 C9.
 *
 * In the adapter's folder because the fixtures and the translator are
 * `activities/` modules the direction fence keeps out of `harness/`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction, ApprovalPolicySource, ExecutionPhase, MessageType, ToolCallStatus, ToolKind, TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { WorkspaceWriteBackSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import { TranscriptBuilder } from "../../../harness/transcript/builder.js";
import { DeepAgentTranslator } from "../translator.js";
import type { DeepAgentGateState } from "../turn-setup.js";
import type { MergedToolPolicy } from "../../../shared/approval-policy.js";
import {
  resetSeq,
  makeMessageStart,
  makeMessageFinish,
  makeTextDelta,
  makeReasoningDelta,
  makeToolStarted,
  makeToolFinished,
  makeToolError,
  makeToolCallArgDelta,
  makeToolOutputDelta,
} from "../__test-utils__/v3-event-fixtures.js";
import type { V3ProtocolEvent } from "../v3-event-recorder.js";

/**
 * A builder over an empty status. Usage never reaches the builder (S4 M2 C1):
 * the loop reads it off the wire through `usageOf` and prices it into the
 * sink — `turn-stream.test.ts` pins that; `translator.test.ts` pins what
 * `usageOf` reads. The `usage:` fields the sequences below still
 * carry are the wire's real shape and are ignored by everything here.
 */
function makeBuilder(): TranscriptBuilder {
  return new TranscriptBuilder("exec-test", create(AgentExecutionStatusSchema, {}));
}

/**
 * Feed raw v3 events through the translator (over the given gate posture, or
 * none) into the builder — the production path, `turn-stream.ts`'s loop.
 */
function feedAll(sb: TranscriptBuilder, events: V3ProtocolEvent[], gate: DeepAgentGateState | null = null): void {
  const translator = new DeepAgentTranslator(gate);
  for (const raw of events) {
    for (const e of translator.translate(raw)) {
      sb.apply(e);
    }
  }
}

beforeEach(() => resetSeq());

describe("the native translator through the builder", () => {

  // ── Initialization ───────────────────────────────────────────────

  describe("initialization", () => {
    it("writes neither phase nor startedAt (the turn runtime owns both; S3 M2a, Q-M2a-7)", () => {
      const sb = makeBuilder();
      expect(sb.status.phase).toBe(ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED);
      expect(sb.status.startedAt).toBe("");
      expect(sb.awaitingApproval).toBe(false);
    });

    it("starts with dirty = false", () => {
      const sb = makeBuilder();
      expect(sb.dirty).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GOLDEN SEQUENCES
  //
  // Same proto assertions as v2 StatusBuilder golden tests, but input
  // is v3 ProtocolEvent sequences fed through the translator.
  // ═══════════════════════════════════════════════════════════════════

  describe("golden sequences", () => {

    describe("plain chat — 2-turn text-only conversation", () => {
      it("produces 2 AI messages, one per run, each closed by its finish", () => {
        const sb = makeBuilder();
        feedAll(sb, [
          makeMessageStart("run-1"),
          makeTextDelta("run-1", "Hello, "),
          makeTextDelta("run-1", "I can help "),
          makeTextDelta("run-1", "with that."),
          makeMessageFinish("run-1", {
            usage: { input_tokens: 50, output_tokens: 12 },
          }),
          makeMessageStart("run-2"),
          makeTextDelta("run-2", "Here is "),
          makeTextDelta("run-2", "more detail."),
          makeMessageFinish("run-2", {
            usage: { input_tokens: 80, output_tokens: 8 },
          }),
        ]);

        const status = sb.status;

        expect(status.messages).toHaveLength(2);
        expect(status.messages[0].type).toBe(MessageType.MESSAGE_AI);
        expect(status.messages[0].content).toBe("Hello, I can help with that.");
        expect(status.messages[0].isStreaming).toBe(false);
        expect(status.messages[0].toolCalls).toHaveLength(0);

        expect(status.messages[1].type).toBe(MessageType.MESSAGE_AI);
        expect(status.messages[1].content).toBe("Here is more detail.");
        expect(status.messages[1].isStreaming).toBe(false);

        expect(status.streamingUsage, "the runtime owns streamingUsage; the builder never touches it").toBeUndefined();
      });
    });

    describe("Anthropic thinking + text", () => {
      it("produces THINKING then AI messages with correct turn boundaries", () => {
        const sb = makeBuilder();
        feedAll(sb, [
          makeMessageStart("run-1"),
          makeReasoningDelta("run-1", "Let me analyze "),
          makeReasoningDelta("run-1", "this problem carefully."),
          makeTextDelta("run-1", "Based on my analysis, "),
          makeTextDelta("run-1", "here is the answer."),
          makeMessageFinish("run-1", {
            usage: {
              input_tokens: 200,
              output_tokens: 80,
              input_token_details: { cache_read: 50 },
            },
          }),
          makeMessageStart("run-2"),
          makeTextDelta("run-2", "Let me elaborate."),
          makeMessageFinish("run-2", {
            usage: { input_tokens: 300, output_tokens: 40 },
          }),
        ]);

        const status = sb.status;

        expect(status.messages).toHaveLength(3);

        expect(status.messages[0].type).toBe(MessageType.MESSAGE_THINKING);
        expect(status.messages[0].content).toBe("Let me analyze this problem carefully.");
        // The run's finish closes its thinking with its text (S4 M4 B1,
        // Q-M4-6); until then the THINKING row spun until finalize.
        expect(status.messages[0].isStreaming).toBe(false);

        expect(status.messages[1].type).toBe(MessageType.MESSAGE_AI);
        expect(status.messages[1].content).toBe("Based on my analysis, here is the answer.");
        expect(status.messages[1].isStreaming).toBe(false);

        expect(status.messages[2].type).toBe(MessageType.MESSAGE_AI);
        expect(status.messages[2].content).toBe("Let me elaborate.");
        expect(status.messages[2].isStreaming).toBe(false);
      });
    });

    describe("single tool call — ReAct pattern", () => {
      it("produces AI message with tool call followed by response", () => {
        const sb = makeBuilder();
        feedAll(sb, [
          makeMessageStart("run-1"),
          makeTextDelta("run-1", "I'll read the file for you."),
          makeMessageFinish("run-1", {
            usage: { input_tokens: 100, output_tokens: 15 },
          }),
          makeToolStarted("toolu_1", "read_file", { path: "/src/main.ts" }),
          makeToolFinished("toolu_1", "export function main() { console.log('hello'); }"),
          makeMessageStart("run-2"),
          makeTextDelta("run-2", "The file contains a main function that logs 'hello'."),
          makeMessageFinish("run-2", {
            usage: { input_tokens: 200, output_tokens: 20 },
          }),
        ]);

        const status = sb.status;

        expect(status.messages).toHaveLength(2);

        const firstMsg = status.messages[0];
        expect(firstMsg.type).toBe(MessageType.MESSAGE_AI);
        expect(firstMsg.content).toBe("I'll read the file for you.");
        expect(firstMsg.isStreaming).toBe(false);
        expect(firstMsg.toolCalls).toHaveLength(1);

        const tc = firstMsg.toolCalls[0];
        expect(tc.id).toBe("toolu_1");
        expect(tc.name).toBe("read_file");
        expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
        expect(tc.args).toEqual({ path: "/src/main.ts" });
        expect(tc.result).toBe("export function main() { console.log('hello'); }");
        expect(tc.error).toBe("");
        expect(tc.isStreaming).toBe(false);
        expect(tc.startedAt).toBeTruthy();
        expect(tc.completedAt).toBeTruthy();

        const secondMsg = status.messages[1];
        expect(secondMsg.type).toBe(MessageType.MESSAGE_AI);
        expect(secondMsg.content).toBe("The file contains a main function that logs 'hello'.");
        expect(secondMsg.toolCalls).toHaveLength(0);
      });
    });

    describe("tool error — failed tool call", () => {
      it("marks tool as FAILED with error string", () => {
        const sb = makeBuilder();
        feedAll(sb, [
          makeMessageStart("run-1"),
          makeTextDelta("run-1", "I'll write to the file."),
          makeMessageFinish("run-1", {
            usage: { input_tokens: 50, output_tokens: 10 },
          }),
          makeToolStarted("toolu_1", "write_file", { path: "/etc/passwd", content: "malicious" }),
          makeToolError("toolu_1", "EACCES: permission denied, open '/etc/passwd'"),
          makeMessageStart("run-2"),
          makeTextDelta("run-2", "I don't have permission to write to that file."),
          makeMessageFinish("run-2", {
            usage: { input_tokens: 120, output_tokens: 18 },
          }),
        ]);

        const status = sb.status;

        expect(status.messages).toHaveLength(2);

        const tc = status.messages[0].toolCalls[0];
        expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
        expect(tc.error).toBe("EACCES: permission denied, open '/etc/passwd'");
        expect(tc.completedAt).toBeTruthy();

        expect(status.messages[1].content).toBe("I don't have permission to write to that file.");
      });
    });

    describe("multi-tool concurrent", () => {
      it("handles two parallel tools on one message with out-of-order completion", () => {
        const sb = makeBuilder();
        feedAll(sb, [
          makeMessageStart("run-1"),
          makeTextDelta("run-1", "I'll look up both files."),
          makeMessageFinish("run-1", {
            reason: "tool_use",
            usage: { input_tokens: 100, output_tokens: 20 },
          }),
          makeToolStarted("toolu_1", "read_file", { path: "/a.ts" }),
          makeToolStarted("toolu_2", "read_file", { path: "/b.ts" }),
          makeToolFinished("toolu_2", "content of b"),
          makeToolFinished("toolu_1", "content of a"),
        ]);

        const status = sb.status;

        const msg = status.messages[0];
        expect(msg.toolCalls).toHaveLength(2);

        const tc1 = msg.toolCalls.find(tc => tc.id === "toolu_1")!;
        const tc2 = msg.toolCalls.find(tc => tc.id === "toolu_2")!;
        expect(tc1.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
        expect(tc2.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
        expect(tc1.result).toBe("content of a");
        expect(tc2.result).toBe("content of b");
      });
    });

    describe("a gated MCP tool that STARTED (S4 M2 C3, option A)", () => {
      // On native a held call never starts: LangGraph's interrupt() runs
      // before the tool handler, so no tool_started arrives and the gate's
      // hold reaches the transcript as approval_proposed from the post-stream
      // seed (C6). A tool_started that does arrive is the engine's word that
      // the call was authorized, so the row is RUNNING and attributed — never
      // WAITING at creation, whatever the policy says (F-M2-27).
      it("is RUNNING and attributed to its server; nothing waits", () => {
        const sb = makeBuilder();
        const gate = gateWith({
          policies: new Map([
            ["my-server/dangerous_tool", {
              toolName: "dangerous_tool",
              mcpServerSlug: "my-server",
              requiresApproval: true,
              approvalMessage: "This tool will modify {{args.path}}",
              source: "classifier_default",
            }],
          ]),
          toolServerMap: new Map([["dangerous_tool", "my-server"]]),
        });

        feedAll(sb, [
          makeMessageStart("run-1"),
          makeTextDelta("run-1", "I need to run a dangerous operation."),
          makeMessageFinish("run-1", {
            reason: "tool_use",
            usage: { input_tokens: 100, output_tokens: 10 },
          }),
          makeToolStarted("toolu_1", "dangerous_tool", { path: "/etc/shadow" }),
        ], gate);

        const status = sb.status;
        expect(sb.awaitingApproval, "no tool_started parks a row").toBe(false);
        expect(status.phase).toBe(ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED);

        const tc = status.messages[0].toolCalls[0];
        expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
        expect(tc.requiresApproval).toBe(false);
        expect(tc.mcpServerSlug).toBe("my-server");
        expect(tc.approvalPolicySource, "the policy's layer still attributes the row").toBe(ApprovalPolicySource.CLASSIFIER_DEFAULT);
        expect(tc.approvalRequestedAt).toBe("");
      });
    });

    describe("namespace isolation — parent + subagent", () => {
      it("creates separate message trees per namespace", () => {
        const sb = makeBuilder();
        const subNs = ["subagent:worker-1"];

        feedAll(sb, [
          // Parent turn 1
          makeMessageStart("parent-run-1"),
          makeTextDelta("parent-run-1", "I'll delegate this research task."),
          makeMessageFinish("parent-run-1", {
            usage: { input_tokens: 100, output_tokens: 15 },
          }),

          // Subagent thinking
          makeReasoningDelta("sub-run-1", "Researching the topic...", { namespace: subNs }),

          // Subagent text response
          makeMessageStart("sub-run-1", { namespace: subNs }),
          makeTextDelta("sub-run-1", "I found the following results.", { namespace: subNs }),
          makeMessageFinish("sub-run-1", {
            namespace: subNs,
            usage: { input_tokens: 150, output_tokens: 25 },
          }),

          // Subagent tool call
          makeToolStarted("sub-tool-1", "web_search", { query: "LangGraph v3 streaming" }, { namespace: subNs }),
          makeToolFinished("sub-tool-1", "3 results found", { namespace: subNs }),

          // Parent resumes
          makeMessageStart("parent-run-2"),
          makeTextDelta("parent-run-2", "The research is complete."),
          makeMessageFinish("parent-run-2", {
            usage: { input_tokens: 400, output_tokens: 10 },
          }),
        ]);

        const status = sb.status;

        expect(status.messages).toHaveLength(4);

        expect(status.messages[0].type).toBe(MessageType.MESSAGE_AI);
        expect(status.messages[0].content).toBe("I'll delegate this research task.");
        expect(status.messages[0].toolCalls).toHaveLength(0);

        expect(status.messages[1].type).toBe(MessageType.MESSAGE_THINKING);
        expect(status.messages[1].content).toBe("Researching the topic...");

        expect(status.messages[2].type).toBe(MessageType.MESSAGE_AI);
        expect(status.messages[2].content).toBe("I found the following results.");
        expect(status.messages[2].toolCalls).toHaveLength(1);
        expect(status.messages[2].toolCalls[0].name).toBe("web_search");
        expect(status.messages[2].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
        expect(status.messages[2].toolCalls[0].result).toBe("3 results found");

        expect(status.messages[3].type).toBe(MessageType.MESSAGE_AI);
        expect(status.messages[3].content).toBe("The research is complete.");
      });
    });
  });

  // ── V3-specific behaviors ────────────────────────────────────────

  describe("v3-specific", () => {
    it("keys tool calls by callId, not runId", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeMessageStart("run-1"),
        makeTextDelta("run-1", "Reading file."),
        makeMessageFinish("run-1", { usage: { input_tokens: 10, output_tokens: 5 } }),
        makeToolStarted("toolu_abc123", "read_file", { path: "/x" }),
        makeToolFinished("toolu_abc123", "contents"),
      ]);

      const tc = sb.status.messages[0].toolCalls[0];
      expect(tc.id).toBe("toolu_abc123");
    });

    it("accumulates tool_arg_delta into ToolCall.args", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeMessageStart("run-1"),
        makeTextDelta("run-1", "Calling tool."),
        makeMessageFinish("run-1", { usage: { input_tokens: 10, output_tokens: 5 } }),
        makeToolStarted("toolu_1", "think", {}),
        makeToolCallArgDelta("run-1", "toolu_1", '{"thought":'),
        makeToolCallArgDelta("run-1", "toolu_1", '"test"}'),
        makeToolFinished("toolu_1", "ok"),
      ]);

      const tc = sb.status.messages[0].toolCalls[0];
      expect(tc.args).toEqual({ thought: "test" });
    });

    it("handles tool_output_delta by accumulating into result", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeMessageStart("run-1"),
        makeTextDelta("run-1", "Running."),
        makeMessageFinish("run-1", { usage: { input_tokens: 10, output_tokens: 5 } }),
        makeToolStarted("toolu_1", "slow_tool", {}),
        makeToolOutputDelta("toolu_1", "partial "),
        makeToolOutputDelta("toolu_1", "output"),
        makeToolFinished("toolu_1", " final"),
      ]);

      const tc = sb.status.messages[0].toolCalls[0];
      expect(tc.result).toBe(" final");
    });

    it("sets dirty on tool start and tool finish", () => {
      const sb = makeBuilder();

      feedAll(sb, [
        makeMessageStart("run-1"),
        makeTextDelta("run-1", "x"),
        makeMessageFinish("run-1", { usage: { input_tokens: 1, output_tokens: 1 } }),
      ]);
      expect(sb.dirty).toBe(false);

      feedAll(sb, [makeToolStarted("toolu_1", "read", {})]);
      expect(sb.dirty).toBe(true);
      sb.markPersisted();

      feedAll(sb, [makeToolFinished("toolu_1", "done")]);
      expect(sb.dirty).toBe(true);
    });

    it("ignores tool-finished for unknown callId", () => {
      const sb = makeBuilder();
      feedAll(sb, [makeToolFinished("unknown_toolu", "some result")]);
      expect(sb.status.messages).toHaveLength(0);
    });
  });

  // ── Todo extraction (write_todos → status.todos) ─────────────────
  //
  // The native harness emits write_todos; projecting it into status.todos is
  // what lights up the client TodoCard at parity with the Cursor harness.

  describe("todo extraction", () => {
    it("projects a completed write_todos into status.todos", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeMessageStart("run-1"),
        makeTextDelta("run-1", "Planning the build."),
        makeMessageFinish("run-1", { usage: { input_tokens: 10, output_tokens: 5 } }),
        makeToolStarted("todo-1", "write_todos", {
          todos: [
            { content: "Step one", status: "in_progress" },
            { content: "Step two", status: "pending" },
          ],
        }),
        makeToolFinished("todo-1", "Todos updated"),
      ]);

      const todos = sb.status.todos;
      expect(Object.keys(todos)).toEqual(["todo-0", "todo-1"]);
      expect(todos["todo-0"].content).toBe("Step one");
      expect(todos["todo-0"].status).toBe(TodoStatus.TODO_IN_PROGRESS);
      expect(todos["todo-1"].content).toBe("Step two");
      expect(todos["todo-1"].status).toBe(TodoStatus.TODO_PENDING);
      expect(sb.dirty).toBe(true);
    });

    it("keeps the write_todos ToolCall in messages stamped ToolKind.TODO", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeToolStarted("todo-1", "write_todos", {
          todos: [{ content: "Step one", status: "pending" }],
        }),
        makeToolFinished("todo-1", "Todos updated"),
      ]);

      const toolCalls = sb.status.messages.flatMap((m) => m.toolCalls);
      const tc = toolCalls.find((t) => t.name === "write_todos");
      expect(tc).toBeDefined();
      expect(tc!.toolKind).toBe(ToolKind.TODO);
    });

    it("does not project until the call completes", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeToolStarted("todo-1", "write_todos", {
          todos: [{ content: "Step one", status: "pending" }],
        }),
      ]);
      // Tool started but not finished — the state Command has not run yet.
      expect(Object.keys(sb.status.todos)).toHaveLength(0);

      feedAll(sb, [makeToolFinished("todo-1", "Todos updated")]);
      expect(Object.keys(sb.status.todos)).toHaveLength(1);
    });

    it("full-replaces the map on a subsequent write_todos", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeToolStarted("todo-1", "write_todos", {
          todos: [
            { content: "Step one", status: "completed" },
            { content: "Step two", status: "in_progress" },
          ],
        }),
        makeToolFinished("todo-1", "ok"),
        makeToolStarted("todo-2", "write_todos", {
          todos: [{ content: "Step two", status: "completed" }],
        }),
        makeToolFinished("todo-2", "ok"),
      ]);

      const todos = sb.status.todos;
      expect(Object.keys(todos)).toEqual(["todo-0"]);
      expect(todos["todo-0"].content).toBe("Step two");
      expect(todos["todo-0"].status).toBe(TodoStatus.TODO_COMPLETED);
    });

    it("routes a sub-agent's message to its own row, never the parent's", () => {
      const sb = makeBuilder();
      const subNs = ["tools:task-1", "model_request:sub-run"];
      feedAll(sb, [
        ...[makeMessageStart("parent-1"), makeTextDelta("parent-1", "Delegating."), makeMessageFinish("parent-1")],
        makeToolStarted("task-1", "task", { subagent_type: "worker", description: "delegate" }),
        makeMessageStart("sub-run", { namespace: subNs }),
        makeTextDelta("sub-run", "Working on it.", { namespace: subNs }),
        makeMessageFinish("sub-run", { namespace: subNs }),
      ]);

      expect(sb.status.messages.map((m) => m.content)).toEqual(["Delegating."]);
      expect(sb.status.subAgentExecutions).toHaveLength(1);
      expect(sb.status.subAgentExecutions[0].messages.map((m) => m.content)).toEqual(["Working on it."]);
    });

    it("does not project a sub-agent's write_todos into parent status.todos", () => {
      const sb = makeBuilder();
      const subNs = ["tools:task-1", "tools:sub-todo"];
      feedAll(sb, [
        // Open a sub-agent so its namespace routes to the sub-agent's own transcript scope.
        makeToolStarted("task-1", "task", {
          subagent_type: "worker",
          description: "delegate",
        }),
        // The sub-agent writes todos — must not leak into the parent map.
        makeToolStarted(
          "sub-todo",
          "write_todos",
          { todos: [{ content: "sub step", status: "pending" }] },
          { namespace: subNs },
        ),
        makeToolFinished("sub-todo", "ok", { namespace: subNs }),
      ]);

      expect(Object.keys(sb.status.todos)).toHaveLength(0);
    });
  });
  // ═══════════════════════════════════════════════════════════════════
  // Carried from the v2 StatusBuilder's suite when that builder retired
  // with the v2 stream (S3 M2b, Q-S3-1 / Q-M2b-5): every rule below is the
  // builder's own — how a policy decides a row's status, what the row
  // carries, how a seeded row is resolved, how artifacts and write-backs
  // are upserted — and had no v3 twin. The sanitizer's own rules
  // (redaction, truncation) are `shared/__tests__/args-preview.test.ts`'s.
  // ═══════════════════════════════════════════════════════════════════

  /** A gate posture for the translator: no policies, no leases, attended, not bypassed — unless overridden. */
  function gateWith(overrides: Partial<DeepAgentGateState> = {}): DeepAgentGateState {
    return {
      policies: new Map(),
      toolServerMap: new Map(),
      leasedCategories: new Set(),
      globalBypass: false,
      unattended: false,
      unattendedSkips: new Set(),
      ...overrides,
    };
  }

  function policyFor(serverSlug: string, toolName: string, message = "Approve?"): [string, MergedToolPolicy] {
    return [
      `${serverSlug}/${toolName}`,
      { toolName, mcpServerSlug: serverSlug, requiresApproval: true, approvalMessage: message, source: "classifier_default" },
    ];
  }

  /** A text turn, then one tool start, through a translator over the given gate posture. */
  function firstToolCallUnder(gate: DeepAgentGateState, toolName: string, input: Record<string, unknown> = {}) {
    const sb = makeBuilder();
    feedAll(sb, [
      makeMessageStart("run-1"),
      makeTextDelta("run-1", "Working."),
      makeMessageFinish("run-1", { usage: { input_tokens: 10, output_tokens: 5 } }),
      makeToolStarted("toolu_1", toolName, input),
    ], gate);
    return { sb, tc: sb.status.messages[0].toolCalls[0] };
  }

  describe("attribution and provenance on tool_started (S4 M2 C3, option A)", () => {
    // The translator answers WHICH server a tool belongs to and WHICH policy
    // layer governs it; it never answers whether the gate holds the call —
    // on native a held call never starts (the interrupt precedes the
    // handler), so every started call is RUNNING and nothing here waits.
    // The decision itself, `resolveToolApproval`, has its own arms in
    // `shared/__tests__/approval-policy.test.ts`; the gate's use of it in
    // `middleware/__tests__/approval-gate.test.ts`.

    it("an MCP tool with a gating policy STILL runs when it started, attributed to its server and the policy's layer", () => {
      const [key, policy] = policyFor("github", "create_issue");
      const { sb, tc } = firstToolCallUnder(
        gateWith({ policies: new Map([[key, policy]]), toolServerMap: new Map([["create_issue", "github"]]) }),
        "create_issue",
        { title: "Bug fix" },
      );
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
      expect(tc.requiresApproval).toBe(false);
      expect(tc.mcpServerSlug).toBe("github");
      expect(tc.approvalPolicySource).toBe(ApprovalPolicySource.CLASSIFIER_DEFAULT);
      expect(tc.policyEngineVersion).toBe("phase-7");
      expect(sb.awaitingApproval).toBe(false);
    });

    it("the global bypass (spec.auto_approve_all) attributes every row to it", () => {
      const [key, policy] = policyFor("github", "delete_repo");
      const { tc } = firstToolCallUnder(
        gateWith({ policies: new Map([[key, policy]]), toolServerMap: new Map([["delete_repo", "github"]]), globalBypass: true }),
        "delete_repo",
      );
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
      expect(tc.mcpServerSlug, "the bypass still attributes the row to its MCP server").toBe("github");
      expect(tc.approvalPolicySource).toBe(ApprovalPolicySource.AUTO_APPROVE_ALL);
    });

    it("an MCP tool with no policy is attributed to its server, classifier_default", () => {
      const { tc } = firstToolCallUnder(gateWith({ toolServerMap: new Map([["read", "filesystem"]]) }), "read");
      expect(tc.mcpServerSlug).toBe("filesystem");
      expect(tc.approvalPolicySource).toBe(ApprovalPolicySource.CLASSIFIER_DEFAULT);
    });

    it("a tool the server map does not know carries no server (the policy key needs the server)", () => {
      const [key, policy] = policyFor("github", "create_pr");
      const { tc } = firstToolCallUnder(gateWith({ policies: new Map([[key, policy]]), toolServerMap: new Map() }), "create_pr");
      expect(tc.mcpServerSlug).toBe("");
      expect(tc.approvalPolicySource, "an unknown built-in is governed by no layer").toBe(ApprovalPolicySource.UNSPECIFIED);
      expect(tc.policyEngineVersion).toBe("");
    });

    it("a mutating built-in that started is attributed builtin_category — the gate let it flow (capture mode, or a resume)", () => {
      const { sb, tc } = firstToolCallUnder(gateWith(), "execute", { command: "rm -rf build" });
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
      expect(tc.approvalPolicySource).toBe(ApprovalPolicySource.BUILTIN_CATEGORY);
      expect(sb.awaitingApproval).toBe(false);
    });

    it("a leased built-in category is attributed to its lease", () => {
      const { tc } = firstToolCallUnder(gateWith({ leasedCategories: new Set(["shell"]) }), "execute", { command: "ls" });
      expect(tc.approvalPolicySource).toBe(ApprovalPolicySource.APPROVAL_LEASE);
    });

    it("a read-only built-in is governed by no layer: UNSPECIFIED, no engine version", () => {
      const { tc } = firstToolCallUnder(gateWith(), "read_file", { path: "/x" });
      expect(tc.approvalPolicySource).toBe(ApprovalPolicySource.UNSPECIFIED);
      expect(tc.policyEngineVersion).toBe("");
    });

    it("with no gate posture at all (a turn the unit arms drive bare) nothing is attributed", () => {
      const sb = makeBuilder();
      feedAll(sb, [makeToolStarted("toolu_1", "execute", { command: "ls" })]);
      const tc = sb.status.messages[0].toolCalls[0];
      expect(tc.mcpServerSlug).toBe("");
      expect(tc.approvalPolicySource).toBe(ApprovalPolicySource.UNSPECIFIED);
    });
  });

  describe("tool rows without a preceding text turn, and interleaving", () => {
    it("a tool start with no prior text creates the AI message that carries it", () => {
      const sb = makeBuilder();
      feedAll(sb, [makeToolStarted("orphan", "read", {})]);
      expect(sb.status.messages).toHaveLength(1);
      expect(sb.status.messages[0].toolCalls[0].name).toBe("read");
    });

    it("interleaved start/finish pairs settle each row independently", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeMessageStart("run-1"),
        makeTextDelta("run-1", "working"),
        makeMessageFinish("run-1", { usage: { input_tokens: 1, output_tokens: 1 } }),
        makeToolStarted("toolu_a", "read", {}),
        makeToolFinished("toolu_a", "data 1"),
        makeToolStarted("toolu_b", "write", {}),
        makeToolFinished("toolu_b", "done"),
      ]);
      const rows = sb.status.messages.flatMap((m) => m.toolCalls);
      expect(rows.map((r) => r.status)).toEqual([ToolCallStatus.TOOL_CALL_COMPLETED, ToolCallStatus.TOOL_CALL_COMPLETED]);
    });
  });

  describe("a handler that throws", () => {
    it("is logged with the execution and the event kind, and never escapes apply", () => {
      const sb = makeBuilder();
      const errors: string[] = [];
      const original = console.error;
      console.error = (msg: unknown) => { errors.push(String(msg)); };
      try {
        const poisoned = new DeepAgentTranslator(null).translate(makeToolFinished("toolu_x", "ok"))[0]!;
        // A getter that throws where the handler reads the result.
        const event = { ...poisoned, get result(): string { throw new Error("property access failed"); } };
        expect(() => sb.apply(event as typeof poisoned)).not.toThrow();
      } finally {
        console.error = original;
      }
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("exec-test");
      expect(errors[0]).toContain("kind=tool_finished");
      expect(errors[0]).toContain("property access failed");
    });
  });

  describe("resume reconciliation (a seeded WAITING row on a durable checkpoint)", () => {
    const GATED_ID = "toolu_seeded_01";

    it("resolves the seeded gated row in place — no duplicate, history kept, no re-gate", () => {
      const status = create(AgentExecutionStatusSchema, {
        phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
        messages: [
          create(AgentMessageSchema, {
            type: MessageType.MESSAGE_AI,
            content: "I'll call the gated tool.",
            toolCalls: [
              create(ToolCallSchema, {
                id: GATED_ID,
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
      const [key, policy] = policyFor("my-server", "dangerous_tool", "Execute dangerous_tool");
      const gate = gateWith({ policies: new Map([[key, policy]]), toolServerMap: new Map([["dangerous_tool", "my-server"]]) });

      // The durable checkpoint re-emits the SAME tool_call_id now that approval is granted.
      feedAll(sb, [
        makeToolStarted(GATED_ID, "dangerous_tool", { target: "prod" }),
        makeToolFinished(GATED_ID, "tool executed ok"),
        makeMessageStart("llm-after"),
        makeTextDelta("llm-after", "All done."),
        makeMessageFinish("llm-after", { usage: { input_tokens: 1, output_tokens: 1 } }),
      ], gate);

      const gated = sb.status.messages.flatMap((m) => m.toolCalls).filter((tc) => tc.id === GATED_ID);
      expect(gated).toHaveLength(1);
      expect(gated[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
      expect(gated[0].result).toContain("tool executed ok");
      expect(gated[0].args, "the resumed start fills the args the seed lacked").toEqual({ target: "prod" });
      const allText = sb.status.messages.map((m) => m.content).join("\n");
      expect(allText).toContain("I'll call the gated tool.");
      expect(allText).toContain("All done.");
      expect(sb.awaitingApproval, "a resumed tool never re-gates").toBe(false);
    });
  });

  describe("artifacts and write-backs (Q-S4-8)", () => {
    const artifact = (sandboxPath: string, contentHash: string) =>
      create(ExecutionArtifactSchema, { sandboxPath, contentHash, storageKey: `k/${contentHash}` });

    it("appends a new artifact and forces the next persist", () => {
      const sb = makeBuilder();
      sb.addArtifact(artifact("out/a.txt", "h1"));
      expect(sb.status.artifacts).toHaveLength(1);
      expect(sb.dirty).toBe(true);
    });

    it("deduplicates by sandboxPath: the same contentHash is a no-op that does not force a persist", () => {
      const sb = makeBuilder();
      sb.addArtifact(artifact("out/a.txt", "h1"));
      sb.markPersisted();
      sb.addArtifact(artifact("out/a.txt", "h1"));
      expect(sb.status.artifacts).toHaveLength(1);
      expect(sb.dirty).toBe(false);
    });

    it("replaces the artifact in place when its contentHash changes", () => {
      const sb = makeBuilder();
      sb.addArtifact(artifact("out/a.txt", "h1"));
      sb.markPersisted();
      sb.addArtifact(artifact("out/a.txt", "h2"));
      expect(sb.status.artifacts).toHaveLength(1);
      expect(sb.status.artifacts[0].contentHash).toBe("h2");
      expect(sb.dirty).toBe(true);
    });

    it("upserts write-backs by workspaceEntryName, tracking entries independently", () => {
      const sb = makeBuilder();
      sb.addWriteBack(create(WorkspaceWriteBackSchema, { workspaceEntryName: "repo-a", branchName: "stigmer/s1" }));
      sb.addWriteBack(create(WorkspaceWriteBackSchema, { workspaceEntryName: "repo-b", branchName: "stigmer/s1" }));
      sb.markPersisted();
      sb.addWriteBack(create(WorkspaceWriteBackSchema, { workspaceEntryName: "repo-a", branchName: "stigmer/s1", pullRequestUrl: "https://example/pr/1" }));
      const backs = sb.status.workspaceWriteBacks;
      expect(backs.map((b) => b.workspaceEntryName)).toEqual(["repo-a", "repo-b"]);
      expect(backs[0].pullRequestUrl).toBe("https://example/pr/1");
      expect(sb.dirty).toBe(true);
    });
  });
});
