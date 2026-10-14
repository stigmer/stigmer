/**
 * `TranscriptState` and `Transcript` (`harness/transcript/state.ts`): the
 * per-scope bookkeeping the builder folds through — indexes over the live
 * proto, never copies; seeded rows indexed at construction; the seed's last
 * AI message as a scope's starting point.
 *
 * Restated in #1097 over the per-scope shape from
 * the two files that pinned the namespace-keyed maps and the explicit
 * `rebuildToolCallIndex` (`state.test.ts`, `state-extended.test.ts` — the
 * latter ported from the Python HITL/checkpoint contract tests). Every arm
 * kept in meaning; the four `resetEphemeralState` arms went with the method,
 * which had no production caller.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Transcript, TranscriptState } from "../state.js";
import { AgentMessageSchema, ToolCallSchema, SubAgentRunSchema, TurnRowsSchema } from "../../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { MessageType, SubAgentStatus, ToolCallStatus } from "../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";

function toolCall(id: string, name: string, status = ToolCallStatus.TOOL_CALL_COMPLETED) {
  return create(ToolCallSchema, { id, name, status });
}

function aiMessage(content: string, toolCalls: ReturnType<typeof toolCall>[] = []) {
  return create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content, toolCalls });
}

/** Two AI turns with three rows between them — the persisted transcript a reinvocation seeds. */
function seededStatus() {
  const status = create(TurnRowsSchema, {});
  status.messages.push(aiMessage("test", [toolCall("tc-1", "read"), toolCall("tc-2", "write", ToolCallStatus.TOOL_CALL_RUNNING)]));
  status.messages.push(aiMessage("turn 2", [toolCall("tc-3", "search", ToolCallStatus.TOOL_CALL_WAITING_APPROVAL)]));
  return status;
}

describe("Transcript", () => {
  it("starts empty over an empty messages array", () => {
    const t = new Transcript([]);
    expect(t.toolCalls.size).toBe(0);
    expect(t.messagesByRun.size).toBe(0);
    expect(t.currentAiMessage).toBeUndefined();
    expect(t.lastRunId).toBeUndefined();
    expect(t.argBuffers.size).toBe(0);
  });

  it("indexes every seeded row by id, sharing the proto's own references", () => {
    const status = seededStatus();
    const t = new Transcript(status.messages);
    expect([...t.toolCalls.keys()].sort()).toEqual(["tc-1", "tc-2", "tc-3"]);
    expect(t.toolCalls.get("tc-1")).toBe(status.messages[0].toolCalls[0]);
    expect(t.toolCalls.get("tc-3")).toBe(status.messages[1].toolCalls[0]);
    expect(t.toolCalls.get("tc-2")!.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
    // A mutation through the index IS the mutation of the proto.
    t.toolCalls.get("tc-2")!.status = ToolCallStatus.TOOL_CALL_COMPLETED;
    expect(status.messages[0].toolCalls[1].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });

  it("skips a seeded row with an empty id", () => {
    const messages = [aiMessage("x", [toolCall("", "anon"), toolCall("tc-ok", "read")])];
    const t = new Transcript(messages);
    expect([...t.toolCalls.keys()]).toEqual(["tc-ok"]);
  });

  it("starts on the seed's LAST AI message, skipping a trailing non-AI row", () => {
    const status = seededStatus();
    status.messages.push(create(AgentMessageSchema, { type: MessageType.MESSAGE_SYSTEM, content: "paused" }));
    const t = new Transcript(status.messages);
    expect(t.currentAiMessage).toBe(status.messages[1]);
    expect(t.currentAiMessage!.content).toBe("turn 2");
  });

  it("has no current AI message when the seed carries only non-AI rows", () => {
    const messages = [create(AgentMessageSchema, { type: MessageType.MESSAGE_THINKING, content: "hm" })];
    expect(new Transcript(messages).currentAiMessage).toBeUndefined();
  });

  it("folds INTO the array it was handed, never a replacement", () => {
    const status = seededStatus();
    const t = new Transcript(status.messages);
    t.messages.push(aiMessage("appended"));
    expect(status.messages).toHaveLength(3);
    expect(status.messages[2].content).toBe("appended");
  });
});

describe("TranscriptState", () => {
  it("exposes the rows and the status it was handed and a root transcript over the rows' messages", () => {
    const status = seededStatus();
    const run = create(RunStatusSchema);
    const state = new TranscriptState(status, run);
    expect(state.rows).toBe(status);
    expect(state.status).toBe(run);
    expect(state.root.messages).toBe(status.messages);
    expect(state.root.toolCalls.size).toBe(3);
  });

  it("scope(undefined) is the root; an unknown sub-agent id has no scope", () => {
    const state = new TranscriptState(create(TurnRowsSchema, {}), create(RunStatusSchema));
    expect(state.scope(undefined)).toBe(state.root);
    expect(state.scope("nobody")).toBeUndefined();
    expect(state.subAgent("nobody")).toBeUndefined();
  });

  it("indexes every seeded sub-agent row and its rows at construction", () => {
    const status = create(TurnRowsSchema, {});
    const row = create(SubAgentRunSchema, {
      id: "task-1",
      name: "helper",
      status: SubAgentStatus.SUB_AGENT_IN_PROGRESS,
      messages: [aiMessage("sub says", [toolCall("sub-tc", "grep")])],
    });
    status.subAgentRuns.push(row);
    const state = new TranscriptState(status, create(RunStatusSchema));
    const scope = state.subAgent("task-1")!;
    expect(scope.row).toBe(row);
    expect(scope.transcript.messages).toBe(row.messages);
    expect(scope.transcript.toolCalls.get("sub-tc")).toBe(row.messages[0].toolCalls[0]);
    expect(scope.transcript.currentAiMessage).toBe(row.messages[0]);
    expect(state.scope("task-1")).toBe(scope.transcript);
  });

  it("openSubAgent pushes the row onto the status's own array and opens its transcript", () => {
    const status = create(TurnRowsSchema, {});
    const state = new TranscriptState(status, create(RunStatusSchema));
    const row = create(SubAgentRunSchema, { id: "task-2", name: "worker" });
    const scope = state.openSubAgent(row);
    expect(status.subAgentRuns).toEqual([row]);
    expect(scope.transcript.messages).toBe(row.messages);
    expect(state.subAgent("task-2")).toBe(scope);
  });

  it("transcripts() yields the root first, then every sub-agent's", () => {
    const status = create(TurnRowsSchema, {});
    status.subAgentRuns.push(create(SubAgentRunSchema, { id: "a" }), create(SubAgentRunSchema, { id: "b" }));
    const state = new TranscriptState(status, create(RunStatusSchema));
    const all = [...state.transcripts()];
    expect(all).toHaveLength(3);
    expect(all[0]).toBe(state.root);
    expect(all[1]).toBe(state.subAgent("a")!.transcript);
    expect(all[2]).toBe(state.subAgent("b")!.transcript);
  });
});
