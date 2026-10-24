/**
 * Pins the fold (../fold.ts) on hand-built logs: a turn per run in log
 * order with its message, items, threads and answer; a tool use paired
 * with its result, ask, answer, grant and full output (held when they come
 * first); each tool use's state, a turn's end with and without its
 * `stigmer.run.status`; the session's status; previews (a live message
 * replaced in place by its stored event, a running tool's output);
 * duplicates folded once; file-review states; the to-do rule applied only
 * to the primary thread's completed to-do calls; and snapshots that share
 * every object no event touched. A message sent while a turn works is
 * held as queued until a run's copy replaces it, then is the run's first
 * message (the messages a turn starts with joined) or a `user_message`
 * item where it was read; a stop drops what still waits. A tool use that
 * started a background command keeps its result and gains the command's
 * life: running, its output streamed after the result, its ending and who
 * stopped it, a person's stop request, the agent's stop call linked to the
 * command it stopped, and a command its ended turn never ended read as
 * stopped by the turn.
 */
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { StreamSessionEventsResponseSchema, type StreamSessionEventsResponse } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";

import { SessionLog, foldSession, isBackgroundRunning, previewPlaceOf, textOf, turnOf } from "../fold.js";
import type { MessageItem, ThinkingItem, ToolUse, TurnItem } from "../types.js";

type EventInit = MessageInitShape<typeof SessionEventSchema>["event"];

let seq = 0n;

/** One stored event of a run, on a thread ("" for the primary). */
function ev(runId: string, event: EventInit, threadId = ""): SessionEvent {
  seq += 1n;
  return create(SessionEventSchema, { seq, sessionId: "ses_1", runId, threadId, event });
}

const text = (t: string) => [{ type: "text", text: t }];
const R = "run_a";
const R2 = "run_b";

function user(runId: string, message: string): SessionEvent {
  return ev(runId, { case: "userMessage", value: { id: `${runId}.user`, content: text(message), processedAt: "t0" } });
}
function said(runId: string, index: number, message: string, threadScope = "root", threadId = ""): SessionEvent {
  return ev(runId, { case: "agentMessage", value: { id: `${runId}.${threadScope}.m${index}`, content: text(message), processedAt: `t${index}` } }, threadId);
}
function use(runId: string, call: string, name: string, extra: { permission?: string; mcp?: string; input?: Record<string, unknown>; threadId?: string } = {}): SessionEvent {
  const id = `${runId}.${call}`;
  const input = (extra.input ?? { path: "a.md" }) as never;
  return extra.mcp === undefined
    ? ev(runId, { case: "agentToolUse", value: { id, name, input, evaluatedPermission: extra.permission ?? "", sessionThreadId: extra.threadId ?? "", processedAt: "tu" } }, extra.threadId ?? "")
    : ev(runId, { case: "agentMcpToolUse", value: { id, name, mcpServerName: extra.mcp, input, evaluatedPermission: extra.permission ?? "", processedAt: "tu" } }, extra.threadId ?? "");
}
function result(runId: string, call: string, output: string, extra: { isError?: boolean; mcp?: boolean; threadId?: string } = {}): SessionEvent {
  const useId = `${runId}.${call}`;
  return extra.mcp === true
    ? ev(runId, { case: "agentMcpToolResult", value: { id: `${useId}.r`, mcpToolUseId: useId, content: text(output), isError: extra.isError ?? false, processedAt: "tr" } }, extra.threadId ?? "")
    : ev(runId, { case: "agentToolResult", value: { id: `${useId}.r`, toolUseId: useId, content: text(output), isError: extra.isError ?? false, processedAt: "tr" } }, extra.threadId ?? "");
}
function phase(runId: string, word: string, extra: { stopCause?: string; error?: string } = {}): SessionEvent {
  return ev(runId, { case: "stigmerRunStatus", value: { id: `${runId}.status.${word}.${seq}`, phase: word, stopCause: extra.stopCause ?? "", error: extra.error ?? "", processedAt: "ts" } });
}
function frame(init: MessageInitShape<typeof StreamSessionEventsResponseSchema>["frame"]): StreamSessionEventsResponse {
  return create(StreamSessionEventsResponseSchema, { frame: init });
}

function toolsOf(items: ReadonlyArray<TurnItem>): ToolUse[] {
  return items.filter((item): item is ToolUse => item.kind === "tool_use");
}

