/**
 * Pins the Claude translator (`translator.ts`): one engine message in, the
 * transcript events out, built from the SDK's own message types.
 *
 * What it pins: the streamed model call as message_start, text and reasoning
 * deltas, tool_started then tool_arg_delta, and message_finish; the whole
 * assistant message that follows only reconciling a call's full input; a
 * call that never streamed (a sub-agent's) folded from its blocks; a tool
 * result settling its row as tool_finished or tool_error, the gate's
 * provenance stamped first; an `Agent` call opening and closing its
 * sub-agent row, its messages scoped to it; a compaction marked; the host's
 * aliased shell reported as `Bash`; and the result text a row carries.
 *
 * Why it matters: the rows are what a person reads of the turn. A whole
 * message re-emitting streamed text would double it, an aliased name
 * reaching a row would leak the host's plumbing, and a result settled
 * without its provenance would hide which policy layer let a call run.
 */

import { describe, it, expect } from "vitest";
import type {
  SDKAssistantMessage,
  SDKCompactBoundaryMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultSuccess,
  SDKStatusMessage,
  SDKUserMessage,
  SDKUserMessageReplay,
} from "@anthropic-ai/claude-agent-sdk";

import { ROOT_CALLER, type GateVerdict } from "../gate.js";
import { agentAnswerOf, ClaudeTranslator, resultText, type ClaudeTranslatorDeps } from "../translator.js";

type StreamEvent = SDKPartialAssistantMessage["event"];
type AssistantContent = SDKAssistantMessage["message"]["content"];
type UserContent = SDKUserMessage["message"]["content"];

const UUID = "00000000-0000-4000-8000-000000000001";

function stream(event: StreamEvent, parent: string | null = null): SDKPartialAssistantMessage {
  return { type: "stream_event", event, parent_tool_use_id: parent, uuid: UUID, session_id: "s" };
}

function messageStart(id: string, parent: string | null = null): SDKPartialAssistantMessage {
  return stream({ type: "message_start", message: { id, usage: { input_tokens: 1, output_tokens: 0 } } } as StreamEvent, parent);
}

function toolBlockStart(index: number, id: string, name: string, parent: string | null = null): SDKPartialAssistantMessage {
  return stream({ type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } } as StreamEvent, parent);
}

function textBlockStart(index: number, parent: string | null = null): SDKPartialAssistantMessage {
  return stream({ type: "content_block_start", index, content_block: { type: "text", text: "" } } as StreamEvent, parent);
}

function textDelta(index: number, text: string, parent: string | null = null): SDKPartialAssistantMessage {
  return stream({ type: "content_block_delta", index, delta: { type: "text_delta", text } }, parent);
}

function thinkingDelta(index: number, thinking: string, parent: string | null = null): SDKPartialAssistantMessage {
  return stream({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking, estimated_tokens: null } }, parent);
}

function inputDelta(index: number, partialJson: string, parent: string | null = null): SDKPartialAssistantMessage {
  return stream({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: partialJson } }, parent);
}

function messageStop(parent: string | null = null): SDKPartialAssistantMessage {
  return stream({ type: "message_stop" }, parent);
}

function assistant(id: string, content: readonly unknown[], parent: string | null = null): SDKAssistantMessage {
  return {
    type: "assistant",
    message: { id, type: "message", role: "assistant", content: content as AssistantContent } as SDKAssistantMessage["message"],
    parent_tool_use_id: parent,
    uuid: UUID,
    session_id: "s",
  };
}

function toolResult(toolUseId: string, content: unknown, isError?: boolean): unknown {
  return { type: "tool_result", tool_use_id: toolUseId, content, ...(isError === undefined ? {} : { is_error: isError }) };
}

function user(content: readonly unknown[] | string, parent: string | null = null): SDKUserMessage {
  return { type: "user", message: { role: "user", content: content as UserContent }, parent_tool_use_id: parent };
}

/** The gate's allow for a main-agent call under `source`. */
function allowVerdict(source: GateVerdict["source"]): GateVerdict {
  return { kind: "allow", source, caller: ROOT_CALLER, toolName: "Read", args: {}, rewritten: false, hook: undefined, context: [] };
}

