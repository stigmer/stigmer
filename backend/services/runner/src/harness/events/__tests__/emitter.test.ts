/**
 * Pins the session event emitter (`../emitter.ts`) on hand-built statuses:
 * the sealed prefix per thread, the boundary rule of a harness whose
 * boundary rewrites rows (a hook-blocked call writes nothing until the
 * terminal write, and narration after it reaches neither the log nor a
 * preview), the rows that are not the runner's to write, the turn-start
 * read, the per-event bound, previews, and what a failed or refused append
 * does. The hermetic event goldens prove the same through the real
 * activity on both harnesses.
 */

import { create, toBinary, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";
import { RunStatusSchema, type RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { MessageType, SubAgentStatus, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { AppendSessionEventsResponseSchema, type SessionEventPreview } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";

import { ELISION_MARKER } from "../../../shared/status-offload.js";
import { SESSION_EVENT_MAX_BYTES, SessionEventEmitter, type SessionEventEmitterDeps } from "../emitter.js";

const RUN = "run_01jz8k3q9w4e5r6t7y8u9i0o1p";
const AI = MessageType.MESSAGE_AI;
const S = ToolCallStatus;

/** A log double with the server's append rules; `refuse` and `fail` script one append's answer. */
function logDouble() {
  const events: SessionEvent[] = [];
  const previews: SessionEventPreview[] = [];
  const answers: Array<"refuse" | "fail"> = [];
  const appendSessionEvents = vi.fn(async (_run: string, batch: readonly SessionEvent[], sent: readonly SessionEventPreview[]) => {
    const answer = answers.shift();
    if (answer === "refuse") throw new ConnectError("bad event", Code.InvalidArgument);
    if (answer === "fail") throw new ConnectError("unavailable", Code.Unavailable);
    for (const event of batch) {
      if (toBinary(SessionEventSchema, event).length > SESSION_EVENT_MAX_BYTES) throw new ConnectError("too large", Code.InvalidArgument);
    }
    events.push(...batch);
    previews.push(...sent);
    return create(AppendSessionEventsResponseSchema);
  });
  const listRunSessionEvents = vi.fn(async () => [...events]);
  return { events, previews, answers, client: { appendSessionEvents, listRunSessionEvents } };
}

function emitter(log: ReturnType<typeof logDouble>, extra: Partial<SessionEventEmitterDeps> = {}): SessionEventEmitter {
  return new SessionEventEmitter({
    client: log.client,
    runId: RUN,
    credential: async () => undefined,
    delay: async () => {},
    ...extra,
  });
}

/** The event ids, in log order, with the run prefix dropped. */
function ids(log: ReturnType<typeof logDouble>): string[] {
  return log.events.map((e) => (e.event.case === undefined ? "" : e.event.value.id.slice(RUN.length + 1)));
}

function status(init: Parameters<typeof create<typeof RunStatusSchema>>[1]): RunStatus {
  return create(RunStatusSchema, init);
}

type RowInit = MessageInitShape<typeof ToolCallSchema>;

function row(id: string, init: RowInit = {}): RowInit {
  return { id, name: "read", status: S.TOOL_CALL_COMPLETED, result: "ok", ...init };
}

describe("the sealed prefix of a thread", () => {
  it("writes a message once it stops streaming, then its tool uses, then their results; an unsettled result holds back what follows", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = status({
      messages: [
        { type: AI, content: "Reading two files.", toolCalls: [row("a"), row("b", { status: S.TOOL_CALL_RUNNING, result: "" })] },
        { type: AI, content: "Both read." },
      ],
    });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(st, { final: false });
    expect(ids(log)).toEqual(["root.m0", "a", "b", "a.r"]);

    st.messages[0]!.toolCalls[1]!.status = S.TOOL_CALL_COMPLETED;
    st.messages[0]!.toolCalls[1]!.result = "done";
    await e.flush(st, { final: false });
    expect(ids(log)).toEqual(["root.m0", "a", "b", "a.r", "b.r", "root.m1"]);
  });

  it("holds a streaming message and everything after it; the terminal write writes it", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = status({ messages: [{ type: AI, content: "Thinking out lo", isStreaming: true }] });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(st, { final: false });
    expect(ids(log)).toEqual([]);
    await e.flush(st, { final: true });
    expect(ids(log)).toEqual(["root.m0"]);
  });

  it("an empty message, a hidden row and a call still running at the terminal write hold nothing back", async () => {
    const log = logDouble();
    const e = emitter(log);
    const hidden = row("h", { status: S.TOOL_CALL_SKIPPED, result: "", args: undefined });
    const st = status({
      messages: [
        { type: AI, content: "", toolCalls: [hidden, row("r", { status: S.TOOL_CALL_RUNNING, result: "" })] },
        { type: AI, content: "Stopped." },
      ],
    });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(st, { final: true });
    expect(ids(log)).toEqual(["r", "root.m1"]);
  });
});

describe("a harness whose boundary rewrites rows", () => {
  // The adapter's predicate decides which rows wait; this stand-in holds a
  // hook-blocked call, as Cursor's does (`execute-cursor/boundary-rows.ts`,
  // whose own test runs this emitter with the real predicate).
  const boundary = { boundaryRewritesRow: (tc: { error: string }) => tc.error.includes("blocked by a hook") };

  it("holds the row the boundary may rewrite, and everything after it, until the terminal write", async () => {
    const log = logDouble();
    const e = emitter(log, boundary);
    const st = status({
      messages: [
        { type: AI, content: "Reading.", toolCalls: [row("blocked", { status: S.TOOL_CALL_FAILED, result: "", error: "blocked by a hook" })] },
        { type: AI, content: "After the block." },
      ],
    });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    e.observe({ kind: "text_delta", runId: "seg-2", text: "After" }, { messageIndex: 1 });
    await e.flush(st, { final: false });
    expect(ids(log)).toEqual(["root.m0"]);
    expect(log.previews).toEqual([]);
    await e.flush(st, { final: true });
    expect(ids(log)).toEqual(["root.m0", "blocked", "blocked.r", "root.m1"]);
  });
});

describe("rows that are not the runner's to write", () => {
  it("skips seeded SYSTEM rows and a terminal arm's rows; any other SYSTEM row is a harness note", async () => {
    const log = logDouble();
    const e = emitter(log);
    const seeded = status({ messages: [{ type: AI, content: "Earlier." }, { type: MessageType.MESSAGE_SYSTEM, content: "Execution paused." }] });
    await e.begin({ sessionId: "ses_1", resumed: false, status: seeded });
    seeded.messages.push(
      create(AgentMessageSchema, { type: MessageType.MESSAGE_SYSTEM, content: "Platform tools are off." }),
      create(AgentMessageSchema, { type: MessageType.MESSAGE_SYSTEM, content: "Execution failed: boom" }),
    );
    e.skipRootRows([3]);
    await e.flush(seeded, { final: true });
    expect(ids(log)).toEqual(["root.m0", "root.n2"]);
  });
});

describe("its memory is the log", () => {
  it("a resumed turn reads back what the run wrote and resends none of it, whatever edits did to the rows", async () => {
    const log = logDouble();
    const first = emitter(log);
    const st = status({ messages: [{ type: AI, content: "I will run it.", toolCalls: [row("x", { name: "shell", status: S.TOOL_CALL_WAITING_APPROVAL, requiresApproval: true, result: "" })] }] });
    await first.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await first.flush(st, { final: true });
    expect(ids(log)).toEqual(["root.m0", "x", "x.ask"]);

    // Between invocations the status was elided and the row decided.
    st.messages[0]!.content = `I will run it.\n\n${ELISION_MARKER}`;
    st.messages[0]!.toolCalls[0]!.status = S.TOOL_CALL_COMPLETED;
    st.messages[0]!.toolCalls[0]!.result = "done";
    const second = emitter(log);
    await second.begin({ sessionId: "ses_1", resumed: true, status: st });
    await second.flush(st, { final: true });
    expect(ids(log)).toEqual(["root.m0", "x", "x.ask", "x.r"]);
    expect(log.client.appendSessionEvents.mock.calls.at(-1)![1].map((ev: SessionEvent) => ev.event.value?.id)).toEqual([`${RUN}.x.r`]);
  });

  it("a fresh turn does not read the log", async () => {
    const log = logDouble();
    await emitter(log).begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    expect(log.client.listRunSessionEvents).not.toHaveBeenCalled();
  });

  it("writes nothing before it begins", async () => {
    const log = logDouble();
    await emitter(log).flush(status({ messages: [{ type: AI, content: "early" }] }), { final: true });
    expect(log.client.appendSessionEvents).not.toHaveBeenCalled();
  });
});

describe("the bound", () => {
  it("an oversized write's tool use is bounded to the log's cap, not refused", async () => {
    const log = logDouble();
    const e = emitter(log);
    const body = "x".repeat(1024 * 1024);
    const st = status({ messages: [{ type: AI, content: "Writing.", toolCalls: [row("w", { name: "write", args: { path: "big.txt", content: body } })] }] });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(st, { final: true });
    expect(ids(log)).toEqual(["root.m0", "w", "w.r"]);
    const use = log.events[1]!;
    expect(toBinary(SessionEventSchema, use).length).toBeLessThanOrEqual(SESSION_EVENT_MAX_BYTES);
    expect(use.event.case === "agentToolUse" && String(use.event.value.input?.content)).toContain(ELISION_MARKER);
    expect(use.event.case === "agentToolUse" && use.event.value.input?.path).toBe("big.txt");
  });
});

describe("threads", () => {
  it("a task call opens its sub-agent's thread; the thread's events follow it and its result follows the thread's idle", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = status({
      messages: [{ type: AI, content: "Delegating.", toolCalls: [row("t1", { name: "task", status: S.TOOL_CALL_RUNNING, result: "" })] }],
      subAgentRuns: [{ id: "t1", name: "helper", input: "look", status: SubAgentStatus.SUB_AGENT_IN_PROGRESS, messages: [{ type: AI, content: "Looking." }] }],
    });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(st, { final: false });
    expect(ids(log)).toEqual(["root.m0", "t1", "t1.created", "t1.sent", "t1.running", "t1.m0"]);
    expect(log.events[5]!.threadId).toBe(`${RUN}.t1`);

    st.subAgentRuns[0]!.status = SubAgentStatus.SUB_AGENT_COMPLETED;
    st.subAgentRuns[0]!.output = "found";
    st.messages[0]!.toolCalls[0]!.status = S.TOOL_CALL_COMPLETED;
    st.messages[0]!.toolCalls[0]!.result = "found";
    await e.flush(st, { final: false });
    expect(ids(log).slice(6)).toEqual(["t1.received", "t1.idle", "t1.r"]);
  });

  it("a sub-agent still at work at the terminal write (a pause) holds back only its task's result", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = status({
      messages: [
        { type: AI, content: "Delegating.", toolCalls: [row("t1", { name: "task", status: S.TOOL_CALL_RUNNING, result: "" })] },
        { type: MessageType.MESSAGE_SYSTEM, content: "A note." },
      ],
      subAgentRuns: [{ id: "t1", name: "helper", status: SubAgentStatus.SUB_AGENT_IN_PROGRESS, messages: [] }],
    });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(st, { final: true });
    expect(ids(log)).toEqual(["root.m0", "t1", "t1.created", "t1.sent", "t1.running", "root.n1"]);
  });
});

