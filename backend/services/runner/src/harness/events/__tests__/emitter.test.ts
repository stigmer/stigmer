/**
 * Pins the session event emitter (`../emitter.ts`) on hand-built statuses:
 * the sealed prefix per thread, the boundary rule of a harness whose
 * boundary rewrites rows (a hook-blocked call writes nothing until the
 * terminal write, and narration after it reaches neither the log nor a
 * preview), the rows that are not the runner's to write, the ask's policy
 * source words, the permission word a tool use carries (an unattended skip
 * is the policy's deny, a hook's refusal is not), the turn-start
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
import {
  FileChangeKind,
  FileReviewBlockReason,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { AppendSessionEventsResponseSchema, SessionEventPreviewSchema, type SessionEventPreview } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { createValidator } from "@bufbuild/protovalidate";

import { ELISION_MARKER } from "../../../shared/status-offload.js";
import {
  LIVENESS_MAX_OPERATIONS,
  LIVENESS_NAME_MAX_CHARS,
  POLICY_SOURCE_WORDS,
  SESSION_EVENT_MAX_BYTES,
  SessionEventEmitter,
  nextScopeIndexes,
  type SessionEventEmitterDeps,
} from "../emitter.js";
import { AgentMessageSchema, BackgroundCommandRowSchema, ToolCallSchema, TurnRowsSchema, type TurnRows } from "../../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import {
  ApprovalPolicySource,
  ApprovalPolicySourceSchema,
  FileReviewEventType,
  MessageType,
  SubAgentStatus,
  ToolCallStatus,
} from "../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

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

function status(init: Parameters<typeof create<typeof TurnRowsSchema>>[1]): TurnRows {
  return create(TurnRowsSchema, init);
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await e.flush(st, { final: true });
    const asks = log.events.flatMap((ev) => (ev.event.case === "stigmerPermissionAsked" ? [ev.event.value] : []));
    expect(asks.map((ask) => [ask.toolUseId.slice(RUN.length + 1), ask.contentDigest])).toEqual([["w", "d1"], ["s", ""]]);
  });
});

describe("the permission a tool use carries", () => {
  it("is deny for a call an unattended turn skipped, ask for a call that asks, and empty for the rest, a hook's refusal included", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = status({
      messages: [
        {
          type: AI,
          content: "Trying four calls.",
          toolCalls: [
            row("skipped", { name: "shell", status: S.TOOL_CALL_FAILED, result: "", error: "skipped", approvalPolicySource: ApprovalPolicySource.UNATTENDED_SKIP }),
            row("asked", { name: "shell", status: S.TOOL_CALL_WAITING_APPROVAL, result: "", requiresApproval: true }),
            row("refused", { name: "shell", status: S.TOOL_CALL_FAILED, result: "", error: "a hook said no", approvalPolicySource: ApprovalPolicySource.HOOK }),
            row("ran"),
          ],
        },
      ],
    });
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await e.flush(st, { final: true });
    const uses = log.events.flatMap((ev) => (ev.event.case === "agentToolUse" ? [ev.event.value] : []));
    expect(uses.map((use) => [use.id.slice(RUN.length + 1), use.evaluatedPermission])).toEqual([
      ["skipped", "deny"],
      ["asked", "ask"],
      ["refused", ""],
      ["ran", ""],
    ]);
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    e.observe({ kind: "text_delta", runId: "seg-2", text: "After" }, { messageIndex: 1 });
    await e.flush(st, { final: false });
    expect(ids(log)).toEqual(["root.m0"]);
    expect(log.previews).toEqual([]);
    await e.flush(st, { final: true });
    expect(ids(log)).toEqual(["root.m0", "blocked", "blocked.r", "root.m1"]);
  });
});

describe("rows that are not the runner's to write", () => {
  it("skips a terminal arm's rows; any other SYSTEM row is a harness note", async () => {
    const log = logDouble();
    const e = emitter(log);
    const rows = status({});
    await e.begin({ sessionId: "ses_1", resumed: false, rows });
    rows.messages.push(
      create(AgentMessageSchema, { type: AI, content: "Working." }),
      create(AgentMessageSchema, { type: MessageType.MESSAGE_SYSTEM, content: "Platform tools are off." }),
      create(AgentMessageSchema, { type: MessageType.MESSAGE_SYSTEM, content: "Execution failed: boom" }),
    );
    e.skipRootRows([2]);
    await e.flush(rows, { final: true });
    expect(ids(log)).toEqual(["root.m0", "root.n1"]);
  });
});

describe("a resumed invocation's own rows", () => {
  /** The first invocation: a message, then a call that asks. */
  async function firstInvocation(log: ReturnType<typeof logDouble>): Promise<void> {
    const first = emitter(log);
    await first.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await first.flush(
      status({
        messages: [
          { type: AI, content: "Let me check." },
          { type: MessageType.MESSAGE_THINKING, content: "The build first." },
          { type: AI, content: "Running it.", toolCalls: [row("x", { name: "shell", status: S.TOOL_CALL_WAITING_APPROVAL, requiresApproval: true, result: "" })] },
        ],
      }),
      { final: true },
    );
  }

  /** The resumed invocation's rows: the seeded ask on a message with no text, then its own. */
  function resumedRows(): TurnRows {
    return status({
      messages: [{ type: AI, content: "", toolCalls: [row("x", { name: "shell", status: S.TOOL_CALL_WAITING_APPROVAL, requiresApproval: true, result: "" })] }],
    });
  }

  it("numbers each scope's own messages, thinking and notes on from the highest index the log holds there", async () => {
    const log = logDouble();
    await firstInvocation(log);
    expect(ids(log)).toEqual(["root.m0", "root.t1", "root.t1.text", "root.m2", "x", "x.ask"]);

    const resumed = emitter(log);
    const rows = resumedRows();
    await resumed.begin({ sessionId: "ses_1", resumed: true, rows });
    rows.messages[0]!.toolCalls[0]!.status = S.TOOL_CALL_COMPLETED;
    rows.messages[0]!.toolCalls[0]!.result = "built";
    rows.messages.push(
      create(AgentMessageSchema, { type: MessageType.MESSAGE_THINKING, content: "It passed." }),
      create(AgentMessageSchema, { type: AI, content: "The build passed." }),
      create(AgentMessageSchema, { type: MessageType.MESSAGE_SYSTEM, content: "A note." }),
    );
    await resumed.flush(rows, { final: true });
    expect(ids(log).slice(6)).toEqual(["x.r", "root.t3", "root.t3.text", "root.m4", "root.n5"]);
    const all = ids(log);
    expect(new Set(all).size, "no id is named twice").toBe(all.length);
  });

  it("numbers a scope the log holds nothing in from zero, and a sub-agent's scope on its own", async () => {
    const log = logDouble();
    const first = emitter(log);
    await first.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await first.flush(
      status({
        messages: [{ type: AI, content: "", toolCalls: [row("task-1", { name: "task", status: S.TOOL_CALL_RUNNING, result: "" })] }],
        subAgentRuns: [{ id: "task-1", name: "helper", status: SubAgentStatus.SUB_AGENT_IN_PROGRESS, messages: [{ type: AI, content: "Helping." }] }],
      }),
      { final: false },
    );
    expect(ids(log)).toContain("task-1.m0");

    const resumed = emitter(log);
    const rows = status({
      messages: [{ type: AI, content: "", toolCalls: [row("task-1", { name: "task", status: S.TOOL_CALL_RUNNING, result: "" })] }],
      subAgentRuns: [{ id: "task-1", name: "helper", status: SubAgentStatus.SUB_AGENT_IN_PROGRESS, messages: [{ type: AI, content: "" }] }],
    });
    await resumed.begin({ sessionId: "ses_1", resumed: true, rows });
    rows.messages.push(create(AgentMessageSchema, { type: AI, content: "Delegated." }));
    rows.subAgentRuns[0]!.messages.push(create(AgentMessageSchema, { type: AI, content: "Helped." }));
    await resumed.flush(rows, { final: true });
    expect(ids(log)).toContain("root.m0");
    expect(ids(log)).toContain("task-1.m1");
  });
});