describe("turns", () => {
  it("one turn per run, in log order, with its message, items and answer", () => {
    const fold = foldSession([
      user(R, "summarise"),
      phase(R, "pending"),
      said(R, 0, "Reading."),
      use(R, "c1", "read"),
      result(R, "c1", "contents"),
      said(R, 1, "Done."),
      phase(R, "completed"),
      user(R2, "again"),
      phase(R2, "running"),
    ]);
    expect(fold.turns.map((turn) => [turn.runId, turn.userMessage?.text, turn.ended, turn.status?.phase])).toEqual([
      [R, "summarise", true, "completed"],
      [R2, "again", false, "running"],
    ]);
    const first = fold.turns[0]!;
    expect(first.items.map((item) => item.kind)).toEqual(["message", "tool_use", "message"]);
    expect(first.answer).toBe("Done.");
    expect(toolsOf(first.items)[0]).toMatchObject({ name: "read", state: "completed", result: { text: "contents", isError: false } });
    expect(fold.lastSeq).toBe(seq);
    expect(turnOf(fold, R2)?.userMessage?.text).toBe("again");
    expect(turnOf(fold, "nope")).toBeUndefined();
  });

  it("an ended turn carries its stop cause and error; errors of the run are the turn's", () => {
    const fold = foldSession([
      user(R, "go"),
      ev(R, { case: "sessionError", value: { id: "err1", error: { type: "unknown_error", message: "boom" }, processedAt: "te" } }),
      phase(R, "failed", { stopCause: "failed", error: "boom" }),
      ev("", { case: "sessionError", value: { id: "err2", error: { type: "unknown_error", message: "late" } } }),
    ]);
    const turn = fold.turns[0]!;
    expect([turn.ended, turn.status?.stopCause, turn.status?.error]).toEqual([true, "failed", "boom"]);
    expect(turn.errors.map((e) => [e.type, e.message])).toEqual([
      ["unknown_error", "boom"],
      ["unknown_error", "late"],
    ]);
  });

  it("an error with no run and no turn yet is dropped; an event holding nothing is skipped", () => {
    const fold = foldSession([
      ev("", { case: "sessionError", value: { id: "err", error: { type: "unknown_error", message: "x" } } }),
      create(SessionEventSchema, { seq: 99n }),
    ]);
    expect(fold.turns).toEqual([]);
  });

  it("the structured output, the memory recall, a note and a compaction land on their turn", () => {
    const fold = foldSession([
      user(R, "go"),
      ev(R, { case: "stigmerMemoryRecalled", value: { id: "mem", selectionActive: true, injectedMemoryIds: ["m1"], embeddingModel: "e5" } }),
      ev(R, { case: "stigmerHarnessNote", value: { id: `${R}.root.n0`, text: "tools are off" } }),
      ev(R, { case: "agentThreadContextCompacted", value: { id: "cmp" } }),
      ev(R, { case: "stigmerAgentStructuredOutput", value: { id: `${R}.output`, output: { verdict: "pass" } } }),
      ev(R, { case: "userInterrupt", value: { id: "int" } }),
    ]);
    const turn = fold.turns[0]!;
    expect(turn.memory).toEqual({ selectionActive: true, injectedMemoryIds: ["m1"], embeddingModel: "e5" });
    expect(turn.structuredOutput).toEqual({ verdict: "pass" });
    expect(turn.items.map((item) => item.kind)).toEqual(["note", "compacted"]);
    expect(turn.items[0]).toMatchObject({ kind: "note", text: "tools are off" });
  });

  it("a thinking takes its text from the stigmer.agent.thinking that follows it", () => {
    const fold = foldSession([
      user(R, "go"),
      ev(R, { case: "agentThinking", value: { id: `${R}.root.t0` } }),
      ev(R, { case: "stigmerAgentThinking", value: { id: `${R}.root.t0.text`, thinkingId: `${R}.root.t0`, text: "weigh it" } }),
    ]);
    expect(fold.turns[0]!.items[0]).toMatchObject({ kind: "thinking", text: "weigh it", live: false });
  });
});