describe("previews", () => {
  it("previews the message the thread's prefix reached, opening it once; a message behind an unsealed row is never previewed", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = status({ messages: [{ type: AI, content: "Hel", isStreaming: true }] });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    e.observe({ kind: "text_delta", runId: "r1", text: "Hel" }, { messageIndex: 0 });
    await e.flush(st, { final: false });
    e.observe({ kind: "text_delta", runId: "r1", text: "lo" }, { messageIndex: 0 });
    await e.flush(st, { final: false });
    expect(log.previews.map((p) => p.preview.case)).toEqual(["eventStart", "eventDelta", "eventDelta"]);
    const start = log.previews[0]!.preview;
    expect(start.case === "eventStart" && start.value.event?.id).toBe(`${RUN}.root.m0`);
  });

  it("a running tool's output previews under its tool use's id until its result is written", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = status({ messages: [{ type: AI, content: "Running.", toolCalls: [row("sh", { name: "shell", status: S.TOOL_CALL_RUNNING, result: "" })] }] });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    e.observe({ kind: "tool_output_delta", callId: "sh", delta: "12 passing" });
    await e.flush(st, { final: false });
    const preview = log.previews[0]!.preview;
    expect(preview.case === "stigmerToolOutputDelta" && [preview.value.toolUseId, preview.value.delta]).toEqual([`${RUN}.sh`, "12 passing"]);
  });

  it("the terminal write sends no preview", async () => {
    const log = logDouble();
    const e = emitter(log);
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    e.observe({ kind: "text_delta", runId: "r1", text: "Hi" }, { messageIndex: 0 });
    await e.flush(status({ messages: [{ type: AI, content: "Hi" }] }), { final: true });
    expect(log.previews).toEqual([]);
  });
});

