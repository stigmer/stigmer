import { describe, it, expect, beforeEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { V3StatusBuilder } from "../v3-status-builder.js";
import { normalize } from "../v3-protocol-normalizer.js";
import type { ApprovalPolicyProvider } from "../status-builder.js";
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
  makeUsageEvent,
} from "../__test-utils__/v3-event-fixtures.js";
import type { V3ProtocolEvent } from "../v3-event-recorder.js";

function makeBuilder(): V3StatusBuilder {
  return new V3StatusBuilder("exec-test", create(AgentExecutionStatusSchema, {}));
}

function feedAll(sb: V3StatusBuilder, events: V3ProtocolEvent[]): void {
  for (const raw of events) {
    for (const e of normalize(raw)) {
      sb.processEvent(e);
    }
  }
}

beforeEach(() => resetSeq());

describe("V3StatusBuilder", () => {

  // ── Initialization ───────────────────────────────────────────────

  describe("initialization", () => {
    it("sets phase to IN_PROGRESS on construction", () => {
      const sb = makeBuilder();
      expect(sb.currentStatus.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    });

    it("sets startedAt on construction", () => {
      const sb = makeBuilder();
      expect(sb.currentStatus.startedAt).toBeTruthy();
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
      it("produces 2 AI messages with accumulated usage", () => {
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

        const usage = status.streamingUsage!;
        expect(usage.inputTokens).toBe(130n);
        expect(usage.outputTokens).toBe(20n);
        expect(usage.turnCount).toBe(2);
        expect(usage.totalTokens).toBe(150n);

        expect(status.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
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

        const usage = status.streamingUsage!;
        expect(usage.inputTokens).toBe(500n);
        expect(usage.outputTokens).toBe(120n);
        expect(usage.cacheReadTokens).toBe(50n);
        expect(usage.turnCount).toBe(2);
        expect(usage.totalTokens).toBe(670n);
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

        const usage = status.streamingUsage!;
        expect(usage.inputTokens).toBe(300n);
        expect(usage.outputTokens).toBe(35n);
        expect(usage.turnCount).toBe(2);
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
        expect(status.phase).toBe(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL);

        const tc = status.messages[0].toolCalls[0];
        expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
        expect(tc.requiresApproval).toBe(true);
        expect(tc.approvalMessage).toBe("This tool will modify /etc/shadow");
        expect(tc.mcpServerSlug).toBe("my-server");
        expect(tc.approvalRequestedAt).toBeTruthy();
        expect(tc.argsPreview).toBeTruthy();
      });
    });

    describe("usage accumulation — 3-turn with cache", () => {
      it("accumulates input/output/cache tokens across turns", () => {
        const sb = makeBuilder();
        feedAll(sb, [
          makeMessageStart("run-1"),
          makeTextDelta("run-1", "Turn 1"),
          makeMessageFinish("run-1", {
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              input_token_details: { cache_creation: 80 },
            },
          }),
          makeMessageStart("run-2"),
          makeTextDelta("run-2", "Turn 2"),
          makeMessageFinish("run-2", {
            usage: {
              input_tokens: 200,
              output_tokens: 30,
              input_token_details: { cache_read: 50 },
            },
          }),
          makeMessageStart("run-3"),
          makeTextDelta("run-3", "Turn 3"),
          makeMessageFinish("run-3", {
            usage: {
              input_tokens: 300,
              output_tokens: 10,
              input_token_details: { cache_read: 100 },
            },
          }),
        ]);

        const usage = sb.currentStatus.streamingUsage!;
        expect(usage.inputTokens).toBe(600n);
        expect(usage.outputTokens).toBe(60n);
        expect(usage.cacheWriteTokens).toBe(80n);
        expect(usage.cacheReadTokens).toBe(150n);
        expect(usage.turnCount).toBe(3);
        expect(usage.totalTokens).toBe(890n);
        expect(usage.observedAt).toBeTruthy();
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

        const usage = status.streamingUsage!;
        expect(usage.inputTokens).toBe(650n);
        expect(usage.outputTokens).toBe(50n);
        expect(usage.turnCount).toBe(3);
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

    it("does not double-count usage from standalone usage events", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeMessageStart("run-1"),
        makeTextDelta("run-1", "hi"),
        makeUsageEvent("run-1", { input_tokens: 50, output_tokens: 10 }),
        makeMessageFinish("run-1", {
          usage: { input_tokens: 50, output_tokens: 10 },
        }),
      ]);

      const usage = sb.currentStatus.streamingUsage!;
      expect(usage.inputTokens).toBe(50n);
      expect(usage.outputTokens).toBe(10n);
      expect(usage.turnCount).toBe(1);
    });

    it("accumulates tool_call_arg_delta into ToolCall.args", () => {
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
});