describe("tool uses", () => {
  it("an ask waits for its answer; allow runs it, deny denies it, and the answer and grant are on the tool use", () => {
    const log = new SessionLog();
    log.apply([
      user(R, "go"),
      phase(R, "running"),
      use(R, "c1", "shell", { permission: "ask" }),
      ev(R, { case: "stigmerPermissionAsked", value: { id: `${R}.c1.ask`, toolUseId: `${R}.c1`, message: "Run npm test", argsPreview: "{}", policySource: "builtin_category" } }),
      use(R, "c2", "write_file", { permission: "ask" }),
      phase(R, "waiting"),
      ev(R, { case: "sessionStatusIdle", value: { id: "idle", stopReason: { type: "requires_action", eventIds: [`${R}.c1`, `${R}.c2`] } } }),
    ]);
    let turn = log.snapshot().turns[0]!;
    expect(turn.asks.map((ask) => [ask.id, ask.state, ask.ask?.message ?? ""])).toEqual([
      [`${R}.c1`, "waiting", "Run npm test"],
      [`${R}.c2`, "waiting", ""],
    ]);
    expect(log.snapshot().status).toEqual({ state: "idle", stopReason: "requires_action", waitingOn: [`${R}.c1`, `${R}.c2`] });

    log.apply([
      ev(R, { case: "userToolConfirmation", value: { id: "conf1", toolUseId: `${R}.c1`, result: "allow" } }),
      ev(R, { case: "stigmerPermissionGrant", value: { id: "grant1", toolUseId: `${R}.c1`, scope: "turn", lease: { category: "shell" } } }),
      ev(R, { case: "userToolConfirmation", value: { id: "conf2", toolUseId: `${R}.c2`, result: "deny", denyMessage: "not that file" } }),
      ev(R, { case: "sessionStatusRunning", value: { id: "running" } }),
    ]);
    turn = log.snapshot().turns[0]!;
    const [shell, write] = toolsOf(turn.items);
    expect(turn.asks).toEqual([]);
    expect([shell!.state, shell!.confirmation?.result, shell!.grant?.category, shell!.grant?.hook]).toEqual(["running", "allow", "shell", undefined]);
    expect([write!.state, write!.confirmation?.denyMessage]).toEqual(["denied", "not that file"]);
    expect(log.snapshot().status).toEqual({ state: "running", stopReason: "", waitingOn: [] });
  });

  it("failed, denied by a rule, stopped by its turn's end, and an MCP call with its result", () => {
    const fold = foldSession([
      user(R, "go"),
      use(R, "c1", "read"),
      result(R, "c1", "no such file", { isError: true }),
      use(R, "c2", "rm", { permission: "deny" }),
      use(R, "c3", "list_issues", { mcp: "github" }),
      result(R, "c3", "[]", { mcp: true }),
      use(R, "c4", "sleep"),
      use(R, "c5", "shell", { permission: "ask" }),
      phase(R, "cancelled", { stopCause: "user" }),
    ]);
    expect(toolsOf(fold.turns[0]!.items).map((tool) => [tool.name, tool.mcpServerName, tool.state])).toEqual([
      ["read", "", "failed"],
      ["rm", "", "denied"],
      ["list_issues", "github", "completed"],
      ["sleep", "", "stopped"],
      ["shell", "", "stopped"],
    ]);
    expect(fold.turns[0]!.asks).toEqual([]);
  });

  it("a result, an ask, an answer and a full output that come before their tool use are held until it does", () => {
    const fold = foldSession([
      user(R, "go"),
      result(R, "c1", "head"),
      ev(R, { case: "stigmerToolResultFullOutput", value: { id: `${R}.c1.full`, toolUseId: `${R}.c1`, storageKey: `artifacts/${R}/k`, sizeBytes: 9n, contentHash: "h", mimeType: "text/plain" } }),
      use(R, "c1", "read"),
    ]);
    const tool = toolsOf(fold.turns[0]!.items)[0]!;
    expect([tool.state, tool.result?.text, tool.fullOutput?.storageKey, tool.fullOutput?.sizeBytes]).toEqual(["completed", "head", `artifacts/${R}/k`, 9n]);
  });

  it("takes a full output only from the tool use's own run, under that run's artifacts", () => {
    const full = (runId: string, storageKey: string, id: string) =>
      ev(runId, { case: "stigmerToolResultFullOutput", value: { id, toolUseId: `${R}.c1`, storageKey, sizeBytes: 9n } });
    const fullOf = (...events: SessionEvent[]) =>
      toolsOf(foldSession([user(R, "go"), use(R, "c1", "read"), result(R, "c1", "head"), ...events]).turns[0]!.items)[0]!.fullOutput;
    expect(fullOf(full(R, `artifacts/${R}/toolcalls/c1.txt`, "f1"))?.storageKey).toBe(`artifacts/${R}/toolcalls/c1.txt`);
    expect(fullOf(full(R, "artifacts/run_other/toolcalls/c1.txt", "f2")), "another run's artifact").toBeUndefined();
    expect(fullOf(full(R, `artifacts/${R}/../run_other/c1.txt`, "f3")), "a key that climbs out of the run").toBeUndefined();
    expect(fullOf(full(R2, `artifacts/${R2}/toolcalls/c1.txt`, "f4")), "written under another run").toBeUndefined();
    expect(fullOf(full(R, `uploads/${R}/c1.txt`, "f5")), "outside the artifacts").toBeUndefined();
  });

  it("an answer naming something the log never shows stays held, through later events, and changes nothing", () => {
    const fold = foldSession([user(R, "go"), result(R, "ghost", "x"), said(R, 0, "later")]);
    expect(fold.turns[0]!.items.map((item) => item.kind)).toEqual(["message"]);
  });

  it("an answer naming a message, not a tool use, changes nothing", () => {
    const fold = foldSession([user(R, "go"), said(R, 0, "hi"), ev(R, { case: "userToolConfirmation", value: { id: "c", toolUseId: `${R}.root.m0`, result: "allow" } })]);
    expect(fold.turns[0]!.items.map((item) => item.kind)).toEqual(["message"]);
  });
});

describe("threads", () => {
  it("a task call opens a thread; its items, agent, input and reply are the thread's, and an ask inside it is the turn's", () => {
    const thread = `${R}.task1`;
    const fold = foldSession([
      user(R, "go"),
      use(R, "task1", "task", { input: { description: "research" } }),
      ev(R, { case: "sessionThreadCreated", value: { id: `${thread}.created`, agentName: "researcher", sessionThreadId: thread } }),
      ev(R, { case: "agentThreadMessageSent", value: { id: `${thread}.sent`, toSessionThreadId: thread, toAgentName: "researcher", content: text("find it") } }),
      ev(R, { case: "sessionThreadStatusRunning", value: { id: `${thread}.running`, agentName: "researcher", sessionThreadId: thread } }),
      said(R, 0, "Looking.", "task1", thread),
      use(R, "s1", "shell", { permission: "ask", threadId: thread }),
    ]);
    let tool = toolsOf(fold.turns[0]!.items)[0]!;
    expect([tool.thread?.agentName, tool.thread?.input, tool.thread?.state, tool.thread?.items.length]).toEqual(["researcher", "find it", "running", 2]);
    expect(fold.turns[0]!.asks.map((ask) => ask.id)).toEqual([`${R}.s1`]);

    const done = foldSession([
      user(R, "go"),
      use(R, "task1", "task"),
      ev(R, { case: "sessionThreadCreated", value: { id: `${thread}.created`, agentName: "researcher", sessionThreadId: thread } }),
      ev(R, { case: "agentThreadMessageReceived", value: { id: `${thread}.received`, fromSessionThreadId: thread, content: text("found") } }),
      ev(R, { case: "sessionThreadStatusIdle", value: { id: `${thread}.idle`, agentName: "researcher", sessionThreadId: thread, stopReason: { type: "end_turn" } } }),
      result(R, "task1", "found"),
    ]);
    tool = toolsOf(done.turns[0]!.items)[0]!;
    expect([tool.thread?.reply, tool.thread?.state, tool.state]).toEqual(["found", "completed", "completed"]);

    const failed = foldSession([
      user(R, "go"),
      use(R, "task1", "task"),
      ev(R, { case: "sessionThreadStatusIdle", value: { id: `${thread}.idle`, sessionThreadId: thread, stopReason: { type: "retries_exhausted" } } }),
    ]);
    expect(toolsOf(failed.turns[0]!.items)[0]!.thread?.state).toBe("failed");

    const stopped = foldSession([user(R, "go"), use(R, "task1", "task"), ev(R, { case: "sessionThreadCreated", value: { id: `${thread}.created`, sessionThreadId: thread } }), phase(R, "terminated")]);
    expect(toolsOf(stopped.turns[0]!.items)[0]!.thread?.state).toBe("stopped");
  });
});

