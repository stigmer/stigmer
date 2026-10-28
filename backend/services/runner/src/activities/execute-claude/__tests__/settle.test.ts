/**
 * Pins the Claude harness's settle (`settle.ts`) branch by branch, in its
 * documented order: the unattended skips folded first, then a lost
 * conversation, then a stop (sub-agents cancelled), then a missing result,
 * the engine's failed result, a call the engine could not resume, an
 * error-marked success, a deferral the turn proposed, the structured
 * output, and only then `completed`.
 *
 * Why the order matters: each earlier branch must win over every later one.
 * A turn whose conversation could not be saved fails `internal` even when it
 * was stopped or succeeded, since the next turn would resume from a
 * transcript with a hole; a stopped turn is `interrupted` whatever result the
 * engine left; and the skips are folded on every path, failure included.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { SDKResultError, SDKResultMessage, SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";

import { RecordingTurnSink } from "../../../__test-utils__/harness-contract/recording-sink.js";
import { ApprovalPolicySource, SubAgentStatus, ToolCallStatus } from "../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { DEFERRED_UNAVAILABLE_MESSAGE, settleClaudeTurn, type InvocationEnd } from "../settle.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const NO_USAGE = { input_tokens: 0, output_tokens: 0 } as SDKResultSuccess["usage"];

function success(overrides: Partial<SDKResultSuccess> = {}): SDKResultMessage {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "all done",
    errors: [],
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    stop_reason: "end_turn",
    total_cost_usd: 0,
    usage: NO_USAGE,
    modelUsage: {},
    permission_denials: [],
    uuid: "00000000-0000-4000-8000-000000000010",
    session_id: "s",
    ...overrides,
  } as SDKResultSuccess;
}

function failure(subtype: SDKResultError["subtype"], errors: string[]): SDKResultMessage {
  return {
    type: "result",
    subtype,
    is_error: true,
    errors,
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: NO_USAGE,
    modelUsage: {},
    permission_denials: [],
    uuid: "00000000-0000-4000-8000-000000000011",
    session_id: "s",
  } as SDKResultError;
}

function end(overrides: Partial<InvocationEnd> = {}): InvocationEnd {
  return {
    stopped: false,
    result: success(),
    mirrorError: undefined,
    unattendedSkips: new Map(),
    structuredOutput: false,
    awaitingApproval: false,
    ...overrides,
  };
}

/** A sink whose rows hold one root tool call and one running sub-agent. */
function sinkWithRows(): RecordingTurnSink {
  const sink = new RecordingTurnSink();
  sink.transcript.apply({ kind: "message_start", runId: "msg_1" });
  sink.transcript.apply({ kind: "tool_started", callId: "toolu_skip", name: "Bash", input: { command: "rm -rf build" }, mcpServerSlug: "" });
  sink.transcript.apply({ kind: "sub_agent_started", subAgentId: "toolu_agent", name: "general-purpose", subject: "look around", input: "look" });
  return sink;
}

function toolCall(sink: RecordingTurnSink, id: string) {
  return sink.rows.messages.flatMap((message) => message.toolCalls).find((call) => call.id === id);
}

