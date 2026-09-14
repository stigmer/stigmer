/**
 * The transcript builder's unit arms (`harness/transcript/builder.ts`),
 * driven through the native normalizer: every sequence here is raw LangGraph
 * v3 protocol events folded by `normalize` and then by the builder, so these
 * are in truth the native translator's integration arms as much as the
 * builder's.
 *
 * Why this file is in the adapter's folder while its subject is in
 * `harness/` (S4 M1, Q-M1-2): the direction fence sweeps `harness/` tests
 * included, and `normalize`, the v3 fixtures and `V3ProtocolEvent` are all
 * `activities/` modules. At M2, when the builder takes `TranscriptEvent`s
 * that no longer carry LangGraph's shape, these arms are re-keyed and
 * re-homed to `harness/transcript/__tests__/builder.test.ts`; the
 * normalizer-through-builder arms that remain valuable stay here as the
 * translator's. The inventory of every arm's destination is
 * `T01_3_execution.md` (M0).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction, ExecutionPhase, MessageType, ToolCallStatus, ToolKind, TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { WorkspaceWriteBackSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import { TranscriptBuilder, type ApprovalPolicyProvider } from "../../../harness/transcript/builder.js";
import { normalize } from "../v3-protocol-normalizer.js";
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
 * sink — `turn-stream.test.ts` pins that; `v3-protocol-normalizer.test.ts`
 * pins what `usageOf` reads. The `usage:` fields the sequences below still
 * carry are the wire's real shape and are ignored by everything here.
 */
function makeBuilder(): TranscriptBuilder {
  return new TranscriptBuilder("exec-test", create(AgentExecutionStatusSchema, {}));
}

function feedAll(sb: TranscriptBuilder, events: V3ProtocolEvent[]): void {
  for (const raw of events) {
    for (const e of normalize(raw)) {
      sb.apply(e);
    }
  }
}

beforeEach(() => resetSeq());