describe("a turn's end without its own status", () => {
  it("ends once a later turn begins, or once the session idles for anything but its open asks", () => {
    expect(foldSession([user(R, "a"), user(R2, "b")]).turns.map((t) => t.ended)).toEqual([true, false]);
    expect(foldSession([user(R, "a")]).turns[0]!.ended).toBe(false);
    expect(foldSession([user(R, "a"), ev(R, { case: "sessionStatusRunning", value: { id: "r" } })]).turns[0]!.ended).toBe(false);
    const idle = (reason: string, ids: string[] = []) => ev(R, { case: "sessionStatusIdle", value: { id: `idle.${seq}`, stopReason: { type: reason, eventIds: ids } } });
    expect(foldSession([user(R, "a"), idle("end_turn")]).turns[0]!.ended).toBe(true);
    expect(foldSession([user(R, "a"), use(R, "c1", "shell", { permission: "ask" }), idle("requires_action", [`${R}.c1`])]).turns[0]!.ended).toBe(false);
    expect(foldSession([user(R, "a"), use(R, "c1", "shell", { permission: "ask" }), idle("requires_action", ["other"])]).turns[0]!.ended).toBe(true);
  });
});

describe("previews", () => {
  it("a live message grows with its deltas and its stored event replaces it in place", () => {
    const log = new SessionLog();
    log.apply([user(R, "go"), said(R, 0, "First.")]);
    const id = `${R}.root.m1`;
    expect(log.applyFrame(frame({ case: "eventStart", value: { event: { id, type: "agent.message" } } }))).toBe(true);
    log.applyFrame(frame({ case: "eventDelta", value: { eventId: id, delta: { type: "content_delta", index: 0, content: { type: "text", text: "Sec" } } } }));
    log.applyFrame(frame({ case: "eventDelta", value: { eventId: id, delta: { type: "content_delta", index: 0, content: { type: "text", text: "ond" } } } }));
    let items = log.snapshot().turns[0]!.items as MessageItem[];
    expect(items.map((item) => [item.text, item.live])).toEqual([
      ["First.", false],
      ["Second", true],
    ]);
    expect(log.snapshot().turns[0]!.answer).toBe("First.");
    log.applyFrame(frame({ case: "event", value: said(R, 1, "Second.") }));
    items = log.snapshot().turns[0]!.items as MessageItem[];
    expect(items.map((item) => [item.text, item.live])).toEqual([
      ["First.", false],
      ["Second.", false],
    ]);
    expect(log.snapshot().turns[0]!.answer).toBe("Second.");
  });

  it("a live thinking opens in its thread; a delta for an unknown or stored event, and a start for a stored one, change nothing", () => {
    const log = new SessionLog();
    const thread = `${R}.task1`;
    log.apply([user(R, "go"), use(R, "task1", "task"), said(R, 0, "Stored.")]);
    log.applyFrame(frame({ case: "eventStart", value: { event: { id: `${R}.task1.t0`, type: "agent.thinking" } } }));
    const tool = toolsOf(log.snapshot().turns[0]!.items)[0]!;
    expect(tool.thread?.id).toBe(thread);
    expect((tool.thread?.items[0] as ThinkingItem).live).toBe(true);
    expect(log.applyFrame(frame({ case: "eventStart", value: { event: { id: `${R}.root.m0`, type: "agent.message" } } }))).toBe(false);
    expect(log.applyFrame(frame({ case: "eventDelta", value: { eventId: `${R}.root.m0`, delta: { type: "content_delta", content: { type: "text", text: "x" } } } }))).toBe(false);
    expect(log.applyFrame(frame({ case: "eventDelta", value: { eventId: "nope", delta: { type: "content_delta", content: { type: "text", text: "x" } } } }))).toBe(false);
    expect(log.applyFrame(frame({ case: "eventStart", value: { event: { id: "not-a-derived-id", type: "agent.message" } } }))).toBe(false);
    expect(log.applyFrame(frame({ case: "eventStart", value: {} }))).toBe(false);
    expect(log.applyFrame(frame({ case: undefined }))).toBe(false);
    log.apply([ev(R, { case: "agentThinking", value: { id: `${R}.task1.t0` } }, thread)]);
    expect((toolsOf(log.snapshot().turns[0]!.items)[0]!.thread?.items[0] as ThinkingItem).live).toBe(false);
  });

  it("a running tool's output grows until its result, including output that arrives before its tool use", () => {
    const log = new SessionLog();
    log.apply([user(R, "go")]);
    log.applyFrame(frame({ case: "stigmerToolOutputDelta", value: { toolUseId: `${R}.c1`, delta: "PA" } }));
    log.apply([use(R, "c1", "shell")]);
    log.applyFrame(frame({ case: "stigmerToolOutputDelta", value: { toolUseId: `${R}.c1`, delta: "SS" } }));
    expect(toolsOf(log.snapshot().turns[0]!.items)[0]!.liveOutput).toBe("PASS");
    log.apply([result(R, "c1", "PASS\n")]);
    expect(toolsOf(log.snapshot().turns[0]!.items)[0]!.liveOutput).toBe("");
    expect(log.applyFrame(frame({ case: "stigmerToolOutputDelta", value: { toolUseId: `${R}.c1`, delta: "late" } }))).toBe(false);
  });

  it("a working turn's newest liveness names what is open, less what returned, until the turn ends", () => {
    const log = new SessionLog();
    log.apply([user(R, "go"), use(R, "c1", "shell"), use(R, "c2", "task")]);
    expect(log.snapshot().turns[0]!.liveness).toBeUndefined();
    log.applyFrame(
      frame({
        case: "stigmerRunLiveness",
        value: {
          runId: R,
          operations: [
            { toolUseId: `${R}.c1`, name: "shell", elapsed: { seconds: 840n, nanos: 500_000_000 } },
            { toolUseId: `${R}.c2.c3`, name: "execute", threadId: `${R}.c2`, elapsed: { seconds: 5n } },
            { toolUseId: `${R}.c9`, name: "grep" },
          ],
        },
      }),
    );
    expect(log.snapshot().turns[0]!.liveness).toEqual({
      operations: [
        { toolUseId: `${R}.c1`, name: "shell", threadId: "", elapsedMs: 840_500 },
        { toolUseId: `${R}.c2.c3`, name: "execute", threadId: `${R}.c2`, elapsedMs: 5_000 },
        { toolUseId: `${R}.c9`, name: "grep", threadId: "", elapsedMs: 0 },
      ],
      awaitingModelMs: undefined,
    });
    const before = log.snapshot().turns[0]!.liveness;
    log.apply([said(R, 0, "Unrelated.")]);
    expect(log.snapshot().turns[0]!.liveness).toBe(before);
    log.apply([result(R, "c1", "done")]);
    expect(log.snapshot().turns[0]!.liveness?.operations.map((operation) => operation.toolUseId)).toEqual([`${R}.c2.c3`, `${R}.c9`]);
    log.applyFrame(frame({ case: "stigmerRunLiveness", value: { runId: R, awaitingModelFor: { seconds: 120n } } }));
    expect(log.snapshot().turns[0]!.liveness).toEqual({ operations: [], awaitingModelMs: 120_000 });
    log.apply([phase(R, "completed")]);
    expect(log.snapshot().turns[0]!.liveness).toBeUndefined();
  });

  it("a liveness for a run the log has not shown changes nothing", () => {
    const log = new SessionLog();
    log.apply([user(R, "go")]);
    expect(log.applyFrame(frame({ case: "stigmerRunLiveness", value: { runId: R2 } }))).toBe(false);
    expect(log.snapshot().turns).toHaveLength(1);
  });

  it("reads a preview's place from its derived id", () => {
    expect(previewPlaceOf("run_1.root.m3")).toEqual({ runId: "run_1", threadId: "" });
    expect(previewPlaceOf("run_1.call_9.t0")).toEqual({ runId: "run_1", threadId: "run_1.call_9" });
    expect(previewPlaceOf("run_1.root.n3")).toBeUndefined();
  });
});