describe("a compaction", () => {
  it("is written as agent.thread_context_compacted under the scope's place sequence, between the messages around it", async () => {
    const log = logDouble();
    const e = emitter(log);
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await e.flush(
      status({
        messages: [
          { type: AI, content: "Reading everything." },
          { type: MessageType.MESSAGE_COMPACTED },
          { type: AI, content: "Read it all." },
        ],
      }),
      { final: true },
    );
    expect(ids(log)).toEqual(["root.m0", "root.c1", "root.m2"]);
    expect(log.events[1]!.event).toEqual({ case: "agentThreadContextCompacted", value: expect.objectContaining({ id: `${RUN}.root.c1` }) });
  });

  it("a resumed invocation numbers on past a compaction the log holds", async () => {
    const log = logDouble();
    const first = emitter(log);
    await first.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await first.flush(status({ messages: [{ type: AI, content: "Before." }, { type: MessageType.MESSAGE_COMPACTED }] }), { final: true });

    const resumed = emitter(log);
    await resumed.begin({ sessionId: "ses_1", resumed: true, rows: create(TurnRowsSchema) });
    await resumed.flush(status({ messages: [{ type: AI, content: "After." }] }), { final: true });
    expect(ids(log)).toEqual(["root.m0", "root.c1", "root.m2"]);
  });
});