function translator(overrides: Partial<ClaudeTranslatorDeps> = {}): ClaudeTranslator {
  return new ClaudeTranslator({ serverOf: () => undefined, verdictOf: () => undefined, ...overrides });
}

describe("ClaudeTranslator: the streamed model call", () => {
  it("opens a segment on message_start, streams text and reasoning, and finishes on message_stop", () => {
    const t = translator();
    expect(t.translate(messageStart("msg_1"))).toEqual([{ kind: "message_start", runId: "msg_1" }]);
    expect(t.translate(textBlockStart(0))).toEqual([]);
    expect(t.translate(thinkingDelta(0, "pondering"))).toEqual([{ kind: "reasoning_delta", runId: "msg_1", text: "pondering" }]);
    expect(t.translate(textDelta(1, "Hello"))).toEqual([{ kind: "text_delta", runId: "msg_1", text: "Hello" }]);
    expect(t.translate(messageStop())).toEqual([{ kind: "message_finish", runId: "msg_1" }]);
  });

  it("makes nothing of a whole assistant message whose text already streamed", () => {
    const t = translator();
    t.translate(messageStart("msg_1"));
    t.translate(textDelta(0, "Hello"));
    t.translate(messageStop());
    expect(t.translate(assistant("msg_1", [{ type: "text", text: "Hello" }]))).toEqual([]);
    expect(t.translate(assistant("msg_1", [{ type: "thinking", thinking: "pondering", signature: "sig" }]))).toEqual([]);
  });

  it("opens a tool row with no input when its block starts, streams its arguments, and reconciles the whole input after", () => {
    const t = translator();
    t.translate(messageStart("msg_1"));
    expect(t.translate(toolBlockStart(1, "toolu_1", "Read"))).toEqual([{ kind: "tool_started", callId: "toolu_1", name: "Read", input: {}, mcpServerSlug: "" }]);
    expect(t.translate(inputDelta(1, '{"file_path":'))).toEqual([{ kind: "tool_arg_delta", callId: "toolu_1", argsChunk: '{"file_path":' }]);
    expect(t.translate(inputDelta(1, '"/a.txt"}'))).toEqual([{ kind: "tool_arg_delta", callId: "toolu_1", argsChunk: '"/a.txt"}' }]);
    t.translate(messageStop());
    expect(t.translate(assistant("msg_1", [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/a.txt" } }]))).toEqual([
      { kind: "tool_started", callId: "toolu_1", name: "Read", input: { file_path: "/a.txt" }, mcpServerSlug: "" },
    ]);
  });

  it("makes nothing of a re-announced call whose whole input is empty, once its row is open", () => {
    const t = translator();
    t.translate(messageStart("msg_1"));
    t.translate(toolBlockStart(0, "toolu_1", "TodoWrite"));
    expect(t.translate(assistant("msg_1", [{ type: "tool_use", id: "toolu_1", name: "TodoWrite", input: {} }]))).toEqual([]);
  });

  it("reads a tool input that is not an object as empty", () => {
    const t = translator();
    expect(t.translate(assistant("msg_2", [{ type: "tool_use", id: "toolu_9", name: "Glob", input: ["not", "an", "object"] }]))).toEqual([
      { kind: "tool_started", callId: "toolu_9", name: "Glob", input: {}, mcpServerSlug: "" },
    ]);
  });

  it("makes nothing of an argument delta for a block that opened no call, nor of a delta it does not carry", () => {
    const t = translator();
    t.translate(messageStart("msg_1"));
    t.translate(textBlockStart(0));
    expect(t.translate(inputDelta(0, "{}"))).toEqual([]);
    expect(t.translate(stream({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }))).toEqual([]);
  });

  it("makes nothing of block and stop events that arrive with no segment open", () => {
    const t = translator();
    expect(t.translate(toolBlockStart(0, "toolu_1", "Read"))).toEqual([]);
    expect(t.translate(textDelta(0, "orphan"))).toEqual([]);
    expect(t.translate(messageStop())).toEqual([]);
  });

  it("makes nothing of the stream's other events", () => {
    const t = translator();
    t.translate(messageStart("msg_1"));
    expect(t.translate(stream({ type: "content_block_stop", index: 0 }))).toEqual([]);
    expect(t.translate(stream({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } } as StreamEvent))).toEqual([]);
  });

  it("keeps the root's and a sub-agent's streams apart, each event scoped to its own", () => {
    const t = translator();
    t.translate(messageStart("msg_root"));
    expect(t.translate(messageStart("msg_sub", "toolu_agent"))).toEqual([{ kind: "message_start", runId: "msg_sub", subAgentId: "toolu_agent" }]);
    expect(t.translate(textDelta(0, "sub text", "toolu_agent"))).toEqual([{ kind: "text_delta", runId: "msg_sub", text: "sub text", subAgentId: "toolu_agent" }]);
    expect(t.translate(textDelta(0, "root text"))).toEqual([{ kind: "text_delta", runId: "msg_root", text: "root text" }]);
    expect(t.translate(toolBlockStart(1, "toolu_sub_read", "Read", "toolu_agent"))).toEqual([
      { kind: "tool_started", callId: "toolu_sub_read", name: "Read", input: {}, mcpServerSlug: "", subAgentId: "toolu_agent" },
    ]);
    expect(t.translate(inputDelta(1, "{}", "toolu_agent"))).toEqual([{ kind: "tool_arg_delta", callId: "toolu_sub_read", argsChunk: "{}", subAgentId: "toolu_agent" }]);
    expect(t.translate(messageStop("toolu_agent"))).toEqual([{ kind: "message_finish", runId: "msg_sub", subAgentId: "toolu_agent" }]);
    expect(t.translate(messageStop())).toEqual([{ kind: "message_finish", runId: "msg_root" }]);
  });
});

describe("ClaudeTranslator: a call that never streamed", () => {
  it("folds a whole message's text and thinking into one segment, scoped to its sub-agent", () => {
    const t = translator();
    expect(
      t.translate(
        assistant(
          "msg_sub",
          [
            { type: "thinking", thinking: "hmm", signature: "sig" },
            { type: "text", text: "found it" },
          ],
          "toolu_agent",
        ),
      ),
    ).toEqual([
      { kind: "message_start", runId: "msg_sub", subAgentId: "toolu_agent" },
      { kind: "reasoning_delta", runId: "msg_sub", text: "hmm", subAgentId: "toolu_agent" },
      { kind: "text_delta", runId: "msg_sub", text: "found it", subAgentId: "toolu_agent" },
      { kind: "message_finish", runId: "msg_sub", subAgentId: "toolu_agent" },
    ]);
  });

  it("opens no segment for a whole message holding only a tool call, or only a block it does not carry", () => {
    const t = translator();
    expect(t.translate(assistant("msg_a", [{ type: "tool_use", id: "toolu_1", name: "Grep", input: { pattern: "x" } }]))).toEqual([
      { kind: "tool_started", callId: "toolu_1", name: "Grep", input: { pattern: "x" }, mcpServerSlug: "" },
    ]);
    expect(t.translate(assistant("msg_b", [{ type: "redacted_thinking", data: "opaque" }]))).toEqual([]);
  });
});

describe("ClaudeTranslator: tool results", () => {
  it("settles a call as finished with its text", () => {
    const t = translator();
    expect(t.translate(user([toolResult("toolu_1", "file contents")]))).toEqual([{ kind: "tool_finished", callId: "toolu_1", result: "file contents" }]);
  });

  it("settles a call the engine marks an error as tool_error", () => {
    const t = translator();
    expect(t.translate(user([toolResult("toolu_1", "Permission denied", true)]))).toEqual([{ kind: "tool_error", callId: "toolu_1", message: "Permission denied" }]);
  });

  it("stamps the gate's provenance before the settle, so the row says which layer decided", () => {
    const verdicts = new Map<string, GateVerdict>([
      ["toolu_allowed", allowVerdict("approval_lease")],
      ["toolu_refused", { kind: "refuse", message: "no", source: "builtin_category", caller: ROOT_CALLER, hook: undefined, byPerson: false }],
    ]);
    const t = translator({ verdictOf: (id) => verdicts.get(id) });
    expect(t.translate(user([toolResult("toolu_allowed", "ok")]))).toEqual([
      { kind: "tool_policy", callId: "toolu_allowed", provenance: "approval_lease", policyHook: "" },
      { kind: "tool_finished", callId: "toolu_allowed", result: "ok" },
    ]);
    expect(t.translate(user([toolResult("toolu_refused", "no", true)]))).toEqual([
      { kind: "tool_policy", callId: "toolu_refused", provenance: "builtin_category", policyHook: "" },
      { kind: "tool_error", callId: "toolu_refused", message: "no" },
    ]);
  });

  it("stamps no provenance when the gate's verdict names no source", () => {
    const t = translator({ verdictOf: () => allowVerdict(undefined) });
    expect(t.translate(user([toolResult("toolu_1", "ok")]))).toEqual([{ kind: "tool_finished", callId: "toolu_1", result: "ok" }]);
  });

  it("names the hook that decided on the row", () => {
    const t = translator({ verdictOf: () => ({ ...allowVerdict("hook"), hook: "safety" }) });
    expect(t.translate(user([toolResult("toolu_1", "ok")]))).toEqual([
      { kind: "tool_policy", callId: "toolu_1", provenance: "hook", policyHook: "safety" },
      { kind: "tool_finished", callId: "toolu_1", result: "ok" },
    ]);
  });

  it("leaves a call a person refused to the runtime: neither its provenance nor the engine's refusal reaches its row", () => {
    const t = translator({ verdictOf: () => ({ kind: "refuse", message: "rejected", source: undefined, caller: ROOT_CALLER, hook: undefined, byPerson: true }) });
    expect(t.translate(user([toolResult("toolu_1", "Tool 'Bash' was rejected by the user.", true)]))).toEqual([]);
  });

  it("appends the hooks' feedback to the call's row, on a success and a failure alike", () => {
    const t = translator({ feedbackOf: (id) => (id === "toolu_quiet" ? undefined : "Hook feedback:\nlogged") });
    expect(t.translate(user([toolResult("toolu_1", "ok"), toolResult("toolu_2", "boom", true), toolResult("toolu_quiet", "plain")]))).toEqual([
      { kind: "tool_finished", callId: "toolu_1", result: "ok\n\nHook feedback:\nlogged" },
      { kind: "tool_error", callId: "toolu_2", message: "boom\n\nHook feedback:\nlogged" },
      { kind: "tool_finished", callId: "toolu_quiet", result: "plain" },
    ]);
  });

  it("scopes a sub-agent's tool result to it", () => {
    const t = translator();
    expect(t.translate(user([toolResult("toolu_sub", "ok", false)], "toolu_agent"))).toEqual([
      { kind: "tool_finished", callId: "toolu_sub", result: "ok", subAgentId: "toolu_agent" },
    ]);
  });

  it("settles each result of a message and skips blocks that are not results", () => {
    const t = translator();
    expect(t.translate(user([{ type: "text", text: "note" }, toolResult("toolu_1", "a"), toolResult("toolu_2", [{ type: "text", text: "b" }])]))).toEqual([
      { kind: "tool_finished", callId: "toolu_1", result: "a" },
      { kind: "tool_finished", callId: "toolu_2", result: "b" },
    ]);
  });

  it("makes nothing of a person's plain message, nor of a replayed one", () => {
    const t = translator();
    expect(t.translate(user("hello"))).toEqual([]);
    const replay: SDKUserMessageReplay = {
      type: "user",
      message: { role: "user", content: [toolResult("toolu_1", "old")] as UserContent },
      parent_tool_use_id: null,
      uuid: UUID,
      session_id: "s",
      isReplay: true,
    };
    expect(t.translate(replay)).toEqual([]);
  });
});

describe("ClaudeTranslator: sub-agents", () => {
  const agentInput = { subagent_type: "general-purpose", description: "Survey the repo", prompt: "List the packages." };

  it("opens the sub-agent row before its call's row, and closes it when the call finishes", () => {
    const t = translator();
    expect(t.translate(assistant("msg_1", [{ type: "tool_use", id: "toolu_agent", name: "Agent", input: agentInput }]))).toEqual([
      { kind: "sub_agent_started", subAgentId: "toolu_agent", name: "general-purpose", subject: "Survey the repo", input: "List the packages." },
      { kind: "tool_started", callId: "toolu_agent", name: "Agent", input: agentInput, mcpServerSlug: "" },
    ]);
    expect(t.translate(user([toolResult("toolu_agent", "three packages")]))).toEqual([
      { kind: "tool_finished", callId: "toolu_agent", result: "three packages" },
      { kind: "sub_agent_finished", subAgentId: "toolu_agent", output: "three packages" },
    ]);
  });

  it("carries the sub-agent's own answer from the structured result, never the engine's hand-back frame", () => {
    const t = translator();
    t.translate(assistant("msg_1", [{ type: "tool_use", id: "toolu_agent", name: "Agent", input: agentInput }]));
    const framed = "[Subagent hand-back] The report follows:\n  three packages\nagentId: a1b2\n<usage>duration_ms: 55</usage>";
    const result = { ...user([toolResult("toolu_agent", [{ type: "text", text: framed }])]), tool_use_result: { status: "completed", agentId: "a1b2", content: [{ type: "text", text: "three packages" }, { type: "text", text: "and a script" }] } } as SDKUserMessage;
    expect(t.translate(result)).toEqual([
      { kind: "tool_finished", callId: "toolu_agent", result: "three packages\nand a script" },
      { kind: "sub_agent_finished", subAgentId: "toolu_agent", output: "three packages\nand a script" },
    ]);
  });

  it("falls back to the result's text when the structured result carries no answer", () => {
    expect(agentAnswerOf(undefined)).toBeUndefined();
    expect(agentAnswerOf({ content: "plain" })).toBeUndefined();
    expect(agentAnswerOf({ content: [{ type: "image" }] })).toBeUndefined();
  });

  it("fails the sub-agent row when its call errors, and settles it once", () => {
    const t = translator();
    t.translate(assistant("msg_1", [{ type: "tool_use", id: "toolu_agent", name: "Agent", input: agentInput }]));
    expect(t.translate(user([toolResult("toolu_agent", "crashed", true)]))).toEqual([
      { kind: "tool_error", callId: "toolu_agent", message: "crashed" },
      { kind: "sub_agent_failed", subAgentId: "toolu_agent", error: "crashed" },
    ]);
    expect(t.translate(user([toolResult("toolu_agent", "crashed", true)]))).toEqual([{ kind: "tool_error", callId: "toolu_agent", message: "crashed" }]);
  });

  it("opens the sub-agent row only once its input is known: a streamed start opens the call alone, the whole message the sub-agent", () => {
    const t = translator();
    t.translate(messageStart("msg_1"));
    expect(t.translate(toolBlockStart(0, "toolu_agent", "Agent"))).toEqual([{ kind: "tool_started", callId: "toolu_agent", name: "Agent", input: {}, mcpServerSlug: "" }]);
    t.translate(messageStop());
    expect(t.translate(assistant("msg_1", [{ type: "tool_use", id: "toolu_agent", name: "Agent", input: agentInput }]))).toEqual([
      { kind: "sub_agent_started", subAgentId: "toolu_agent", name: "general-purpose", subject: "Survey the repo", input: "List the packages." },
      { kind: "tool_started", callId: "toolu_agent", name: "Agent", input: agentInput, mcpServerSlug: "" },
    ]);
    expect(t.translate(assistant("msg_1", [{ type: "tool_use", id: "toolu_agent", name: "Agent", input: agentInput }]))).toEqual([
      { kind: "tool_started", callId: "toolu_agent", name: "Agent", input: agentInput, mcpServerSlug: "" },
    ]);
  });

  it("reads an Agent input's missing or non-string fields as empty", () => {
    const t = translator();
    expect(t.translate(assistant("msg_1", [{ type: "tool_use", id: "toolu_agent", name: "Agent", input: { prompt: 42 } }]))[0]).toEqual({
      kind: "sub_agent_started",
      subAgentId: "toolu_agent",
      name: "",
      subject: "",
      input: "",
    });
  });
});

describe("ClaudeTranslator: names", () => {
  it("reports the host's aliased shell as Bash, with no server slug, streamed or whole", () => {
    const t = translator({ serverOf: () => ({ slug: "stigmer" }) });
    t.translate(messageStart("msg_1"));
    expect(t.translate(toolBlockStart(0, "toolu_sh", "mcp__stigmer__bash"))).toEqual([{ kind: "tool_started", callId: "toolu_sh", name: "Bash", input: {}, mcpServerSlug: "" }]);
    expect(t.translate(assistant("msg_2", [{ type: "tool_use", id: "toolu_sh2", name: "mcp__stigmer__bash", input: { command: "ls" } }]))).toEqual([
      { kind: "tool_started", callId: "toolu_sh2", name: "Bash", input: { command: "ls" }, mcpServerSlug: "" },
    ]);
  });

  it("carries a bridged server's slug on its tool's row, under the engine's name", () => {
    const t = translator({ serverOf: (name) => (name.startsWith("mcp__github__") ? { slug: "github" } : undefined) });
    expect(t.translate(assistant("msg_1", [{ type: "tool_use", id: "toolu_gh", name: "mcp__github__create_issue", input: { title: "x" } }]))).toEqual([
      { kind: "tool_started", callId: "toolu_gh", name: "mcp__github__create_issue", input: { title: "x" }, mcpServerSlug: "github" },
    ]);
  });
});

describe("ClaudeTranslator: everything else", () => {
  it("marks a compaction", () => {
    const boundary: SDKCompactBoundaryMessage = {
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: { trigger: "auto", pre_tokens: 150_000 },
      uuid: UUID,
      session_id: "s",
    };
    expect(translator().translate(boundary)).toEqual([{ kind: "context_compacted" }]);
  });

  it("makes nothing of the engine's other system messages, its result, or its status", () => {
    const t = translator();
    const status: SDKStatusMessage = { type: "system", subtype: "status", status: null, uuid: UUID, session_id: "s" };
    const result: SDKResultSuccess = {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
      num_turns: 1,
      duration_ms: 1,
      duration_api_ms: 1,
      stop_reason: "end_turn",
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 } as SDKResultSuccess["usage"],
      modelUsage: {},
      permission_denials: [],
      uuid: UUID,
      session_id: "s",
    };
    const messages: SDKMessage[] = [status, result];
    for (const message of messages) expect(t.translate(message)).toEqual([]);
  });
});