describe("background commands", () => {
  type StatusInit = { phase: "running" | "ended"; timeoutSeconds?: number; ending?: string; exitCode?: number; stoppedBy?: string; stoppedByToolUseId?: string; output?: string; endedAt?: string };
  function status(runId: string, call: string, init: StatusInit, threadId = ""): SessionEvent {
    const toolUseId = `${runId}.${call}`;
    return ev(
      runId,
      {
        case: "stigmerBackgroundCommandStatus",
        value: { id: `${toolUseId}.${init.phase === "running" ? "bg" : "bg.end"}`, toolUseId, sessionThreadId: threadId, processedAt: `t-${init.phase}`, ...init },
      },
      threadId,
    );
  }
  const started = (runId: string, call: string) => [use(runId, call, "execute", { input: { command: "npm run dev", background: true } }), result(runId, call, "Started in the background (id x).")];

  it("keeps the start's result and adds the command's life, its output streamed after the result until it ends", () => {
    const log = new SessionLog();
    log.apply([user(R, "go"), phase(R, "running"), ...started(R, "bg1"), status(R, "bg1", { phase: "running", timeoutSeconds: 3300 })]);
    log.applyFrame(frame({ case: "stigmerToolOutputDelta", value: { toolUseId: `${R}.bg1`, delta: "ready on :3000\n" } }));
    let tool = toolsOf(log.snapshot().turns[0]!.items)[0]!;
    expect(tool.state, "the call completed: the start and the command are two facts").toBe("completed");
    expect(tool.result?.text).toBe("Started in the background (id x).");
    expect(tool.liveOutput).toBe("");
    expect(tool.background).toMatchObject({ state: "running", timeoutSeconds: 3300, liveOutput: "ready on :3000\n", startedAt: "t-running", stopRequested: false });
    expect(isBackgroundRunning(tool)).toBe(true);

    log.apply([status(R, "bg1", { phase: "ended", ending: "exited", exitCode: 1, output: "ready on :3000\ncrash\n", endedAt: "t-end" })]);
    expect(log.applyFrame(frame({ case: "stigmerToolOutputDelta", value: { toolUseId: `${R}.bg1`, delta: "late" } })), "output after the end is dropped").toBe(false);
    tool = toolsOf(log.snapshot().turns[0]!.items)[0]!;
    expect(tool.background).toMatchObject({ state: "exited", exitCode: 1, output: "ready on :3000\ncrash\n", endedAt: "t-end", liveOutput: "" });
    expect(isBackgroundRunning(tool)).toBe(false);
    log.apply([
      ev(R, {
        case: "stigmerBackgroundCommandStatus",
        value: { id: `${R}.bg1.bg.end.again`, toolUseId: `${R}.bg1`, phase: "ended", ending: "stopped", stoppedBy: "person" },
      }),
    ]);
    expect(toolsOf(log.snapshot().turns[0]!.items)[0]!.background?.state, "the first ending is final, even against a second event").toBe("exited");
  });

  it("says who stopped one, keeps a person's stop request, and links the agent's stop call to the command", () => {
    const fold = foldSession([
      user(R, "go"),
      phase(R, "running"),
      ...started(R, "bg1"),
      ...started(R, "bg2"),
      status(R, "bg1", { phase: "running" }),
      status(R, "bg2", { phase: "running" }),
      ev(R, { case: "stigmerBackgroundCommandStopRequested", value: { id: "sevt_bs_1", toolUseId: `${R}.bg1` } }),
      status(R, "bg1", { phase: "ended", ending: "stopped", stoppedBy: "person", output: "half" }),
      use(R, "stop1", "stop_background_command", { input: { id: "bg2" } }),
      result(R, "stop1", "stopped"),
      status(R, "bg2", { phase: "ended", ending: "stopped", stoppedBy: "agent", stoppedByToolUseId: `${R}.stop1` }),
      ...started(R, "bg3"),
      status(R, "bg3", { phase: "running" }),
      status(R, "bg3", { phase: "ended", ending: "something new", stoppedBy: "someone new" }),
    ]);
    const [bg1, bg2, stop, bg3] = toolsOf(fold.turns[0]!.items);
    expect(bg1!.background).toMatchObject({ state: "stopped", stoppedBy: "person", stopRequested: true, output: "half" });
    expect(bg2!.background).toMatchObject({ state: "stopped", stoppedBy: "agent", stoppedByToolUseId: `${R}.stop1` });
    expect(stop!.stoppedBackground).toEqual({ toolUseId: `${R}.bg2`, input: { command: "npm run dev", background: true } });
    expect(bg1!.stoppedBackground).toBeUndefined();
    expect(bg3!.background, "a word the contract does not list reads as a stop by no one named").toMatchObject({ state: "stopped", stoppedBy: undefined });
  });

  it("holds a status or a stop request that names a tool use the log has not shown yet", () => {
    const fold = foldSession([
      user(R, "go"),
      status(R, "bg1", { phase: "running", timeoutSeconds: 60 }),
      ev(R, { case: "stigmerBackgroundCommandStopRequested", value: { id: "sevt_bs_1", toolUseId: `${R}.bg1` } }),
      status(R, "bg1", { phase: "ended", ending: "timed_out", endedAt: "t-end" }),
      ...started(R, "bg1"),
    ]);
    expect(toolsOf(fold.turns[0]!.items)[0]!.background).toMatchObject({ state: "timed_out", timeoutSeconds: 60, stopRequested: true });
  });

  it("dates a command's start by its end when the log holds no running status", () => {
    const fold = foldSession([user(R, "go"), ...started(R, "bg1"), status(R, "bg1", { phase: "ended", ending: "failed_to_start", output: "no shell" })]);
    expect(toolsOf(fold.turns[0]!.items)[0]!.background).toMatchObject({ state: "failed_to_start", startedAt: "t-ended", output: "no shell" });
  });

  it("reads a command its ended turn never ended as stopped by the turn, with what it printed so far", () => {
    const log = new SessionLog();
    log.apply([user(R, "go"), phase(R, "running"), ...started(R, "bg1"), status(R, "bg1", { phase: "running" })]);
    log.applyFrame(frame({ case: "stigmerToolOutputDelta", value: { toolUseId: `${R}.bg1`, delta: "partial" } }));
    log.apply([phase(R, "failed", { error: "the runner was lost" })]);
    const tool = toolsOf(log.snapshot().turns[0]!.items)[0]!;
    expect(tool.background).toMatchObject({ state: "stopped", stoppedBy: "turn", output: "partial", liveOutput: "", endedAt: "" });
    expect(isBackgroundRunning(tool)).toBe(false);
  });

  it("gives every other tool use no background and no stopped command", () => {
    const fold = foldSession([user(R, "go"), use(R, "c1", "read"), result(R, "c1", "x")]);
    const tool = toolsOf(fold.turns[0]!.items)[0]!;
    expect([tool.background, tool.stoppedBackground]).toEqual([undefined, undefined]);
  });
});