describe("nextScopeIndexes", () => {
  it("is the index after the highest place each scope's logged ids name; other ids and other runs are ignored", () => {
    expect(
      Object.fromEntries(
        nextScopeIndexes(RUN, [
          `${RUN}.root.m0`,
          `${RUN}.root.t4`,
          `${RUN}.root.t4.text`,
          `${RUN}.root.n2`,
          `${RUN}.root.c4`,
          `${RUN}.task-1.c7`,
          `${RUN}.task-1.m6`,
          `${RUN}.call-1`,
          `${RUN}.call-1.r`,
          `${RUN}.output`,
          `run_other.root.m9`,
        ]),
      ),
    ).toEqual({ [`${RUN}.root`]: 5, [`${RUN}.task-1`]: 8 });
  });
});

describe("its memory is the log", () => {
  it("a resumed turn reads back what the run wrote and resends none of it, whatever edits did to the rows", async () => {
    const log = logDouble();
    const first = emitter(log);
    const st = status({ messages: [{ type: AI, content: "I will run it.", toolCalls: [row("x", { name: "shell", status: S.TOOL_CALL_WAITING_APPROVAL, requiresApproval: true, result: "" })] }] });
    await first.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await first.flush(st, { final: true });
    expect(ids(log)).toEqual(["root.m0", "x", "x.ask"]);

    // Between invocations the status was elided and the row decided.
    st.messages[0]!.content = `I will run it.\n\n${ELISION_MARKER}`;
    st.messages[0]!.toolCalls[0]!.status = S.TOOL_CALL_COMPLETED;
    st.messages[0]!.toolCalls[0]!.result = "done";
    const second = emitter(log);
    await second.begin({ sessionId: "ses_1", resumed: true, rows: st });
    await second.flush(st, { final: true });
    expect(ids(log)).toEqual(["root.m0", "x", "x.ask", "x.r"]);
    expect(log.client.appendSessionEvents.mock.calls.at(-1)![1].map((ev: SessionEvent) => ev.event.value?.id)).toEqual([`${RUN}.x.r`]);
  });

  it("a fresh turn does not read the log", async () => {
    const log = logDouble();
    await emitter(log).begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await e.flush(st, { final: true });
    expect(ids(log)).toEqual(["root.m0", "t1", "t1.created", "t1.sent", "t1.running", "root.n1"]);
  });
});

describe("previews", () => {
  it("previews the message the thread's prefix reached, opening it once; a message behind an unsealed row is never previewed", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = status({ messages: [{ type: AI, content: "Hel", isStreaming: true }] });
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    e.observe({ kind: "tool_output_delta", callId: "sh", delta: "12 passing" });
    await e.flush(st, { final: false });
    const preview = log.previews[0]!.preview;
    expect(preview.case === "stigmerToolOutputDelta" && [preview.value.toolUseId, preview.value.delta]).toEqual([`${RUN}.sh`, "12 passing"]);
  });

  it("sends a running tool's output between writes, alone: no event, and text previews wait for the write that reads their rows", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = status({ messages: [{ type: AI, content: "Running.", isStreaming: true }] });
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    expect(e.toolOutputPending).toBe(false);
    e.observe({ kind: "text_delta", runId: "r1", text: "Running." }, { messageIndex: 0 });
    e.observe({ kind: "tool_output_delta", callId: "sh", delta: "compiling 1\n" });
    expect(e.toolOutputPending).toBe(true);

    await e.flushToolOutput();
    expect(e.toolOutputPending).toBe(false);
    expect(log.client.appendSessionEvents).toHaveBeenCalledTimes(1);
    expect(log.client.appendSessionEvents.mock.calls[0]![1], "a preview flush carries no event").toEqual([]);
    expect(log.previews.map((p) => p.preview.case)).toEqual(["stigmerToolOutputDelta"]);

    await e.flush(st, { final: false });
    expect(log.previews.map((p) => p.preview.case), "the text preview rode the write").toEqual(["stigmerToolOutputDelta", "eventStart", "eventDelta"]);
  });

  it("sends nothing between writes before it begins, for a call whose result is written, or for no output", async () => {
    const log = logDouble();
    const e = emitter(log);
    e.observe({ kind: "tool_output_delta", callId: "sh", delta: "early" });
    await e.flushToolOutput();
    expect(log.client.appendSessionEvents).not.toHaveBeenCalled();

    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await e.flush(status({ messages: [{ type: AI, content: "Ran.", toolCalls: [row("sh", { name: "shell" })] }] }), { final: false });
    const calls = log.client.appendSessionEvents.mock.calls.length;
    e.observe({ kind: "tool_output_delta", callId: "sh", delta: "late" });
    await e.flushToolOutput();
    await e.flushToolOutput();
    expect(log.client.appendSessionEvents.mock.calls.length, "the result is in the log, where the output is whole").toBe(calls);
  });

  it("logs a failed preview flush and does not resend it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = logDouble();
    const e = emitter(log);
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    e.observe({ kind: "tool_output_delta", callId: "sh", delta: "lost" });
    log.answers.push("fail");
    await e.flushToolOutput();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("tool-output preview(s) failed"));
    expect(e.toolOutputPending).toBe(false);
    warn.mockRestore();
  });

  it("the terminal write sends no preview", async () => {
    const log = logDouble();
    const e = emitter(log);
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    e.observe({ kind: "text_delta", runId: "r1", text: "Hi" }, { messageIndex: 0 });
    await e.flush(status({ messages: [{ type: AI, content: "Hi" }] }), { final: true });
    expect(log.previews).toEqual([]);
  });
});