describe("settleClaudeTurn", () => {
  it("folds the gate's unattended skips onto their rows on every path, a failure included", () => {
    const sink = sinkWithRows();
    const outcome = settleClaudeTurn(sink, end({ mirrorError: "store down", unattendedSkips: new Map([["toolu_skip", "hook-a"]]) }));
    expect(outcome.kind).toBe("failed");
    const call = toolCall(sink, "toolu_skip");
    expect(call?.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(call?.approvalPolicySource).toBe(ApprovalPolicySource.UNATTENDED_SKIP);
    expect(call?.approvalPolicyHook).toBe("hook-a");
  });

  it("fails internal, naming the lost history, when the store lost part of the conversation, ahead of a stop and a success", () => {
    const sink = sinkWithRows();
    const outcome = settleClaudeTurn(sink, end({ mirrorError: "append refused", stopped: true }));
    expect(outcome).toEqual({
      kind: "failed",
      surface: "internal",
      message: "Claude's conversation could not be saved (append refused), so the next turn would resume without part of it.",
    });
    expect(sink.rows.subAgentRuns[0]?.status).toBe(SubAgentStatus.SUB_AGENT_IN_PROGRESS);
  });

  it("is interrupted on a stop, cancelling every sub-agent still running, whatever result the engine left", () => {
    const sink = sinkWithRows();
    const outcome = settleClaudeTurn(sink, end({ stopped: true, result: failure("error_during_execution", ["boom"]) }));
    expect(outcome).toEqual({ kind: "interrupted" });
    expect(sink.rows.subAgentRuns[0]?.status).toBe(SubAgentStatus.SUB_AGENT_CANCELLED);
    expect(sink.rows.subAgentRuns[0]?.completedAt).toBeDefined();
  });

  it("is interrupted on a stop with no result at all", () => {
    expect(settleClaudeTurn(new RecordingTurnSink(), end({ stopped: true, result: undefined }))).toEqual({ kind: "interrupted" });
  });

  it("fails internal when the engine ended without a result", () => {
    expect(settleClaudeTurn(new RecordingTurnSink(), end({ result: undefined }))).toEqual({
      kind: "failed",
      surface: "internal",
      message: "The Claude Agent SDK ended without a result.",
    });
  });

  it("fails on the engine surface with the engine's own errors when its result failed", () => {
    expect(settleClaudeTurn(new RecordingTurnSink(), end({ result: failure("error_during_execution", ["first", "second"]) }))).toEqual({
      kind: "failed",
      surface: "engine",
      message: "The Claude Agent SDK failed: first; second",
    });
  });

  it("names the failed result's subtype when the engine gave no words", () => {
    expect(settleClaudeTurn(new RecordingTurnSink(), end({ result: failure("error_max_turns", []) }))).toEqual({
      kind: "failed",
      surface: "engine",
      message: "The Claude Agent SDK failed: error_max_turns",
    });
  });

  it("fails on the engine surface with the result's text when a success is marked an error", () => {
    expect(settleClaudeTurn(new RecordingTurnSink(), end({ result: success({ is_error: true, result: "API Error: 529 overloaded" }) }))).toEqual({
      kind: "failed",
      surface: "engine",
      message: "API Error: 529 overloaded",
    });
  });

  it("falls back to a plain failure when an error-marked success carries no text", () => {
    expect(settleClaudeTurn(new RecordingTurnSink(), end({ result: success({ is_error: true, result: "" }) }))).toEqual({
      kind: "failed",
      surface: "engine",
      message: "The Claude Agent SDK failed.",
    });
  });

  it("waits for a person when the engine stopped at a deferred call the turn proposed, unless the turn was stopped", () => {
    expect(settleClaudeTurn(sinkWithRows(), end({ awaitingApproval: true }))).toEqual({ kind: "awaiting_approval" });
    expect(settleClaudeTurn(sinkWithRows(), end({ awaitingApproval: true, stopped: true }))).toEqual({ kind: "interrupted" });
  });

  it("fails internal when the engine could not resume an answered call, its tool gone", () => {
    const unavailable = success({ is_error: true, result: "", terminal_reason: "tool_deferred_unavailable" } as Partial<SDKResultSuccess>);
    expect(settleClaudeTurn(sinkWithRows(), end({ result: unavailable }))).toEqual({ kind: "failed", surface: "internal", message: DEFERRED_UNAVAILABLE_MESSAGE });
  });

  it("completes a successful result and leaves a running sub-agent as it is", () => {
    const sink = sinkWithRows();
    expect(settleClaudeTurn(sink, end())).toEqual({ kind: "completed" });
    expect(sink.rows.subAgentRuns[0]?.status).toBe(SubAgentStatus.SUB_AGENT_IN_PROGRESS);
  });

  it("folds an object structured output onto the rows when the turn asked for one", () => {
    const sink = new RecordingTurnSink();
    const outcome = settleClaudeTurn(sink, end({ structuredOutput: true, result: success({ structured_output: { answer: "42", ok: true } }) }));
    expect(outcome).toEqual({ kind: "completed" });
    expect(sink.rows.structuredOutput).toEqual({ answer: "42", ok: true });
  });

  it("never folds a structured output the turn did not ask for", () => {
    const sink = new RecordingTurnSink();
    settleClaudeTurn(sink, end({ structuredOutput: false, result: success({ structured_output: { answer: "42" } }) }));
    expect(sink.rows.structuredOutput).toBeUndefined();
  });

  it("warns and folds nothing when the structured output is not an object", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const value of [[1, 2], "text", 7, null]) {
      const sink = new RecordingTurnSink();
      expect(settleClaudeTurn(sink, end({ structuredOutput: true, result: success({ structured_output: value }) }))).toEqual({ kind: "completed" });
      expect(sink.rows.structuredOutput).toBeUndefined();
    }
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls[0]?.[0]).toBe("[claude-settle] the engine's structured output is not an object: type=object");
    expect(warn.mock.calls[1]?.[0]).toBe("[claude-settle] the engine's structured output is not an object: type=string");
  });

  it("folds nothing and stays quiet when an asked-for structured output never came", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sink = new RecordingTurnSink();
    expect(settleClaudeTurn(sink, end({ structuredOutput: true }))).toEqual({ kind: "completed" });
    expect(sink.rows.structuredOutput).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});