describe("duplicates", () => {
  it("an event already folded, by id, folds once; an older seq does not move the place back", () => {
    const log = new SessionLog();
    const events = [user(R, "go"), said(R, 0, "Once.")];
    log.apply(events);
    expect(log.apply(events)).toBe(false);
    expect(log.snapshot().turns[0]!.items).toHaveLength(1);
    expect(log.snapshot().lastSeq).toBe(events[1]!.seq);
  });
});

describe("file review", () => {
  const set = `${R}:0`;
  function changes(): SessionEvent {
    return ev(R, {
      case: "stigmerFileReviewChanges",
      value: {
        id: `${R}.fr0`,
        changeSetId: set,
        aggregateDigest: "agg",
        files: [
          { fileChangeId: `${set}:a.md`, path: "a.md", change: "modified", digest: "da", linesAdded: 1, linesRemoved: 0, reviewable: "complete" },
          { fileChangeId: `${set}:b.md`, path: "b.md", change: "added", digest: "db", linesAdded: 3, reviewable: "complete" },
          { fileChangeId: `${set}:c.md`, path: "c.md", previousPath: "old.md", change: "renamed", digest: "dc", reviewable: "complete" },
        ],
      },
    });
  }
  function decided(id: string, scope: string, file: string, action: string, origin = "person"): SessionEvent {
    return ev(R, { case: "stigmerFileReviewDecided", value: { id, changeSetId: set, scope, fileChangeId: file, action, origin } });
  }
  function reconciled(decidedId: string, failure = ""): SessionEvent {
    return ev("run_reconcile", {
      case: "stigmerFileReviewReconciled",
      value: { id: `${R}.fr0.r.${decidedId}`, changeSetId: set, undonePaths: failure === "" ? ["a.md"] : [], failure },
    });
  }

  it("each file is undecided, kept, undoing, undone or failed to undo, by its newest decision", () => {
    const fold = foldSession([
      user(R, "go"),
      changes(),
      decided("d1", "file", `${set}:a.md`, "undo"),
      reconciled("d1"),
      decided("d2", "file", `${set}:b.md`, "undo"),
      decided("d3", "file", `${set}:c.md`, "undo"),
      reconciled("d3", "hash_mismatch"),
    ]);
    const review = fold.turns[0]!.fileReview[0]!;
    expect(review.files.map((file) => [file.path, file.state, file.decidedBy])).toEqual([
      ["a.md", "undone", "person"],
      ["b.md", "undoing", "person"],
      ["c.md", "undo_failed", "person"],
    ]);
    expect(review.files[2]!.previousPath).toBe("old.md");
    expect(review.undecided).toBe(false);
    expect(fold.turns.map((turn) => turn.runId)).toEqual([R, "run_reconcile"]);
  });

  it("a change-set decision decides every file; a later file decision overrides it", () => {
    const fold = foldSession([user(R, "go"), changes(), decided("d1", "change_set", "", "keep", "next_turn"), decided("d2", "file", `${set}:b.md`, "undo")]);
    const review = fold.turns[0]!.fileReview[0]!;
    expect(review.files.map((file) => [file.state, file.decidedBy])).toEqual([
      ["kept", "next_turn"],
      ["undoing", "person"],
      ["kept", "next_turn"],
    ]);
    expect(review.decisions.map((d) => [d.scope, d.action])).toEqual([
      ["change_set", "keep"],
      ["file", "undo"],
    ]);
  });

  it("an undecided set says so; a decision before its set is held, a second changes event for the set is ignored", () => {
    const again = changes();
    if (again.event.case === "stigmerFileReviewChanges") {
      again.event.value.id = `${R}.fr0.again`;
    }
    const fold = foldSession([user(R, "go"), decided("d1", "file", `${set}:a.md`, "keep"), changes(), again]);
    const review = fold.turns[0]!.fileReview;
    expect(review).toHaveLength(1);
    expect(review[0]!.files.map((file) => file.state)).toEqual(["kept", "undecided", "undecided"]);
    expect(review[0]!.undecided).toBe(true);
  });

  it("a set no event touched is shared between snapshots of its turn", () => {
    const log = new SessionLog();
    log.apply([user(R, "go"), changes()]);
    const before = log.snapshot().turns[0]!.fileReview[0];
    log.apply([said(R, 0, "more")]);
    expect(log.snapshot().turns[0]!.fileReview[0]).toBe(before);
  });

  it("a reconcile whose id does not name its decision matches none", () => {
    const fold = foldSession([
      user(R, "go"),
      changes(),
      decided("d1", "file", `${set}:a.md`, "undo"),
      ev(R, { case: "stigmerFileReviewReconciled", value: { id: "other", changeSetId: set, undonePaths: ["a.md"] } }),
    ]);
    expect(fold.turns[0]!.fileReview[0]!.files[0]!.state).toBe("undoing");
  });
});