describe("resultText", () => {
  it("keeps a string as it is", () => {
    expect(resultText("plain")).toBe("plain");
  });

  it("joins text blocks and names any other block by its type", () => {
    expect(
      resultText([
        { type: "text", text: "line one" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
        { type: "text", text: "line two" },
        { type: "document" },
      ]),
    ).toBe("line one\n[image]\nline two\n[document]");
  });

  it("renders each tool a tool search loaded by its name", () => {
    expect(
      resultText([
        { type: "tool_reference", tool_name: "mcp__github__create_issue" },
        { type: "tool_reference", tool_name: "TodoWrite" },
      ]),
    ).toBe("mcp__github__create_issue\nTodoWrite");
  });

  it("names a tool reference without a string tool name by its type", () => {
    expect(resultText([{ type: "tool_reference", tool_name: 3 }, { type: "tool_reference" }])).toBe("[tool_reference]\n[tool_reference]");
  });

  it("settles a tool search's result with the loaded tools' names", () => {
    expect(translator().translate(user([toolResult("toolu_search", [{ type: "tool_reference", tool_name: "NotebookEdit" }])]))).toEqual([
      { kind: "tool_finished", callId: "toolu_search", result: "NotebookEdit" },
    ]);
  });

  it("names a text block without text by its type", () => {
    expect(resultText([{ type: "text", text: 7 }, {}])).toBe("[text]\n[undefined]");
  });

  it("reads anything else as empty", () => {
    expect(resultText(undefined)).toBe("");
    expect(resultText({ type: "text", text: "not a list" })).toBe("");
  });
});
