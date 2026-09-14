/**
 * The native translator's own arms (`execute-deep-agent/translator.ts`): one
 * raw LangGraph v3 protocol event in, the `TranscriptEvent`s out. Two layers,
 * tested apart: `normalize`, the stateless core that reads the wire's shape
 * (root-scoped, unattributed), and `DeepAgentTranslator`, which lays scope
 * and the gate's answers on top and speaks a sub-agent's lifecycle (S4 M2
 * C3, C4). Beside them, what `usageOf` reads off the same wire for the loop
 * (C1, Q-M2-3). The events the wire carries and the transcript does not
 * (`lifecycle`, `provider`, the standalone `usage`) are pinned as producing
 * NOTHING, so a member cannot creep back into the union unnoticed.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DeepAgentTranslator, normalize, usageOf } from "../translator.js";
import {
  resetSeq,
  makeProtocolEvent,
  makeMessageStart,
  makeMessageFinish,
  makeTextDelta,
  makeReasoningDelta,
  makeToolCallArgDelta,
  makeToolStarted,
  makeToolFinished,
  makeToolError,
  makeToolOutputDelta,
  makeUsageEvent,
  makeProviderEvent,
  makeLifecycleRunning,
  makeLifecycleCompleted,
  makeContentBlockStartText,
  makeContentBlockFinish,
  makeCheckpointEvent,
  makeTasksEvent,
  makeValuesEvent,
  makeUpdatesEvent,
} from "../__test-utils__/v3-event-fixtures.js";

beforeEach(() => resetSeq());

describe("V3ProtocolNormalizer", () => {

  // ── Message channel ──────────────────────────────────────────────

  describe("messages channel", () => {
    it("normalizes message-start to the run id alone (the wire's message id is not a transcript fact)", () => {
      const result = normalize(makeMessageStart("run-1", { messageId: "msg_abc" }));
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ kind: "message_start", runId: "run-1" });
    });

    it("normalizes text-delta", () => {
      const result = normalize(makeTextDelta("run-1", "Hello "));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "text_delta",
        runId: "run-1",
        text: "Hello ",
      });
    });

    it("normalizes reasoning-delta", () => {
      const result = normalize(makeReasoningDelta("run-1", "Let me think..."));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "reasoning_delta",
        runId: "run-1",
        text: "Let me think...",
      });
    });

    it("normalizes tool_call_chunk via block-delta", () => {
      const result = normalize(makeToolCallArgDelta("run-1", "toolu_123", '{"path":'));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "tool_arg_delta",
        callId: "toolu_123",
        argsChunk: '{"path":',
      });
    });

    it("normalizes message-finish to the run id alone — its usage and reason are the loop's, not the transcript's", () => {
      const result = normalize(makeMessageFinish("run-1", {
        reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      }));
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ kind: "message_finish", runId: "run-1" });
    });

    it("emits nothing for the standalone usage event", () => {
      expect(normalize(makeUsageEvent("run-1", { input_tokens: 50, output_tokens: 10 }))).toHaveLength(0);
    });

    it("emits nothing for the provider event", () => {
      expect(normalize(makeProviderEvent("run-1", "anthropic", "claude-sonnet-4-6"))).toHaveLength(0);
    });

    it("returns empty for content-block-start", () => {
      const result = normalize(makeContentBlockStartText("run-1"));
      expect(result).toHaveLength(0);
    });

    it("returns empty for content-block-finish", () => {
      const result = normalize(makeContentBlockFinish("run-1"));
      expect(result).toHaveLength(0);
    });

    it("ignores empty text-delta", () => {
      const result = normalize(makeTextDelta("run-1", ""));
      expect(result).toHaveLength(0);
    });

    it("ignores empty reasoning-delta", () => {
      const result = normalize(makeReasoningDelta("run-1", ""));
      expect(result).toHaveLength(0);
    });
  });

  // ── Tools channel ────────────────────────────────────────────────

  describe("tools channel", () => {
    it("normalizes tool-started with snake_case fields", () => {
      const result = normalize(makeToolStarted("toolu_abc", "read_file", '{"path":"/src/main.ts"}'));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "tool_started",
        callId: "toolu_abc",
        name: "read_file",
        input: { path: "/src/main.ts" },
      });
    });

    it("normalizes tool-started with camelCase fields", () => {
      const event = makeProtocolEvent("tools", {
        event: "tool-started",
        toolCallId: "toolu_abc",
        toolName: "read_file",
        input: { path: "/src/main.ts" },
      }, { namespace: ["tools:toolu_abc"] });
      const result = normalize(event);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "tool_started",
        callId: "toolu_abc",
        name: "read_file",
      });
    });

    it("normalizes tool-finished to the row's result string", () => {
      const result = normalize(makeToolFinished("toolu_abc", "file content here"));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "tool_finished",
        callId: "toolu_abc",
        result: "file content here",
      });
    });

    it("normalizes tool-error", () => {
      const result = normalize(makeToolError("toolu_abc", "permission denied"));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "tool_error",
        callId: "toolu_abc",
        message: "permission denied",
      });
    });

    it("normalizes tool-output-delta", () => {
      const result = normalize(makeToolOutputDelta("toolu_abc", "partial output"));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "tool_output_delta",
        callId: "toolu_abc",
        delta: "partial output",
      });
    });

    it("parses string JSON input into object", () => {
      const result = normalize(makeToolStarted("toolu_abc", "think", '{"thought":"test"}'));
      expect(result[0]).toMatchObject({
        kind: "tool_started",
        input: { thought: "test" },
      });
    });

    it("handles malformed JSON input gracefully", () => {
      const result = normalize(makeToolStarted("toolu_abc", "think", "not json"));
      expect(result[0]).toMatchObject({
        kind: "tool_started",
        input: {},
      });
    });
  });

  // ── The tool result: the engine's envelope, rendered here (S4 M2 C2a) ──

  describe("tool-finished output → result string", () => {
    // Image/mixed content blocks (e.g. a computer-use screenshot). The result
    // must be the BLOCKS ARRAY serialized — not the LangChain envelope around
    // it — so the persist-time offload can detect the image and lift it into
    // a renderable ToolCallOutputRef.
    const imageBlock = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } };
    const resultOf = (output: unknown): string => {
      const [event] = normalize(makeToolFinished("toolu_x", output));
      if (event?.kind !== "tool_finished") throw new Error("expected one tool_finished");
      return event.result;
    };
    const envelope = (content: unknown) => ({
      lc: 1,
      type: "constructor",
      id: ["langchain_core", "messages", "ToolMessage"],
      kwargs: { status: "success", content },
    });

    it("passes a plain string output through unchanged", () => {
      expect(resultOf("just text")).toBe("just text");
    });

    it("unwraps a ToolMessage envelope to its text content", () => {
      expect(resultOf(envelope("hello"))).toBe("hello");
    });

    it("serializes the blocks array (not the envelope) when the content is an array", () => {
      const result = resultOf(envelope([{ type: "text", text: "shot" }, imageBlock]));
      expect(JSON.parse(result)).toEqual([{ type: "text", text: "shot" }, imageBlock]);
      expect(result).not.toContain("constructor");
      expect(result).not.toContain("langchain_core");
    });

    it("serializes the blocks array on a live ToolMessage-shaped object (obj.content)", () => {
      expect(JSON.parse(resultOf({ content: [imageBlock] }))).toEqual([imageBlock]);
    });

    it("falls back to JSON.stringify for unrecognized shapes", () => {
      expect(resultOf({ foo: "bar" })).toBe(JSON.stringify({ foo: "bar" }));
    });

    // Q-S4-21 (S4 M2 C2b): a state-mutating tool (deepagents' write_todos,
    // task) returns a LangGraph Command with its ToolMessage nested in the
    // update; the row shows that message's content, never the whole Command.
    it("unwraps a LangGraph Command to its ToolMessage's content", () => {
      const command = {
        lg_name: "Command",
        update: {
          todos: [{ content: "Read the fixture", status: "pending" }],
          messages: [envelope("Updated todo list to [...]")],
        },
        goto: [],
      };
      expect(resultOf(command)).toBe("Updated todo list to [...]");
    });

    it("unwraps a Command whose ToolMessage carries a blocks array to the array (the task tool's shape)", () => {
      const command = { lg_name: "Command", update: { files: {}, messages: [envelope([{ type: "text", text: "forty-two" }])] }, goto: [] };
      expect(JSON.parse(resultOf(command))).toEqual([{ type: "text", text: "forty-two" }]);
    });

    it("reads the LAST message of a Command that carries several, and serializes a Command with none as it came", () => {
      const several = { lg_name: "Command", update: { messages: [envelope("first"), envelope("the tool's reply")] } };
      expect(resultOf(several)).toBe("the tool's reply");
      const none = { lg_name: "Command", update: { todos: [] }, goto: [] };
      expect(resultOf(none)).toBe(JSON.stringify(none));
    });
  });

  // ── Usage, read beside the transcript (S4 M2 C1) ─────────────────

  describe("usageOf — what the loop reads off the wire", () => {
    it("reads a message-finish's usage, the cache buckets included", () => {
      expect(usageOf(makeMessageFinish("run-1", {
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_token_details: { cache_creation: 40, cache_read: 5 } },
      }))).toEqual({
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        input_token_details: { cache_creation: 40, cache_read: 5 },
      });
    });

    it("is undefined for a message-finish without usage", () => {
      expect(usageOf(makeMessageFinish("run-1"))).toBeUndefined();
    });

    it("ignores the standalone usage event — v3 emits both for one turn, and reading both would double-count", () => {
      expect(usageOf(makeUsageEvent("run-1", { input_tokens: 50, output_tokens: 10 }))).toBeUndefined();
    });

    it("reads a sub-agent's finish too — its spend is the execution's (S3 M2b, Q-M2b-1)", () => {
      expect(usageOf(makeMessageFinish("sub-run", {
        namespace: ["tools:task-1", "model_request:sub-run"],
        usage: { input_tokens: 600, output_tokens: 12 },
      }))).toMatchObject({ input_tokens: 600, output_tokens: 12 });
    });

    it("is undefined for every other channel", () => {
      expect(usageOf(makeTextDelta("run-1", "hi"))).toBeUndefined();
      expect(usageOf(makeToolFinished("toolu_abc", "ok"))).toBeUndefined();
      expect(usageOf(makeLifecycleCompleted("root"))).toBeUndefined();
    });
  });

  // ── Lifecycle channel: carried by the wire, not the transcript ───

  describe("lifecycle channel", () => {
    it("emits nothing for running", () => {
      expect(normalize(makeLifecycleRunning("root"))).toHaveLength(0);
    });

    it("emits nothing for completed", () => {
      expect(normalize(makeLifecycleCompleted("model_request", ["model_request:abc"]))).toHaveLength(0);
    });
  });

  // ── Ignored channels ─────────────────────────────────────────────

  describe("ignored channels", () => {
    it("returns empty for checkpoints", () => {
      expect(normalize(makeCheckpointEvent())).toHaveLength(0);
    });

    it("returns empty for tasks", () => {
      expect(normalize(makeTasksEvent())).toHaveLength(0);
    });

    it("returns empty for values", () => {
      expect(normalize(makeValuesEvent())).toHaveLength(0);
    });

    it("returns empty for updates", () => {
      expect(normalize(makeUpdatesEvent())).toHaveLength(0);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────

  describe("edge cases", () => {
    it("returns empty for unknown method", () => {
      const event = makeProtocolEvent("input", { event: "something" });
      expect(normalize(event)).toHaveLength(0);
    });

    it("returns empty for missing data", () => {
      const event = makeProtocolEvent("messages", undefined);
      expect(normalize(event)).toHaveLength(0);
    });

    it("returns empty for unknown message event type", () => {
      const event = makeProtocolEvent("messages", { event: "brand-new-thing", run_id: "r" });
      expect(normalize(event)).toHaveLength(0);
    });

    it("carries no namespace and no scope — the core is root-scoped; scope is the translator's (S4 M2 C4)", () => {
      const result = normalize(makeTextDelta("run-1", "hi", { namespace: ["tools:x", "model_request:y"] }));
      expect(result[0]).not.toHaveProperty("namespace");
      expect(result[0]).not.toHaveProperty("subAgentId");
    });

    it("carries neither seq nor node — the recorder keeps them on the raw event; no handler reads them", () => {
      const event = makeTextDelta("run-1", "hi");
      const result = normalize(event);
      expect(result[0]).not.toHaveProperty("seq");
      expect(result[0]).not.toHaveProperty("node");
    });

    it("handles delta with no type gracefully", () => {
      const event = makeProtocolEvent("messages", {
        event: "content-block-delta",
        index: 0,
        delta: {},
        run_id: "run-1",
      });
      expect(normalize(event)).toHaveLength(0);
    });

    it("handles missing tool_call_id in tool-started", () => {
      const event = makeProtocolEvent("tools", {
        event: "tool-started",
        tool_name: "read_file",
      }, { namespace: ["tools:abc"] });
      const result = normalize(event);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ kind: "tool_started", callId: "" });
    });
  });

  // ── Scope and the sub-agent lifecycle: the translator over the core (S4 M2 C4) ──

  describe("DeepAgentTranslator — scope by LangGraph namespace, a sub-agent per task call", () => {
    const TASK_NS = ["tools:pregel-1"];
    const CHILD_NS = ["tools:pregel-1", "model_request:inner-1"];
    const CHILD_TOOL_NS = ["tools:pregel-1", "tools:inner-tool"];

    function translator(): DeepAgentTranslator {
      return new DeepAgentTranslator(null);
    }

    it("a root event carries no subAgentId", () => {
      const [event] = translator().translate(makeTextDelta("run-1", "hi"));
      expect(event).toEqual({ kind: "text_delta", runId: "run-1", text: "hi" });
    });

    it("a task start at depth 1 opens a sub-agent BEFORE its own row, keyed by the call id, named from its args", () => {
      const events = translator().translate(
        makeToolStarted("task-1", "task", { subagent_type: "helper", description: "Look it up." }, { namespace: TASK_NS }),
      );
      expect(events.map((e) => e.kind)).toEqual(["sub_agent_started", "tool_started"]);
      expect(events[0]).toEqual({
        kind: "sub_agent_started",
        subAgentId: "task-1",
        name: "helper",
        subject: "Look it up.",
        input: "Look it up.",
      });
      expect(events[1]).toMatchObject({ kind: "tool_started", callId: "task-1", name: "task" });
      expect(events[1]).not.toHaveProperty("subAgentId");
    });

    it("a task start with no subagent_type is named after the tool", () => {
      const [opened] = translator().translate(makeToolStarted("task-2", "task", {}, { namespace: TASK_NS }));
      expect(opened).toMatchObject({ kind: "sub_agent_started", name: "task", subject: "", input: "" });
    });

    it("events under a registered prefix, two or more segments deep, are the sub-agent's", () => {
      const t = translator();
      t.translate(makeToolStarted("task-1", "task", { subagent_type: "helper" }, { namespace: TASK_NS }));
      const [text] = t.translate(makeTextDelta("inner-1", "Working.", { namespace: CHILD_NS }));
      expect(text).toEqual({ kind: "text_delta", runId: "inner-1", text: "Working.", subAgentId: "task-1" });
      const [tool] = t.translate(makeToolStarted("inner-tool", "grep", { pattern: "x" }, { namespace: CHILD_TOOL_NS }));
      expect(tool).toMatchObject({ kind: "tool_started", callId: "inner-tool", subAgentId: "task-1", mcpServerSlug: "" });
    });

    it("a task start INSIDE a sub-agent is an ordinary row of that sub-agent — one level of delegation is tracked", () => {
      const t = translator();
      t.translate(makeToolStarted("task-1", "task", { subagent_type: "helper" }, { namespace: TASK_NS }));
      const events = t.translate(makeToolStarted("nested", "task", { subagent_type: "deeper" }, { namespace: CHILD_TOOL_NS }));
      expect(events.map((e) => e.kind)).toEqual(["tool_started"]);
      expect(events[0]).toMatchObject({ subAgentId: "task-1" });
    });

    it("a nested namespace whose prefix nobody registered folds into the root (F-M2-17)", () => {
      const [event] = translator().translate(makeTextDelta("r", "hi", { namespace: ["tools:unknown", "model_request:x"] }));
      expect(event).not.toHaveProperty("subAgentId");
    });

    it("a one-segment event under a registered prefix is the ROOT's — the task row's own lifecycle", () => {
      const t = translator();
      t.translate(makeToolStarted("task-1", "task", { subagent_type: "helper" }, { namespace: TASK_NS }));
      const [finished] = t.translate(makeToolOutputDelta("task-1", "…", { namespace: TASK_NS }));
      expect(finished).not.toHaveProperty("subAgentId");
    });

    it("the task's finish closes the sub-agent AFTER the row's own finish, with the same result as its output", () => {
      const t = translator();
      t.translate(makeToolStarted("task-1", "task", { subagent_type: "helper" }, { namespace: TASK_NS }));
      const events = t.translate(makeToolFinished("task-1", "forty-two", { namespace: TASK_NS }));
      expect(events).toEqual([
        { kind: "tool_finished", callId: "task-1", result: "forty-two" },
        { kind: "sub_agent_finished", subAgentId: "task-1", output: "forty-two" },
      ]);
    });

    it("the task's error fails the sub-agent after the row's own error", () => {
      const t = translator();
      t.translate(makeToolStarted("task-1", "task", { subagent_type: "helper" }, { namespace: TASK_NS }));
      const events = t.translate(makeToolError("task-1", "boom", { namespace: TASK_NS }));
      expect(events).toEqual([
        { kind: "tool_error", callId: "task-1", message: "boom" },
        { kind: "sub_agent_failed", subAgentId: "task-1", error: "boom" },
      ]);
    });

    it("an ordinary tool's finish closes no sub-agent", () => {
      const t = translator();
      const events = t.translate(makeToolFinished("toolu_1", "ok"));
      expect(events.map((e) => e.kind)).toEqual(["tool_finished"]);
    });

    it("a depth-0 task start (no namespace) still opens a sub-agent, under a synthetic prefix its children can name", () => {
      const t = translator();
      const events = t.translate(makeToolStarted("task-0", "task", { subagent_type: "w" }, { namespace: [] }));
      expect(events[0]).toMatchObject({ kind: "sub_agent_started", subAgentId: "task-0" });
      const [child] = t.translate(makeTextDelta("in", "hi", { namespace: ["tools:task-0", "model_request:in"] }));
      expect(child).toMatchObject({ subAgentId: "task-0" });
    });

    it("attributes root calls only: a sub-agent's tool start carries no server and no provenance even under a gate", () => {
      const t = new DeepAgentTranslator({
        policies: new Map(),
        toolServerMap: new Map([["grep", "search-server"]]),
        leasedCategories: new Set(),
        globalBypass: false,
        unattended: false,
        unattendedSkips: new Set(),
      });
      t.translate(makeToolStarted("task-1", "task", { subagent_type: "helper" }, { namespace: TASK_NS }));
      const [root] = t.translate(makeToolStarted("root-grep", "grep", {}));
      expect(root).toMatchObject({ mcpServerSlug: "search-server", provenance: "classifier_default" });
      const [sub] = t.translate(makeToolStarted("sub-grep", "grep", {}, { namespace: CHILD_TOOL_NS }));
      expect(sub).toMatchObject({ subAgentId: "task-1", mcpServerSlug: "" });
      expect(sub).not.toHaveProperty("provenance");
    });
  });
});