describe("background commands", () => {
  /** A command the registry reported, started at t0. */
  function command(callId: string, init: { readonly timeoutSeconds: number; readonly ending?: string; readonly output?: string; readonly endedAt?: string }) {
    return create(BackgroundCommandRowSchema, { callId, startedAt: "t0", ...init });
  }

  /** A turn whose root started `bg` in the background (its result in), and whose sub-agent `t1` started `sub-bg`. */
  function startedRows(): TurnRows {
    return status({
      messages: [
        {
          type: AI,
          content: "Starting the server.",
          toolCalls: [
            row("bg", { name: "execute", result: "Started in the background (id bg)." }),
            row("t1", { name: "task", status: S.TOOL_CALL_RUNNING, result: "" }),
          ],
        },
      ],
      subAgentRuns: [
        {
          id: "t1",
          name: "helper",
          status: SubAgentStatus.SUB_AGENT_IN_PROGRESS,
          messages: [{ type: AI, content: "Testing.", toolCalls: [row("sub-bg", { name: "execute", result: "Started." })] }],
        },
      ],
    });
  }

  function statuses(log: ReturnType<typeof logDouble>) {
    return log.events.flatMap((e) =>
      e.event.case === "stigmerBackgroundCommandStatus" ? [{ id: e.event.value.id.slice(RUN.length + 1), thread: e.threadId, value: e.event.value }] : [],
    );
  }

  it("writes running after the start's result, then ended with how and who, each in the start's thread, once", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = startedRows();
    st.backgroundCommands.push(command("bg", { timeoutSeconds: 3300 }));
    st.backgroundCommands.push(command("sub-bg", { timeoutSeconds: 60 }));
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await e.flush(st, { final: false });
    expect(ids(log).indexOf("bg.bg"), "the running status follows the start's result").toBeGreaterThan(ids(log).indexOf("bg.r"));
    expect(statuses(log).map((s) => [s.id, s.thread, s.value.phase, s.value.timeoutSeconds])).toEqual([
      ["bg.bg", "", "running", 3300],
      ["sub-bg.bg", `${RUN}.t1`, "running", 60],
    ]);
    expect(statuses(log)[1]!.value.sessionThreadId).toBe(`${RUN}.t1`);

    st.backgroundCommands[0]!.ending = "stopped";
    st.backgroundCommands[0]!.stoppedBy = "agent";
    st.backgroundCommands[0]!.stoppedByCallId = "stop-1";
    st.backgroundCommands[0]!.output = "listening on :3000\n";
    st.backgroundCommands[0]!.endedAt = "t9";
    st.backgroundCommands[1]!.ending = "exited";
    st.backgroundCommands[1]!.exitCode = 0;
    await e.flush(st, { final: false });
    await e.flush(st, { final: true });
    const ended = statuses(log).slice(2);
    expect(ended.map((s) => s.id)).toEqual(["bg.bg.end", "sub-bg.bg.end"]);
    expect(ended[0]!.value).toMatchObject({
      toolUseId: `${RUN}.bg`,
      phase: "ended",
      ending: "stopped",
      stoppedBy: "agent",
      stoppedByToolUseId: `${RUN}.stop-1`,
      output: "listening on :3000\n",
      endedAt: "t9",
    });
    expect(ended[0]!.value.exitCode).toBeUndefined();
    expect(ended[1]!.value).toMatchObject({ ending: "exited", exitCode: 0, stoppedByToolUseId: "" });
    expect(statuses(log), "each written once").toHaveLength(4);
    const validator = createValidator();
    for (const event of log.events.filter((ev) => ev.event.case === "stigmerBackgroundCommandStatus")) {
      expect(validator.validate(SessionEventSchema, event).kind, "the contract admits it").toBe("valid");
    }
  });

  it("writes nothing for a command whose start's result the log does not hold yet", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = status({ messages: [{ type: AI, content: "Starting.", toolCalls: [row("bg", { name: "execute", status: S.TOOL_CALL_RUNNING, result: "" })] }] });
    st.backgroundCommands.push(command("bg", { timeoutSeconds: 60, ending: "failed_to_start", output: "spawn /bin/sh ENOENT", endedAt: "t0" }));
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await e.flush(st, { final: false });
    expect(statuses(log)).toEqual([]);
    st.messages[0]!.toolCalls[0]!.status = S.TOOL_CALL_COMPLETED;
    st.messages[0]!.toolCalls[0]!.result = "Started.";
    await e.flush(st, { final: false });
    expect(statuses(log).map((s) => [s.id, s.value.ending])).toEqual([
      ["bg.bg", ""],
      ["bg.bg.end", "failed_to_start"],
    ]);
  });

  it("previews its output under the start's tool use once the running status is in the log, holds it until then, and drops it once the end is known", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = startedRows();
    st.backgroundCommands.push(command("bg", { timeoutSeconds: 60 }));
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    const outputs = () => log.previews.flatMap((p) => (p.preview.case === "stigmerToolOutputDelta" ? [[p.preview.value.toolUseId, p.preview.value.delta]] : []));

    // Before any write: held, and the pump is not woken for it.
    e.observe({ kind: "background_output_delta", callId: "bg", delta: "booting\n" });
    expect(e.toolOutputPending, "nothing it may send alone yet").toBe(false);
    await e.flushToolOutput();
    expect(outputs()).toEqual([]);

    // The write that sends the running status is followed by the held output,
    // in an append of its own: the log publishes an append's previews before
    // its events, and a client must hear of the command first.
    await e.flush(st, { final: false });
    expect(outputs()).toEqual([[`${RUN}.bg`, "booting\n"]]);
    const appends = log.client.appendSessionEvents.mock.calls;
    const statusAppend = appends.findIndex((call) => call[1].some((ev) => ev.event.case === "stigmerBackgroundCommandStatus"));
    expect(appends[statusAppend]![2].filter((p) => p.preview.case === "stigmerToolOutputDelta"), "not with the status").toEqual([]);
    expect(appends[statusAppend + 1]![1], "after it, alone").toEqual([]);
    expect(appends[statusAppend + 1]![2].map((p) => p.preview.case)).toEqual(["stigmerToolOutputDelta"]);

    // Between writes, alone.
    e.observe({ kind: "background_output_delta", callId: "bg", delta: "ready\n" });
    expect(e.toolOutputPending).toBe(true);
    await e.flushToolOutput();
    expect(outputs().at(-1)).toEqual([`${RUN}.bg`, "ready\n"]);
    expect(log.client.appendSessionEvents.mock.calls.at(-1)![1], "a preview flush carries no event").toEqual([]);

    // Once its end is known, its output is in the ended status: no more previews.
    st.backgroundCommands[0]!.ending = "exited";
    st.backgroundCommands[0]!.exitCode = 0;
    await e.flush(st, { final: false });
    e.observe({ kind: "background_output_delta", callId: "bg", delta: "late\n" });
    await e.flushToolOutput();
    await e.flush(st, { final: false });
    expect(outputs().map(([, delta]) => delta)).toEqual(["booting\n", "ready\n"]);
    expect(e.toolOutputPending).toBe(false);
  });

  it("holds at most a bounded amount of a command's output while its running status waits", async () => {
    const log = logDouble();
    const e = emitter(log);
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    const chunk = "x".repeat(100 * 1024);
    for (let i = 0; i < 4; i++) e.observe({ kind: "background_output_delta", callId: "bg", delta: chunk });
    const st = startedRows();
    st.backgroundCommands.push(command("bg", { timeoutSeconds: 60 }));
    await e.flush(st, { final: false });
    const sent = log.previews.filter((p) => p.preview.case === "stigmerToolOutputDelta");
    expect(sent, "two chunks fit under the bound; the rest is in the ended status").toHaveLength(2);
  });
});