describe("to-do lists", () => {
  it("the primary thread's completed to-do calls replace or merge the list; a failed one, an MCP one and a sub-agent's do not", () => {
    const thread = `${R}.task1`;
    const fold = foldSession([
      user(R, "go"),
      use(R, "t1", "write_todos", { input: { todos: [{ content: "read", status: "pending" }, { content: "write", status: "in_progress" }] } }),
      result(R, "t1", "ok"),
      use(R, "t2", "updateTodos", { input: { merge: true, todos: [{ id: "todo-0", content: "read", status: "completed" }] } }),
      result(R, "t2", "ok"),
      use(R, "t3", "write_todos", { input: { todos: [] } }),
      result(R, "t3", "bad", { isError: true }),
      use(R, "t4", "write_todos", { mcp: "x", input: { todos: [] } }),
      result(R, "t4", "ok", { mcp: true }),
      use(R, "task1", "task"),
      use(R, "t5", "write_todos", { threadId: thread, input: { todos: [] } }),
      result(R, "t5", "ok", { threadId: thread }),
    ]);
    expect(fold.turns[0]!.todos.map((todo) => [todo.id, todo.content, todo.status, todo.updatedAt])).toEqual([
      ["todo-0", "read", "completed", "tr"],
      ["todo-1", "write", "in_progress", "tr"],
    ]);
  });
});