describe("TranscriptBuilder", () => {

  // ── Initialization ───────────────────────────────────────────────

  describe("initialization", () => {
    it("writes neither phase nor startedAt (the turn runtime owns both; S3 M2a, Q-M2a-7)", () => {
      const sb = makeBuilder();
      expect(sb.currentStatus.phase).toBe(ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED);
      expect(sb.currentStatus.startedAt).toBe("");
      expect(sb.awaitingApproval).toBe(false);
    });

    it("starts with forceNextUpdate = false", () => {
      const sb = makeBuilder();
      expect(sb.forceNextUpdate).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GOLDEN SEQUENCES
  //
  // Same proto assertions as v2 StatusBuilder golden tests, but input
  // is v3 ProtocolEvent sequences fed through the normalizer.
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

        const status = sb.currentStatus;

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

        const status = sb.currentStatus;

        expect(status.messages).toHaveLength(3);

        expect(status.messages[0].type).toBe(MessageType.MESSAGE_THINKING);
        expect(status.messages[0].content).toBe("Let me analyze this problem carefully.");
        expect(status.messages[0].isStreaming).toBe(true);

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

        const status = sb.currentStatus;

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

        const status = sb.currentStatus;

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

        const status = sb.currentStatus;

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

    describe("HITL approval gate", () => {
      it("sets WAITING_FOR_APPROVAL on tool with approval policy", () => {
        const sb = makeBuilder();
        sb.setApprovalProvider({
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
          globalBypass: false,
        } as ApprovalPolicyProvider);

        feedAll(sb, [
          makeMessageStart("run-1"),
          makeTextDelta("run-1", "I need to run a dangerous operation."),
          makeMessageFinish("run-1", {
            reason: "tool_use",
            usage: { input_tokens: 100, output_tokens: 10 },
          }),
          makeToolStarted("toolu_1", "dangerous_tool", { path: "/etc/shadow" }),
        ]);

        const status = sb.currentStatus;
        expect(sb.awaitingApproval, "a fact for the caller, never a phase write").toBe(true);
        expect(status.phase).toBe(ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED);

        const tc = status.messages[0].toolCalls[0];
        expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
        expect(tc.requiresApproval).toBe(true);
        expect(tc.approvalMessage).toBe("This tool will modify /etc/shadow");
        expect(tc.mcpServerSlug).toBe("my-server");
        expect(tc.approvalRequestedAt).toBeTruthy();
        expect(tc.argsPreview).toBeTruthy();
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

        const status = sb.currentStatus;

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

      const tc = sb.currentStatus.messages[0].toolCalls[0];
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

      const tc = sb.currentStatus.messages[0].toolCalls[0];
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

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.result).toBe(" final");
    });

    it("sets forceNextUpdate on tool start and tool finish", () => {
      const sb = makeBuilder();

      feedAll(sb, [
        makeMessageStart("run-1"),
        makeTextDelta("run-1", "x"),
        makeMessageFinish("run-1", { usage: { input_tokens: 1, output_tokens: 1 } }),
      ]);
      expect(sb.forceNextUpdate).toBe(false);

      feedAll(sb, [makeToolStarted("toolu_1", "read", {})]);
      expect(sb.forceNextUpdate).toBe(true);
      sb.clearForceFlag();

      feedAll(sb, [makeToolFinished("toolu_1", "done")]);
      expect(sb.forceNextUpdate).toBe(true);
    });

    it("ignores tool-finished for unknown callId", () => {
      const sb = makeBuilder();
      feedAll(sb, [makeToolFinished("unknown_toolu", "some result")]);
      expect(sb.currentStatus.messages).toHaveLength(0);
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

      const todos = sb.currentStatus.todos;
      expect(Object.keys(todos)).toEqual(["todo-0", "todo-1"]);
      expect(todos["todo-0"].content).toBe("Step one");
      expect(todos["todo-0"].status).toBe(TodoStatus.TODO_IN_PROGRESS);
      expect(todos["todo-1"].content).toBe("Step two");
      expect(todos["todo-1"].status).toBe(TodoStatus.TODO_PENDING);
      expect(sb.forceNextUpdate).toBe(true);
    });

    it("keeps the write_todos ToolCall in messages stamped ToolKind.TODO", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeToolStarted("todo-1", "write_todos", {
          todos: [{ content: "Step one", status: "pending" }],
        }),
        makeToolFinished("todo-1", "Todos updated"),
      ]);

      const toolCalls = sb.currentStatus.messages.flatMap((m) => m.toolCalls);
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
      expect(Object.keys(sb.currentStatus.todos)).toHaveLength(0);

      feedAll(sb, [makeToolFinished("todo-1", "Todos updated")]);
      expect(Object.keys(sb.currentStatus.todos)).toHaveLength(1);
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

      const todos = sb.currentStatus.todos;
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

      expect(sb.currentStatus.messages.map((m) => m.content)).toEqual(["Delegating."]);
      expect(sb.currentStatus.subAgentExecutions).toHaveLength(1);
      expect(sb.currentStatus.subAgentExecutions[0].messages.map((m) => m.content)).toEqual(["Working on it."]);
    });

    it("does not project a sub-agent's write_todos into parent status.todos", () => {
      const sb = makeBuilder();
      const subNs = ["tools:task-1", "tools:sub-todo"];
      feedAll(sb, [
        // Register a sub-agent so its namespace routes to the SubAgentTracker.
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

      expect(Object.keys(sb.currentStatus.todos)).toHaveLength(0);
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

  function providerWith(overrides: Partial<ApprovalPolicyProvider> = {}): ApprovalPolicyProvider {
    return { policies: new Map(), toolServerMap: new Map(), globalBypass: false, ...overrides };
  }

  function policyFor(serverSlug: string, toolName: string, message = "Approve?"): [string, MergedToolPolicy] {
    return [
      `${serverSlug}/${toolName}`,
      { toolName, mcpServerSlug: serverSlug, requiresApproval: true, approvalMessage: message, source: "classifier_default" },
    ];
  }

  /** A text turn, then one tool start, on a builder with the given provider. */
  function firstToolCallUnder(provider: ApprovalPolicyProvider, toolName: string, input: Record<string, unknown> = {}) {
    const sb = makeBuilder();
    sb.setApprovalProvider(provider);
    feedAll(sb, [
      makeMessageStart("run-1"),
      makeTextDelta("run-1", "Working."),
      makeMessageFinish("run-1", { usage: { input_tokens: 10, output_tokens: 5 } }),
      makeToolStarted("toolu_1", toolName, input),
    ]);
    return { sb, tc: sb.currentStatus.messages[0].toolCalls[0] };
  }

  describe("approval provider: what decides a row's status", () => {
    it("a policy that requires approval leaves the row WAITING_APPROVAL with its message and server", () => {
      const [key, policy] = policyFor("github", "create_issue");
      const { sb, tc } = firstToolCallUnder(
        providerWith({ policies: new Map([[key, policy]]), toolServerMap: new Map([["create_issue", "github"]]) }),
        "create_issue",
        { title: "Bug fix" },
      );
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
      expect(tc.requiresApproval).toBe(true);
      expect(tc.approvalMessage).toBe("Approve?");
      expect(tc.mcpServerSlug).toBe("github");
      expect(tc.approvalRequestedAt, "stamped when approval is required").toContain("T");
      expect(sb.awaitingApproval).toBe(true);
    });

    it("the global bypass (spec.auto_approve_all) runs a gated tool without approval", () => {
      const [key, policy] = policyFor("github", "delete_repo");
      const { sb, tc } = firstToolCallUnder(
        providerWith({ policies: new Map([[key, policy]]), toolServerMap: new Map([["delete_repo", "github"]]), globalBypass: true }),
        "delete_repo",
      );
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
      expect(tc.requiresApproval).toBe(false);
      expect(sb.awaitingApproval).toBe(false);
    });

    it("the global bypass still attributes the row to its MCP server", () => {
      const { tc } = firstToolCallUnder(
        providerWith({ toolServerMap: new Map([["echo", "test-mcp-server"]]), globalBypass: true }),
        "echo",
        { input: "hello" },
      );
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
      expect(tc.mcpServerSlug).toBe("test-mcp-server");
    });

    it("a tool with no policy runs, attributed to its server", () => {
      const { tc } = firstToolCallUnder(providerWith({ toolServerMap: new Map([["read", "filesystem"]]) }), "read");
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
      expect(tc.mcpServerSlug).toBe("filesystem");
    });

    it("a policy whose tool is not in the server map does not gate (the policy key needs the server)", () => {
      const [key, policy] = policyFor("github", "create_pr");
      const { tc } = firstToolCallUnder(providerWith({ policies: new Map([[key, policy]]), toolServerMap: new Map() }), "create_pr");
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
    });

    it("resolves {{args.field}} placeholders in the approval message", () => {
      const [key, policy] = policyFor("github", "create_issue", "Create issue '{{args.title}}' in {{args.repo}}?");
      const { tc } = firstToolCallUnder(
        providerWith({ policies: new Map([[key, policy]]), toolServerMap: new Map([["create_issue", "github"]]) }),
        "create_issue",
        { title: "Fix crash", repo: "stigmer/stigmer" },
      );
      expect(tc.approvalMessage).toBe("Create issue 'Fix crash' in stigmer/stigmer?");
    });
  });

  describe("args preview: when the builder writes one", () => {
    it("a gated row carries a sanitized preview; an ungated row carries none", () => {
      const [key, policy] = policyFor("db", "connect");
      const gated = firstToolCallUnder(
        providerWith({ policies: new Map([[key, policy]]), toolServerMap: new Map([["connect", "db"]]) }),
        "connect",
        { host: "localhost", password: "super-secret" },
      );
      const preview = JSON.parse(gated.tc.argsPreview) as Record<string, string>;
      expect(preview.host).toBe("localhost");
      expect(preview.password, "the shared sanitizer redacts secret keys").toBe("[REDACTED]");

      const ungated = firstToolCallUnder(providerWith(), "read", { path: "/foo" });
      expect(ungated.tc.argsPreview).toBe("");
    });

    it("an unserializable input leaves the preview empty instead of failing the row", () => {
      const [key, policy] = policyFor("api", "call");
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const { tc } = firstToolCallUnder(
        providerWith({ policies: new Map([[key, policy]]), toolServerMap: new Map([["call", "api"]]) }),
        "call",
        circular,
      );
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
      expect(tc.argsPreview).toBe("");
    });
  });

  describe("tool rows without a preceding text turn, and interleaving", () => {
    it("a tool start with no prior text creates the AI message that carries it", () => {
      const sb = makeBuilder();
      feedAll(sb, [makeToolStarted("orphan", "read", {})]);
      expect(sb.currentStatus.messages).toHaveLength(1);
      expect(sb.currentStatus.messages[0].toolCalls[0].name).toBe("read");
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
      const rows = sb.currentStatus.messages.flatMap((m) => m.toolCalls);
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
        const poisoned = normalize(makeToolFinished("toolu_x", "ok"))[0]!;
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
      sb.setApprovalProvider(providerWith({ policies: new Map([[key, policy]]), toolServerMap: new Map([["dangerous_tool", "my-server"]]) }));

      // The durable checkpoint re-emits the SAME tool_call_id now that approval is granted.
      feedAll(sb, [
        makeToolStarted(GATED_ID, "dangerous_tool", { target: "prod" }),
        makeToolFinished(GATED_ID, "tool executed ok"),
        makeMessageStart("llm-after"),
        makeTextDelta("llm-after", "All done."),
        makeMessageFinish("llm-after", { usage: { input_tokens: 1, output_tokens: 1 } }),
      ]);

      const gated = sb.currentStatus.messages.flatMap((m) => m.toolCalls).filter((tc) => tc.id === GATED_ID);
      expect(gated).toHaveLength(1);
      expect(gated[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
      expect(gated[0].result).toContain("tool executed ok");
      expect(gated[0].args, "the resumed start fills the args the seed lacked").toEqual({ target: "prod" });
      const allText = sb.currentStatus.messages.map((m) => m.content).join("\n");
      expect(allText).toContain("I'll call the gated tool.");
      expect(allText).toContain("All done.");
      expect(sb.awaitingApproval, "a resumed tool never re-gates").toBe(false);
    });
  });

  describe("artifacts and write-backs (the ExecutionStatusWriter face)", () => {
    const artifact = (sandboxPath: string, contentHash: string) =>
      create(ExecutionArtifactSchema, { sandboxPath, contentHash, storageKey: `k/${contentHash}` });

    it("appends a new artifact and forces the next persist", () => {
      const sb = makeBuilder();
      sb.addArtifact(artifact("out/a.txt", "h1"));
      expect(sb.currentStatus.artifacts).toHaveLength(1);
      expect(sb.forceNextUpdate).toBe(true);
    });

    it("deduplicates by sandboxPath: the same contentHash is a no-op that does not force a persist", () => {
      const sb = makeBuilder();
      sb.addArtifact(artifact("out/a.txt", "h1"));
      sb.clearForceFlag();
      sb.addArtifact(artifact("out/a.txt", "h1"));
      expect(sb.currentStatus.artifacts).toHaveLength(1);
      expect(sb.forceNextUpdate).toBe(false);
    });

    it("replaces the artifact in place when its contentHash changes", () => {
      const sb = makeBuilder();
      sb.addArtifact(artifact("out/a.txt", "h1"));
      sb.clearForceFlag();
      sb.addArtifact(artifact("out/a.txt", "h2"));
      expect(sb.currentStatus.artifacts).toHaveLength(1);
      expect(sb.currentStatus.artifacts[0].contentHash).toBe("h2");
      expect(sb.forceNextUpdate).toBe(true);
    });

    it("upserts write-backs by workspaceEntryName, tracking entries independently", () => {
      const sb = makeBuilder();
      sb.addWriteBack(create(WorkspaceWriteBackSchema, { workspaceEntryName: "repo-a", branchName: "stigmer/s1" }));
      sb.addWriteBack(create(WorkspaceWriteBackSchema, { workspaceEntryName: "repo-b", branchName: "stigmer/s1" }));
      sb.clearForceFlag();
      sb.addWriteBack(create(WorkspaceWriteBackSchema, { workspaceEntryName: "repo-a", branchName: "stigmer/s1", pullRequestUrl: "https://example/pr/1" }));
      const backs = sb.currentStatus.workspaceWriteBacks;
      expect(backs.map((b) => b.workspaceEntryName)).toEqual(["repo-a", "repo-b"]);
      expect(backs[0].pullRequestUrl).toBe("https://example/pr/1");
      expect(sb.forceNextUpdate).toBe(true);
    });
  });
});
