/**
 * Pins the session event emitter (`../emitter.ts`) on hand-built statuses:
 * the sealed prefix per thread, the boundary rule of a harness whose
 * boundary rewrites rows (a hook-blocked call writes nothing until the
 * terminal write, and narration after it reaches neither the log nor a
 * preview), the rows that are not the runner's to write, the ask's policy
 * source words, the turn-start
 * read, the per-event bound, previews, what a failed or refused append
 * does, and the two file-review events the runner writes (a captured
 * change set's `changes`, once; an undo's `reconciled`, at once and before
 * the engine's turn begins), and an offloaded output's full-output event
 * after its result. The hermetic event goldens prove the same through the real
 * activity on both harnesses.
 */

import { create, toBinary, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";
import { RunStatusSchema, type RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  ApprovalPolicySource,
  ApprovalPolicySourceSchema,
  FileChangeKind,
  FileReviewBlockReason,
  FileReviewEventType,
  MessageType,
  SubAgentStatus,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { AppendSessionEventsResponseSchema, type SessionEventPreview } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";

import { ELISION_MARKER } from "../../../shared/status-offload.js";
import { POLICY_SOURCE_WORDS, SESSION_EVENT_MAX_BYTES, SessionEventEmitter, type SessionEventEmitterDeps } from "../emitter.js";

const RUN = "run_01jz8k3q9w4e5r6t7y8u9i0o1p";
const AI = MessageType.MESSAGE_AI;
const S = ToolCallStatus;

/** A log double with the server's append rules; `refuse` and `fail` script one append's answer. */
function logDouble() {
  const events: SessionEvent[] = [];
  const previews: SessionEventPreview[] = [];
  const answers: Array<"refuse" | "fail"> = [];
  const appendSessionEvents = vi.fn(async (_run: string, batch: readonly SessionEvent[], sent: readonly SessionEventPreview[], _token?: string) => {
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

describe("an offloaded output", () => {
  it("writes the result with the output's head, then where the whole output is stored, once", async () => {
    const log = logDouble();
    const e = emitter(log);
    const offloaded = row("big", {
      result: "line 1\n\n[output truncated — 900 KB total; view full output]",
      outputRef: { storageKey: `artifacts/${RUN}/toolcalls/big.txt`, sizeBytes: 900_000n, contentHash: "ab12", mimeType: "text/plain", truncatedPreview: "line 1" },
    });
    const st = status({ messages: [{ type: AI, content: "Reading the log.", toolCalls: [offloaded, row("small")] }] });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(st, { final: false });
    await e.flush(st, { final: true });
    expect(ids(log)).toEqual(["root.m0", "big", "small", "big.r", "big.full", "small.r"]);
    const full = log.events[4]!.event;
    expect(full.case === "stigmerToolResultFullOutput" && [full.value.toolUseId, full.value.storageKey, full.value.sizeBytes, full.value.contentHash, full.value.mimeType, full.value.isImage]).toEqual([
      `${RUN}.big`,
      `artifacts/${RUN}/toolcalls/big.txt`,
      900_000n,
      "ab12",
      "text/plain",
      false,
    ]);
  });
});

describe("the ask's policy source", () => {
  it("is each source's enum name, lowercased, and empty for none", () => {
    for (const value of ApprovalPolicySourceSchema.values) {
      expect(POLICY_SOURCE_WORDS[value.number as ApprovalPolicySource]).toBe(value.number === 0 ? "" : value.localName.toLowerCase());
    }
  });

  it("carries the content digest the call was asked under, which a resumed turn reads back as the edit an approval allows", async () => {
    const log = logDouble();
    const e = emitter(log);
    const waiting = { name: "write", status: S.TOOL_CALL_WAITING_APPROVAL, requiresApproval: true, result: "" };
    const st = status({
      messages: [{ type: AI, content: "Writing.", toolCalls: [row("w", { ...waiting, approvalContentDigest: "d1" }), row("s", { ...waiting, name: "shell" })] }],
    });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(st, { final: true });
    const asks = log.events.flatMap((ev) => (ev.event.case === "stigmerPermissionAsked" ? [ev.event.value] : []));
    expect(asks.map((ask) => [ask.toolUseId.slice(RUN.length + 1), ask.contentDigest])).toEqual([["w", "d1"], ["s", ""]]);
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

describe("what never stops a turn", () => {
  it("a failed read of what the run wrote is logged, and the turn writes on", async () => {
    const log = logDouble();
    log.client.listRunSessionEvents.mockRejectedValueOnce(new Error("log unreachable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const e = emitter(log);
    await e.begin({ sessionId: "ses_1", resumed: true, status: create(RunStatusSchema) });
    await e.flush(status({ messages: [{ type: AI, content: "Still here." }] }), { final: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("reading what the run already wrote failed"));
    warn.mockRestore();
    expect(ids(log)).toEqual(["root.m0"]);
  });

  it("a fault reading the rows is logged, and what was queued before it is still sent", async () => {
    const log = logDouble();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = emitter(log, { boundaryRewritesRow: () => { throw new Error("predicate fell over"); } });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(status({ messages: [{ type: AI, content: "Before.", toolCalls: [row("x")] }] }), { final: false });
    expect(error).toHaveBeenCalledWith(expect.stringContaining("reading the rows failed"));
    error.mockRestore();
    expect(ids(log)).toEqual(["root.m0"]);
  });

  it("a credential that cannot be acquired appends with the ambient one", async () => {
    const log = logDouble();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const e = emitter(log, { credential: async () => { throw new Error("exchange refused"); } });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(status({ messages: [{ type: AI, content: "Hi." }] }), { final: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no scoped credential"));
    warn.mockRestore();
    expect(log.client.appendSessionEvents.mock.calls[0]![3]).toBeUndefined();
    expect(ids(log)).toEqual(["root.m0"]);
  });

  it("waits between transient retries by default", async () => {
    const log = logDouble();
    const e = new SessionEventEmitter({ client: log.client, runId: RUN, credential: async () => undefined });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    log.answers.push("fail");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await e.flush(status({ messages: [{ type: AI, content: "Retried." }] }), { final: false });
    warn.mockRestore();
    expect(ids(log)).toEqual(["root.m0"]);
  });
});

describe("rows the log does not carry, and big batches", () => {
  it("a HUMAN row writes nothing and holds nothing back (the turn's message is the server's)", async () => {
    const log = logDouble();
    const e = emitter(log);
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(status({ messages: [{ type: MessageType.MESSAGE_HUMAN, content: "hi" }, { type: AI, content: "Hello." }] }), { final: false });
    expect(ids(log)).toEqual(["root.m1"]);
  });

  it("splits a queue past an append's limit across appends, in order", async () => {
    const log = logDouble();
    const e = emitter(log);
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    const messages = Array.from({ length: 1001 }, (_, i) => ({ type: AI, content: `m${i}` }));
    await e.flush(status({ messages }), { final: true });
    expect(log.client.appendSessionEvents.mock.calls.map((c) => c[1].length)).toEqual([1000, 1]);
    expect(ids(log).at(-1)).toBe("root.m1000");
  });

  it("a sub-agent that finished while its task's row still runs writes its idle once, and the result when the row settles", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = status({
      messages: [{ type: AI, content: "Delegating.", toolCalls: [row("t1", { name: "task", status: S.TOOL_CALL_RUNNING, result: "" })] }],
      subAgentRuns: [{ id: "t1", name: "helper", status: SubAgentStatus.SUB_AGENT_COMPLETED, output: "done", messages: [] }],
    });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(st, { final: false });
    expect(ids(log).slice(-2)).toEqual(["t1.received", "t1.idle"]);
    st.messages[0]!.toolCalls[0]!.status = S.TOOL_CALL_COMPLETED;
    st.messages[0]!.toolCalls[0]!.result = "done";
    await e.flush(st, { final: false });
    expect(ids(log).slice(-3)).toEqual(["t1.received", "t1.idle", "t1.r"]);
  });
});

describe("file review", () => {
  const CHANGE_SET = `${RUN}:3`;

  /** A status whose own ledger captured one change set with every reviewable shape. */
  function captured(): RunStatus {
    return status({
      messages: [{ type: AI, content: "Edited." }],
      fileReviewEventStream: {
        events: [
          {
            eventId: "e1",
            changeSetId: CHANGE_SET,
            eventType: FileReviewEventType.BASELINE_CAPTURED,
            payload: { case: "baselineCaptured", value: { changeSetId: CHANGE_SET, turnId: CHANGE_SET, harnessId: "unit" } },
          },
          {
            eventId: "e2",
            changeSetId: CHANGE_SET,
            eventType: FileReviewEventType.CANDIDATE_CAPTURED,
            payload: {
              case: "candidateCaptured",
              value: {
                changeSetId: CHANGE_SET,
                aggregateDigest: "agg",
                changes: [
                  { id: `${CHANGE_SET}:a.md`, pathAfter: "a.md", kind: FileChangeKind.ADD, diffComplete: true, fileDigest: "da", linesAdded: 2 },
                  { id: `${CHANGE_SET}:b.md`, pathBefore: "b.md", pathAfter: "b.md", kind: FileChangeKind.MODIFY, diffComplete: false, fileDigest: "db" },
                  { id: `${CHANGE_SET}:logo.png`, pathBefore: "logo.png", pathAfter: "logo.png", kind: FileChangeKind.BINARY_CHANGE, diffComplete: false, after: { isBinary: true }, fileDigest: "dl" },
                  { id: `${CHANGE_SET}:new.md`, pathBefore: "old.md", pathAfter: "new.md", kind: FileChangeKind.RENAME, diffComplete: true, fileDigest: "dn", linesRemoved: 1 },
                  { id: `${CHANGE_SET}:.env`, pathBefore: ".env", kind: FileChangeKind.DELETE, diffComplete: false, blockedReason: FileReviewBlockReason.SECRET_WITHHELD, fileDigest: "de" },
                ],
              },
            },
          },
        ],
      },
    });
  }

  it("writes one stigmer.file_review.changes per captured change set, in the log's words, under its derived id", async () => {
    const log = logDouble();
    const e = emitter(log);
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(captured(), { final: true });

    const changes = log.events.flatMap((event) => (event.event.case === "stigmerFileReviewChanges" ? [event.event.value] : []));
    expect(changes).toHaveLength(1);
    expect(changes[0]!.id).toBe(`${RUN}.fr3`);
    expect(changes[0]!.changeSetId).toBe(CHANGE_SET);
    expect(changes[0]!.aggregateDigest).toBe("agg");
    expect(changes[0]!.files.map((f) => [f.path, f.previousPath, f.change, f.reviewable, f.digest, f.linesAdded, f.linesRemoved])).toEqual([
      ["a.md", "", "added", "complete", "da", 2, 0],
      ["b.md", "", "modified", "partial", "db", 0, 0],
      ["logo.png", "", "modified", "binary", "dl", 0, 0],
      ["new.md", "old.md", "renamed", "complete", "dn", 0, 1],
      [".env", "", "deleted", "secret", "de", 0, 0],
    ]);
    expect(changes[0]!.files[0]!.fileChangeId).toBe(`${CHANGE_SET}:a.md`);
  });

  it("never writes a change set twice: later writes and a resumed turn that already wrote it send nothing new", async () => {
    const log = logDouble();
    const e = emitter(log);
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(captured(), { final: false });
    await e.flush(captured(), { final: true });
    expect(log.events.filter((event) => event.event.case === "stigmerFileReviewChanges")).toHaveLength(1);

    const resumed = emitter(log);
    const sent = log.client.appendSessionEvents.mock.calls.length;
    await resumed.begin({ sessionId: "ses_1", resumed: true, status: create(RunStatusSchema) });
    await resumed.flush(captured(), { final: true });
    expect(log.client.appendSessionEvents.mock.calls.length, "nothing new to send").toBe(sent);
  });

  it("a ledger with no candidate writes no changes event", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = captured();
    st.fileReviewEventStream!.events.splice(1, 1);
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(st, { final: true });
    expect(log.events.some((event) => event.event.case === "stigmerFileReviewChanges")).toBe(false);
  });

  it("writes an undo's stigmer.file_review.reconciled at once, before the engine's turn begins, under the undo's own id", async () => {
    const log = logDouble();
    const e = emitter(log);
    await e.writeReconciled([
      { changeSetId: "run_earlier:2", undonePaths: ["a.md"], failure: "", failureDetail: "", decidedEventId: "sevt_fd_1" },
      { changeSetId: "run_older:0", undonePaths: [], failure: "hash_mismatch", failureDetail: "a.md changed", decidedEventId: "sevt_fd_2" },
    ]);
    const reconciled = log.events.flatMap((event) => (event.event.case === "stigmerFileReviewReconciled" ? [event] : []));
    expect(reconciled.map((event) => event.event.value?.id)).toEqual(["run_earlier.fr2.r.sevt_fd_1", "run_older.fr0.r.sevt_fd_2"]);
    expect(reconciled.map((event) => event.runId), "written by this run").toEqual([RUN, RUN]);
    const [first, second] = reconciled.map((event) => (event.event.case === "stigmerFileReviewReconciled" ? event.event.value : undefined));
    expect([first?.undonePaths, first?.failure]).toEqual([["a.md"], ""]);
    expect([second?.undonePaths, second?.failure, second?.failureDetail]).toEqual([[], "hash_mismatch", "a.md changed"]);
  });

  it("writes nothing for no outcome, and retries a transient failure as a terminal write does", async () => {
    const log = logDouble();
    const e = emitter(log);
    await e.writeReconciled([]);
    expect(log.client.appendSessionEvents).not.toHaveBeenCalled();
    log.answers.push("fail");
    await e.writeReconciled([{ changeSetId: "run_earlier:2", undonePaths: ["a.md"], failure: "", failureDetail: "", decidedEventId: "sevt_fd_1" }]);
    expect(log.events.map((event) => event.event.case)).toEqual(["stigmerFileReviewReconciled"]);
  });
});