describe("snapshots", () => {
  it("share every turn and item no event touched, and answer the same object while nothing changed", () => {
    const log = new SessionLog();
    log.apply([user(R, "a"), said(R, 0, "one"), phase(R, "completed"), user(R2, "b"), said(R2, 0, "two")]);
    const first = log.snapshot();
    expect(log.snapshot()).toBe(first);
    log.apply([said(R2, 1, "three")]);
    const second = log.snapshot();
    expect(second.turns[0]).toBe(first.turns[0]);
    expect(second.turns[1]).not.toBe(first.turns[1]);
    expect(second.turns[1]!.items[0]).toBe(first.turns[1]!.items[0]);
    log.apply([ev(R2, { case: "sessionStatusRunning", value: { id: "r" } })]);
    const third = log.snapshot();
    expect(third.turns).toBe(second.turns);
    expect(third.status.state).toBe("running");
  });

  it("a thread's items are shared while nothing in them changed", () => {
    const thread = `${R}.task1`;
    const log = new SessionLog();
    log.apply([user(R, "a"), use(R, "task1", "task"), said(R, 0, "in", "task1", thread)]);
    const before = toolsOf(log.snapshot().turns[0]!.items)[0]!.thread!;
    log.apply([said(R, 0, "after")]);
    expect(toolsOf(log.snapshot().turns[0]!.items)[0]!.thread).toBe(before);
  });
});

describe("textOf", () => {
  it("joins the text blocks and skips any other", () => {
    expect(textOf([{ type: "text", text: "a" }, { type: "image", text: "" }, { type: "text", text: "b" }] as never)).toBe("ab");
  });
});

describe("messages sent while a turn works", () => {
  function queuedMessage(id: string, message: string): SessionEvent {
    return ev("", { case: "userMessage", value: { id, content: text(message), processedAt: "" } });
  }
  function readBy(runId: string, id: string, message: string): SessionEvent {
    return ev(runId, { case: "userMessage", value: { id, content: text(message), processedAt: "tq" } });
  }

  it("holds a queued message until a run's copy replaces it, then lists it where it was read", () => {
    const log = new SessionLog();
    log.apply([user(R, "build"), phase(R, "running"), said(R, 0, "Building."), use(R, "c1", "execute"), queuedMessage("q1", "also the README")]);
    const queued = log.snapshot();
    expect(queued.queued).toEqual([{ id: "q1", text: "also the README", state: "waiting" }]);
    expect(queued.turns).toHaveLength(1);

    log.apply([result(R, "c1", "built"), readBy(R, "q1", "also the README"), said(R, 1, "Updating the README too.")]);
    const read = log.snapshot();
    expect(read.queued).toEqual([]);
    expect(read.turns[0]!.userMessage?.text).toBe("build");
    expect(read.turns[0]!.items.map((item) => item.kind)).toEqual(["message", "tool_use", "user_message", "message"]);
    expect(read.turns[0]!.items[2]).toEqual({ kind: "user_message", id: "q1", text: "also the README", processedAt: "tq" });
  });

  it("makes a queued message the first of the turn that starts with it", () => {
    const fold = foldSession([
      user(R, "build"),
      queuedMessage("q1", "then test"),
      phase(R, "completed"),
      readBy(R2, "q1", "then test"),
      phase(R2, "running"),
    ]);
    expect(fold.queued).toEqual([]);
    expect(fold.turns.map((turn) => [turn.runId, turn.userMessage?.id])).toEqual([
      [R, `${R}.user`],
      [R2, "q1"],
    ]);
  });

  it("joins the messages a turn starts with, read before any item of its own, into its request", () => {
    const fold = foldSession([
      user(R, "build"),
      queuedMessage("q1", "then test"),
      queuedMessage("q2", "and lint"),
      phase(R, "completed"),
      readBy(R2, "q1", "then test"),
      readBy(R2, "q2", "and lint"),
      phase(R2, "running"),
      said(R2, 0, "Testing."),
    ]);
    const second = fold.turns[1]!;
    expect(second.userMessage).toEqual({ id: "q1", text: "then test\n\nand lint", processedAt: "tq", joinedIds: ["q2"] });
    expect(second.items.map((item) => item.kind)).toEqual(["message"]);
  });

  it("ignores a stale queued sighting of a message already read", () => {
    const fold = foldSession([user(R, "build"), readBy(R, "q1", "late"), queuedMessage("q1", "late")]);
    expect(fold.queued).toEqual([]);
  });

  it("drops what still waits at a stop or a session error of no turn, and keeps a message sent after it waiting", () => {
    const interrupted = foldSession([
      user(R, "build"),
      queuedMessage("q1", "one"),
      ev("", { case: "userInterrupt", value: { id: "int1", processedAt: "ti" } }),
      queuedMessage("q2", "two"),
    ]);
    expect(interrupted.queued).toEqual([
      { id: "q1", text: "one", state: "dropped" },
      { id: "q2", text: "two", state: "waiting" },
    ]);
    const refused = foldSession([
      user(R, "build"),
      queuedMessage("q1", "one"),
      ev("", { case: "sessionError", value: { id: "e1", error: { type: "unknown_error", message: "not read" }, processedAt: "te" } }),
    ]);
    expect(refused.queued).toEqual([{ id: "q1", text: "one", state: "dropped" }]);
  });

  it("shares the queue's snapshot while no queued message changes", () => {
    const log = new SessionLog();
    log.apply([user(R, "build"), queuedMessage("q1", "one")]);
    const first = log.snapshot();
    log.apply([said(R, 0, "Working.")]);
    expect(log.snapshot().queued).toBe(first.queued);
  });
});