describe("what the turn has open, sent alone", () => {
  const open = (callId: string, ageMs: number, subAgentId?: string) => ({
    callId,
    name: callId === "sh" ? "shell" : "execute",
    openedAtMs: 0,
    ageMs,
    ...(subAgentId === undefined ? {} : { subAgentId }),
  });

  it("sends nothing before it begins", async () => {
    const log = logDouble();
    const e = emitter(log);
    expect(await e.sendLiveness({ operations: [open("sh", 1)], awaitingModelMs: undefined })).toBe("sent");
    expect(log.client.appendSessionEvents).not.toHaveBeenCalled();
  });

  it("names each open call by its tool use and thread with its age, leaves out a call whose result is written, and says how long the model has been waited on", async () => {
    const log = logDouble();
    const e = emitter(log);
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await e.flush(status({ messages: [{ type: AI, content: "Ran.", toolCalls: [row("done")] }] }), { final: false });
    const before = log.client.appendSessionEvents.mock.calls.length;

    const sent = await e.sendLiveness({
      operations: [open("sh", 840_500), open("c2", 1_250, "task1"), open("done", 9)],
      awaitingModelMs: 2_000,
    });
    expect(sent).toBe("sent");
    const call = log.client.appendSessionEvents.mock.calls[before]!;
    expect(call[1], "a liveness carries no event").toEqual([]);
    expect(call[2].map((p) => p.preview.case), "and no other preview").toEqual(["stigmerRunLiveness"]);
    const liveness = log.previews.at(-1)!.preview;
    expect(liveness.case).toBe("stigmerRunLiveness");
    if (liveness.case !== "stigmerRunLiveness") return;
    expect(liveness.value.runId).toBe(RUN);
    expect(
      liveness.value.operations.map((o) => [o.toolUseId, o.name, o.threadId, o.elapsed?.seconds, o.elapsed?.nanos]),
    ).toEqual([
      [`${RUN}.sh`, "shell", "", 840n, 500_000_000],
      [`${RUN}.c2`, "execute", `${RUN}.task1`, 1n, 250_000_000],
    ]);
    expect(liveness.value.awaitingModelFor?.seconds).toBe(2n);

    await e.sendLiveness({ operations: [], awaitingModelMs: undefined });
    const idle = log.previews.at(-1)!.preview;
    expect(idle.case === "stigmerRunLiveness" ? idle.value.awaitingModelFor : "not a liveness").toBeUndefined();
  });

  it("clamps a liveness to the contract: at most its operations, names within their bound and never empty", async () => {
    const log = logDouble();
    const e = emitter(log);
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    const long = "x".repeat(LIVENESS_NAME_MAX_CHARS + 40);
    const operations = Array.from({ length: LIVENESS_MAX_OPERATIONS + 5 }, (_, i) => ({
      callId: `c${i}`,
      name: i === 0 ? long : i === 1 ? "" : "shell",
      openedAtMs: 0,
      ageMs: i,
    }));
    await e.sendLiveness({ operations, awaitingModelMs: 5 });
    const preview = log.previews.at(-1)!;
    expect((await createValidator()).validate(SessionEventPreviewSchema, preview).kind, "the preview meets the contract").toBe("valid");
    if (preview.preview.case !== "stigmerRunLiveness") throw new Error("not a liveness");
    const sent = preview.preview.value.operations;
    expect(sent).toHaveLength(LIVENESS_MAX_OPERATIONS);
    expect([...sent[0]!.name]).toHaveLength(LIVENESS_NAME_MAX_CHARS);
    expect(sent[1]!.name).toBe("tool");
  });

  it("answers refused when the log refuses the preview, and logs any other failure without resending", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const log = logDouble();
      const e = emitter(log);
      await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
      log.answers.push("refuse");
      expect(await e.sendLiveness({ operations: [], awaitingModelMs: undefined })).toBe("refused");
      log.answers.push("fail");
      expect(await e.sendLiveness({ operations: [], awaitingModelMs: undefined })).toBe("sent");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("sending the turn's liveness failed"));
      expect(log.previews).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("renews a refused credential for the next append", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const log = logDouble();
      let n = 0;
      const e = emitter(log, { credential: async () => ({ token: `tok-${++n}`, expiresInSeconds: 3600 }) });
      await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
      log.client.appendSessionEvents.mockRejectedValueOnce(new ConnectError("expired", Code.Unauthenticated));
      await e.sendLiveness({ operations: [], awaitingModelMs: undefined });
      await e.sendLiveness({ operations: [], awaitingModelMs: undefined });
      expect(log.client.appendSessionEvents.mock.calls.map((call) => call[3])).toEqual(["tok-1", "tok-2"]);
    } finally {
      warn.mockRestore();
    }
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    log.answers.push("refuse");
    await e.flush(st, { final: false });
    st.messages.push(create(AgentMessageSchema, { type: AI, content: "Two." }));
    await e.flush(st, { final: false });
    expect(ids(log)).toEqual(["root.m1"]);
  });

  it("the terminal write gives up after its retries and still returns", async () => {
    const log = logDouble();
    const e = emitter(log);
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
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
    await e.begin({ sessionId: "ses_1", resumed: true, rows: create(TurnRowsSchema) });
    await e.flush(status({ messages: [{ type: AI, content: "Still here." }] }), { final: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("reading what the run already wrote failed"));
    warn.mockRestore();
    expect(ids(log)).toEqual(["root.m0"]);
  });

  it("a fault reading the rows is logged, and what was queued before it is still sent", async () => {
    const log = logDouble();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = emitter(log, { boundaryRewritesRow: () => { throw new Error("predicate fell over"); } });
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await e.flush(status({ messages: [{ type: AI, content: "Before.", toolCalls: [row("x")] }] }), { final: false });
    expect(error).toHaveBeenCalledWith(expect.stringContaining("reading the rows failed"));
    error.mockRestore();
    expect(ids(log)).toEqual(["root.m0"]);
  });

  it("a credential that cannot be acquired appends with the ambient one", async () => {
    const log = logDouble();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const e = emitter(log, { credential: async () => { throw new Error("exchange refused"); } });
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await e.flush(status({ messages: [{ type: AI, content: "Hi." }] }), { final: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no scoped credential"));
    warn.mockRestore();
    expect(log.client.appendSessionEvents.mock.calls[0]![3]).toBeUndefined();
    expect(ids(log)).toEqual(["root.m0"]);
  });

  it("renews a clocked credential at 0.8 of its lifetime, so a turn past the hour keeps appending (#2455)", async () => {
    const log = logDouble();
    let now = 0;
    let minted = 0;
    const credential = vi.fn(async () => ({ token: `tok-${++minted}`, expiresInSeconds: 3600 }));
    const e = emitter(log, { credential, now: () => now });
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    const tokens = () => log.client.appendSessionEvents.mock.calls.map((call) => call[3]);

    await e.flush(status({ messages: [{ type: AI, content: "one" }] }), { final: false });
    now = 2_879_000;
    await e.flush(status({ messages: [{ type: AI, content: "one" }, { type: AI, content: "two" }] }), { final: false });
    expect(tokens(), "held while the token is young").toEqual(["tok-1", "tok-1"]);

    now = 2_880_000;
    await e.flush(status({ messages: [{ type: AI, content: "one" }, { type: AI, content: "two" }, { type: AI, content: "three" }] }), { final: false });
    expect(tokens().at(-1), "renewed at 0.8 of the hour, before it lapses").toBe("tok-2");
    expect(credential).toHaveBeenCalledTimes(2);
    expect(ids(log)).toEqual(["root.m0", "root.m1", "root.m2"]);
  });

  it("holds a credential with no expiry for the whole turn", async () => {
    const log = logDouble();
    let now = 0;
    const credential = vi.fn(async () => ({ token: "run-credential" }));
    const e = emitter(log, { credential, now: () => now });
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await e.flush(status({ messages: [{ type: AI, content: "one" }] }), { final: false });
    now = 10 * 3_600_000;
    await e.flush(status({ messages: [{ type: AI, content: "one" }, { type: AI, content: "two" }] }), { final: true });
    expect(credential).toHaveBeenCalledTimes(1);
  });

  it("re-acquires once and retries the same write when an append is answered Unauthenticated", async () => {
    const log = logDouble();
    let minted = 0;
    const credential = vi.fn(async () => ({ token: `tok-${++minted}`, expiresInSeconds: 3600 }));
    const e = emitter(log, { credential });
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    log.client.appendSessionEvents.mockRejectedValueOnce(new ConnectError("expired", Code.Unauthenticated));

    await e.flush(status({ messages: [{ type: AI, content: "Kept." }] }), { final: false });

    expect(log.client.appendSessionEvents.mock.calls.map((call) => call[3])).toEqual(["tok-1", "tok-2"]);
    expect(ids(log), "the events landed on the retry, none lost").toEqual(["root.m0"]);
  });

  it("keeps the credential in hand when its renewal fails, and tries again a minute later", async () => {
    const log = logDouble();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = 0;
    const answers: Array<() => Promise<{ token: string; expiresInSeconds: number }>> = [
      async () => ({ token: "tok-1", expiresInSeconds: 3600 }),
      async () => { throw new Error("exchange unavailable"); },
      async () => ({ token: "tok-2", expiresInSeconds: 3600 }),
    ];
    const credential = vi.fn(() => answers.shift()!());
    const e = emitter(log, { credential, now: () => now });
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    const rowsOf = (n: number) => status({ messages: Array.from({ length: n }, (_, i) => ({ type: AI, content: `m${i}` })) });

    await e.flush(rowsOf(1), { final: false });
    now = 2_880_000;
    await e.flush(rowsOf(2), { final: false });
    now = 2_880_000 + 59_000;
    await e.flush(rowsOf(3), { final: false });
    now = 2_880_000 + 60_000;
    await e.flush(rowsOf(4), { final: false });

    expect(log.client.appendSessionEvents.mock.calls.map((call) => call[3]), "never the ambient credential once a scoped one was held").toEqual(["tok-1", "tok-1", "tok-1", "tok-2"]);
    expect(credential).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("renewing the scoped credential failed; keeping the one in hand"));
    expect(ids(log)).toEqual(["root.m0", "root.m1", "root.m2", "root.m3"]);
    warn.mockRestore();
  });

  it("re-acquires once on PermissionDenied too, the trusted-local posture's answer to a credential it no longer admits", async () => {
    const log = logDouble();
    let minted = 0;
    const credential = vi.fn(async () => ({ token: `tok-${++minted}`, expiresInSeconds: 3600 }));
    const e = emitter(log, { credential });
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    log.client.appendSessionEvents.mockRejectedValueOnce(new ConnectError("not this run's runner", Code.PermissionDenied));

    await e.flush(status({ messages: [{ type: AI, content: "Kept." }] }), { final: false });

    expect(log.client.appendSessionEvents.mock.calls.map((call) => call[3])).toEqual(["tok-1", "tok-2"]);
    expect(ids(log)).toEqual(["root.m0"]);
  });

  it("does not loop when a fresh credential is refused too: the events wait for the next write", async () => {
    const log = logDouble();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const credential = vi.fn(async () => ({ token: "refused", expiresInSeconds: 3600 }));
    const e = emitter(log, { credential });
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    log.client.appendSessionEvents.mockRejectedValue(new ConnectError("expired", Code.Unauthenticated));

    await e.flush(status({ messages: [{ type: AI, content: "Waits." }] }), { final: false });

    expect(credential).toHaveBeenCalledTimes(2);
    expect(log.client.appendSessionEvents.mock.calls.length, "one renewal, then the usual retries").toBe(4);
    expect(ids(log)).toEqual([]);
    warn.mockRestore();
  });

  it("drops a credential a preview flush was refused with, so the next append acquires a fresh one", async () => {
    const log = logDouble();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let minted = 0;
    const credential = vi.fn(async () => ({ token: `tok-${++minted}`, expiresInSeconds: 3600 }));
    const e = emitter(log, { credential });
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    e.observe({ kind: "tool_output_delta", callId: "sh", delta: "line" });
    log.client.appendSessionEvents.mockRejectedValueOnce(new ConnectError("expired", Code.Unauthenticated));
    await e.flushToolOutput();
    await e.flush(status({ messages: [{ type: AI, content: "Next." }] }), { final: false });
    expect(log.client.appendSessionEvents.mock.calls.map((call) => call[3])).toEqual(["tok-1", "tok-2"]);
    warn.mockRestore();
  });

  it("waits between transient retries by default", async () => {
    const log = logDouble();
    const e = new SessionEventEmitter({ client: log.client, runId: RUN, credential: async () => undefined });
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await e.flush(status({ messages: [{ type: MessageType.MESSAGE_HUMAN, content: "hi" }, { type: AI, content: "Hello." }] }), { final: false });
    expect(ids(log)).toEqual(["root.m1"]);
  });

  it("splits a queue past an append's limit across appends, in order", async () => {
    const log = logDouble();
    const e = emitter(log);
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
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
  function captured(): TurnRows {
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
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
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    await e.flush(captured(), { final: false });
    await e.flush(captured(), { final: true });
    expect(log.events.filter((event) => event.event.case === "stigmerFileReviewChanges")).toHaveLength(1);

    const resumed = emitter(log);
    const sent = log.client.appendSessionEvents.mock.calls.length;
    await resumed.begin({ sessionId: "ses_1", resumed: true, rows: create(TurnRowsSchema) });
    // The resumed invocation's own rows: its ledger, and no message of its own.
    const again = captured();
    again.messages.splice(0);
    await resumed.flush(again, { final: true });
    expect(log.client.appendSessionEvents.mock.calls.length, "nothing new to send").toBe(sent);
  });

  it("a ledger with no candidate writes no changes event", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = captured();
    st.fileReviewEventStream!.events.splice(1, 1);
    await e.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
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