describe("Stigmer's own turn events", () => {
  it("writes the memory recall first and the structured output once the root is written, at the terminal write", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = status({
      recalledMemoriesReport: { selectionActive: true, injectedMemoryIds: ["m1"], embeddingModel: "e" },
      structuredOutput: { answer: 42 },
      messages: [{ type: AI, content: "Done." }],
    });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(st, { final: false });
    expect(ids(log)).toEqual(["memory", "root.m0"]);
    await e.flush(st, { final: true });
    expect(ids(log)).toEqual(["memory", "root.m0", "output"]);
  });
});

describe("a failed or refused append", () => {
  it("a transient failure keeps the events queued for the next write", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = status({ messages: [{ type: AI, content: "One." }] });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    log.answers.push("fail", "fail", "fail");
    await e.flush(st, { final: false });
    expect(ids(log)).toEqual([]);
    await e.flush(st, { final: false });
    expect(ids(log)).toEqual(["root.m0"]);
  });

  it("a refusal drops the batch, so one bad event never wedges the turn", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = status({ messages: [{ type: AI, content: "One." }] });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    log.answers.push("refuse");
    await e.flush(st, { final: false });
    st.messages.push(create(AgentMessageSchema, { type: AI, content: "Two." }));
    await e.flush(st, { final: false });
    expect(ids(log)).toEqual(["root.m1"]);
  });

  it("the terminal write gives up after its retries and still returns", async () => {
    const log = logDouble();
    const e = emitter(log);
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    log.answers.push("fail", "fail", "fail", "fail");
    await expect(e.flush(status({ messages: [{ type: AI, content: "Last." }] }), { final: true })).resolves.toBeUndefined();
    expect(log.client.appendSessionEvents).toHaveBeenCalledTimes(4);
  });
});
