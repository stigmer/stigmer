/**
 * The background middleware's hooks, driven directly over hand-built
 * threads and a registry whose commands end when the test says
 * (`middleware/background-commands.ts`):
 *  - an ended command is told once, cut to the run's budget, with its file,
 *    and nothing is written for the person (the command's own status says
 *    it); a thread that holds the notice (a saved and reloaded one) is not
 *    told again, nor one the agent stopped itself; a person's stop is told
 *    as theirs;
 *  - a start this invocation does not hold is told as stopped, with the
 *    reason this invocation knows (an approval pause or an interruption);
 *  - at a round's end with commands running: a reminder once, then a wait
 *    that holds the watchdog (its start and end on the custom stream) and
 *    wakes on an ending, on a person's message (handed on, at a pending
 *    hint or at the periodic claim on a fake clock), or on the stop; a
 *    yield ends the root's wait and not a sub-agent's;
 *  - a sub-agent waits only on the commands its own thread started.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import {
  BACKGROUND_WAIT_EVENT,
  createBackgroundCommandsMiddleware,
  noticeIdOf,
  type BackgroundCommandsMiddlewareConfig,
} from "../background-commands.js";
import { BackgroundCommands, type BackgroundOutputPaths } from "../../shared/shell/background-commands.js";
import type { CommandResult } from "../../shared/shell/run-command.js";
import type { TurnInputChannel, TurnMessage } from "../../harness/turn-input.js";
import type { StigmerMiddleware } from "../types.js";

const PATHS: BackgroundOutputPaths = { virtual: (id) => `/large_tool_results/background-${id}.log`, real: (id) => `/tmp/background-${id}.log` };

function exited(exitCode: number, stdout = ""): CommandResult {
  return { stdout, stderr: "", exitCode, timedOut: false, aborted: false, truncated: false };
}

/** A registry whose commands end when `end(id, result)` is called. */
function scriptedCommands(): { commands: BackgroundCommands; start: (id: string, command: string) => void; end: (id: string, result: CommandResult) => void } {
  const commands = new BackgroundCommands();
  const enders = new Map<string, (result: CommandResult) => void>();
  return {
    commands,
    start: (id, command) => {
      commands.start({
        id,
        command,
        timeoutSeconds: 60,
        outputPath: undefined,
        run: ({ signal }) =>
          new Promise<CommandResult>((resolve) => {
            enders.set(id, resolve);
            signal.addEventListener("abort", () => resolve({ ...exited(0), exitCode: null, aborted: true }), { once: true });
          }),
      });
    },
    end: (id, result) => enders.get(id)!(result),
  };
}

/** The thread after a background start: the call, its start result, and `after`. */
function threadWith(starts: ReadonlyArray<{ readonly id: string; readonly command: string }>, ...after: BaseMessage[]): BaseMessage[] {
  return [
    new HumanMessage({ content: "go" }),
    new AIMessage({ content: "", tool_calls: starts.map((s) => ({ id: s.id, name: "execute", args: { command: s.command, background: true } })) }),
    ...starts.map((s) => new ToolMessage({ content: "Started", tool_call_id: s.id, name: "execute", artifact: { background: { id: s.id } } })),
    ...after,
  ];
}

const REPLY = (): AIMessage => new AIMessage({ content: "I am done for now." });

class QueueChannel implements TurnInputChannel {
  readonly queue: TurnMessage[] = [];
  readonly taken: TurnMessage[] = [];
  private readonly listeners = new Set<() => void>();
  send(id: string, notify = true): void {
    this.queue.push({ id, text: "hi", message: [], visionImages: [], visionNotViewable: [] });
    if (notify) for (const listener of this.listeners) listener();
  }
  pending(): boolean {
    return this.queue.length > 0;
  }
  onPending(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async claim(): Promise<TurnMessage[]> {
    const now = this.queue.splice(0);
    this.taken.push(...now);
    return now;
  }
  async claimed(delivered: ReadonlySet<string>): Promise<TurnMessage[]> {
    return this.taken.filter((m) => !delivered.has(m.id));
  }
}

type Hook = (state: Record<string, unknown>, runtime: unknown) => unknown;

function hooks(middleware: StigmerMiddleware): { beforeModel: Hook; afterModel: Hook } {
  const after = middleware.afterModel;
  if (after === undefined || typeof after === "function" || middleware.beforeModel === undefined) throw new Error("expected both hooks, the round-end one with its jump targets");
  expect(after.canJumpTo).toEqual(["model"]);
  return { beforeModel: middleware.beforeModel, afterModel: after.hook };
}

function build(commands: BackgroundCommands, overrides: Partial<BackgroundCommandsMiddlewareConfig> = {}) {
  const written: Array<Record<string, unknown>> = [];
  const runtime = { writer: (chunk: Record<string, unknown>) => written.push(chunk) };
  const middleware = createBackgroundCommandsMiddleware({ commands, outputPaths: PATHS, stopTool: {}, scope: "root", ...overrides });
  return { ...hooks(middleware), runtime, written };
}

type Update = { readonly messages?: BaseMessage[]; readonly jumpTo?: string } | undefined;

function textOf(message: BaseMessage | undefined): string {
  return typeof message?.content === "string" ? message.content : "";
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the background middleware before a model call", () => {
  it("tells an ended command once, cut to the budget, with its file, and writes nothing for the person", async () => {
    const { commands, start, end } = scriptedCommands();
    start("bg_1", "npm test");
    end("bg_1", exited(1, `${"x".repeat(500)}\nFAILED: 3 tests\n`));
    await commands.whenAnyEnds(["bg_1"], new AbortController().signal);
    const { beforeModel, runtime, written } = build(commands, { maxNoticeChars: 120 });

    const update = (await beforeModel({ messages: threadWith([{ id: "bg_1", command: "npm test" }]) }, runtime)) as Update;
    expect(update?.messages).toHaveLength(1);
    const notice = update!.messages![0]!;
    expect(notice.id).toBe(noticeIdOf("bg_1"));
    expect(textOf(notice)).toMatch(/^<background-command id="bg_1" command="npm test" ended="exit 1">\n/);
    expect(textOf(notice)).toContain("FAILED: 3 tests");
    expect(textOf(notice)).toContain("characters omitted");
    expect(textOf(notice)).toContain("Its whole output is in /large_tool_results/background-bg_1.log.");
    expect(written).toEqual([]);

    const saved = threadWith([{ id: "bg_1", command: "npm test" }], ...update!.messages!, REPLY());
    expect(await beforeModel({ messages: saved }, runtime), "a reloaded thread that holds the notice is not told again").toBeUndefined();
  });

  it.each([
    ["timed out", { ...exited(0, "slow\n"), exitCode: null, timedOut: true }, 'ended="timed out"', "slow"],
    ["failed to start", { ...exited(0), exitCode: null, spawnError: "spawn /bin/sh ENOENT" }, 'ended="failed to start"', "spawn /bin/sh ENOENT"],
    ["stopped with the turn", { ...exited(0, "half\n"), exitCode: null, aborted: true }, 'ended="stopped"', "Stopped with the turn."],
  ] as const)("tells a command that %s in its own words", async (_label, ending, attribute, body) => {
    const { commands, start, end } = scriptedCommands();
    start("bg_1", "make");
    end("bg_1", ending);
    await commands.whenAnyEnds(["bg_1"], new AbortController().signal);
    const { beforeModel, runtime, written } = build(commands);
    const update = (await beforeModel({ messages: threadWith([{ id: "bg_1", command: "make" }]) }, runtime)) as Update;
    expect(textOf(update?.messages?.[0])).toContain(attribute);
    expect(textOf(update?.messages?.[0])).toContain(body);
    expect(written).toEqual([]);
  });

  it("tells a command a person stopped as stopped by the person", async () => {
    const { commands, start } = scriptedCommands();
    start("bg_1", "npm run dev");
    await commands.stop("bg_1", "person");
    const { beforeModel, runtime } = build(commands);
    const update = (await beforeModel({ messages: threadWith([{ id: "bg_1", command: "npm run dev" }]) }, runtime)) as Update;
    expect(textOf(update?.messages?.[0])).toContain('ended="stopped by the person"');
    expect(textOf(update?.messages?.[0])).toContain("[Stopped by the person; its processes were stopped]");
  });

  it("does not tell an ending the agent's own stop already answered", async () => {
    const { commands, start } = scriptedCommands();
    start("bg_1", "npm run dev");
    await commands.stop("bg_1", { agent: "stop_1" });
    const { beforeModel, runtime } = build(commands);
    const thread = threadWith(
      [{ id: "bg_1", command: "npm run dev" }],
      new AIMessage({ content: "", tool_calls: [{ id: "stop_1", name: "stop_background_command", args: { id: "bg_1" } }] }),
      new ToolMessage({ content: "stopped", tool_call_id: "stop_1", name: "stop_background_command", artifact: { background: { ended: "bg_1" } } }),
    );
    expect(await beforeModel({ messages: thread }, runtime)).toBeUndefined();
  });

  it("tells nothing of a command still running", async () => {
    const { commands, start } = scriptedCommands();
    start("bg_1", "sleep 30");
    const { beforeModel, runtime } = build(commands);
    expect(await beforeModel({ messages: threadWith([{ id: "bg_1", command: "sleep 30" }]) }, runtime)).toBeUndefined();
    await commands.stopAll();
  });

  it.each([
    ["an interruption", false, "Stopped when the turn was interrupted."],
    ["an approval pause", true, "Stopped when the turn paused for your approval."],
  ])("tells a start an earlier invocation held as stopped at %s", async (_label, approval, body) => {
    const commands = new BackgroundCommands();
    if (approval) commands.resumesApproval();
    const { beforeModel, runtime } = build(commands);
    const update = (await beforeModel({ messages: threadWith([{ id: "bg_1", command: "npm run dev" }]) }, runtime)) as Update;
    expect(textOf(update?.messages?.[0])).toContain('ended="stopped"');
    expect(textOf(update?.messages?.[0])).toContain(body);
  });
});

describe("the background middleware at a round's end", () => {
  it("leaves a round that called tools, and a reply with nothing running", async () => {
    const { commands } = scriptedCommands();
    const { afterModel, runtime } = build(commands);
    const calling = new AIMessage({ content: "", tool_calls: [{ id: "c", name: "ls", args: {} }] });
    expect(await afterModel({ messages: [new HumanMessage("go"), calling] }, runtime)).toBeUndefined();
    expect(await afterModel({ messages: [new HumanMessage("go"), REPLY()] }, runtime)).toBeUndefined();
  });

  it("reminds once, then waits holding the watchdog, and wakes on the ending with its notice", async () => {
    const { commands, start, end } = scriptedCommands();
    start("bg_1", "npm test");
    const { afterModel, runtime, written } = build(commands);
    const thread = threadWith([{ id: "bg_1", command: "npm test" }], REPLY());

    const first = (await afterModel({ messages: thread }, runtime)) as Update;
    expect(first?.jumpTo).toBe("model");
    expect(textOf(first?.messages?.[0])).toContain("<background-commands-running>");
    expect(textOf(first?.messages?.[0])).toContain("bg_1 (`npm test`)");

    const waiting = afterModel({ messages: [...thread, ...first!.messages!, REPLY()] }, runtime) as Promise<Update>;
    await vi.waitFor(() => expect(written).toContainEqual({ name: BACKGROUND_WAIT_EVENT, phase: "started" }));
    end("bg_1", exited(0, "ok\n"));
    const woke = await waiting;
    expect(woke?.jumpTo).toBe("model");
    expect(woke?.messages?.map((m) => m.id)).toEqual([noticeIdOf("bg_1")]);
    expect(written.filter((w) => w.name === BACKGROUND_WAIT_EVENT).map((w) => w.phase)).toEqual(["started", "finished"]);
  });

  it("tells an ending that came between the model call and the round's end, without a reminder", async () => {
    const { commands, start, end } = scriptedCommands();
    start("bg_1", "npm test");
    end("bg_1", exited(0));
    await commands.whenAnyEnds(["bg_1"], new AbortController().signal);
    const { afterModel, runtime } = build(commands);
    const update = (await afterModel({ messages: threadWith([{ id: "bg_1", command: "npm test" }], REPLY()) }, runtime)) as Update;
    expect(update?.messages?.map((m) => m.id)).toEqual([noticeIdOf("bg_1")]);
    expect(commands.takeReminder(), "the reminder was not spent").toBe(true);
  });

  it("hands a person's message that arrives during the wait on to the turn-input middleware", async () => {
    const { commands, start } = scriptedCommands();
    start("bg_1", "npm run dev");
    commands.takeReminder();
    const channel = new QueueChannel();
    const { afterModel, runtime, written } = build(commands, { input: { channel } });
    const waiting = afterModel({ messages: threadWith([{ id: "bg_1", command: "npm run dev" }], REPLY()) }, runtime) as Promise<Update>;
    await vi.waitFor(() => expect(written.length).toBeGreaterThan(0));
    channel.send("msg-1");
    expect(await waiting, "nothing of its own: the next hook delivers the message").toBeUndefined();
    expect(channel.taken.map((m) => m.id)).toEqual(["msg-1"]);
    expect(written.filter((w) => w.name === BACKGROUND_WAIT_EVENT).map((w) => w.phase)).toEqual(["started", "finished"]);
    await commands.stopAll();
  });

  it("keeps waiting through a claim the server does not answer", async () => {
    const { commands, start, end } = scriptedCommands();
    start("bg_1", "npm test");
    commands.takeReminder();
    const channel = new QueueChannel();
    let refused = 0;
    const flaky: TurnInputChannel = {
      pending: () => channel.pending(),
      onPending: (listener) => channel.onPending(listener),
      claimed: (delivered) => channel.claimed(delivered),
      claim: () => (refused++ === 0 ? channel.claim() : Promise.reject(new Error("unavailable"))),
    };
    const { afterModel, runtime, written } = build(commands, { input: { channel: flaky } });
    const waiting = afterModel({ messages: threadWith([{ id: "bg_1", command: "npm test" }], REPLY()) }, runtime) as Promise<Update>;
    await vi.waitFor(() => expect(written.length).toBeGreaterThan(0));
    channel.send("msg-1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(refused, "the wait asked, and the claim was refused").toBeGreaterThan(1);
    end("bg_1", exited(0));
    expect((await waiting)?.messages?.map((m) => m.id), "a refused claim never ended the wait").toEqual([noticeIdOf("bg_1")]);
  });

  it("asks for a person's message on its own clock when no hint arrives", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { commands, start } = scriptedCommands();
    start("bg_1", "npm run dev");
    commands.takeReminder();
    const channel = new QueueChannel();
    const { afterModel, runtime, written } = build(commands, { input: { channel }, claimEveryMs: 10_000 });
    const waiting = afterModel({ messages: threadWith([{ id: "bg_1", command: "npm run dev" }], REPLY()) }, runtime) as Promise<Update>;
    // Not vi.waitFor: under fake timers it advances the clock it polls on.
    while (written.length === 0) await new Promise((resolve) => setImmediate(resolve));
    channel.send("msg-1", false);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(channel.taken, "not before the claim interval").toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await waiting).toBeUndefined();
    expect(channel.taken.map((m) => m.id)).toEqual(["msg-1"]);
    await commands.stopAll();
  });

  it("hands on a person's message already waiting at the round's end, before any reminder", async () => {
    const { commands, start } = scriptedCommands();
    start("bg_1", "npm run dev");
    const channel = new QueueChannel();
    channel.send("msg-1");
    const { afterModel, runtime } = build(commands, { input: { channel } });
    expect(await afterModel({ messages: threadWith([{ id: "bg_1", command: "npm run dev" }], REPLY()) }, runtime)).toBeUndefined();
    expect(commands.takeReminder()).toBe(true);
    await commands.stopAll();
  });

  it.each([
    ["the stop ends the root's wait", "root", "stop", true],
    ["a yield ends the root's wait", "root", "yield", true],
    ["the stop ends a sub-agent's wait", "subagent", "stop", true],
    ["a yield leaves a sub-agent waiting", "subagent", "yield", false],
  ] as const)("%s", async (_label, scope, which, ends) => {
    const { commands, start } = scriptedCommands();
    start("bg_1", "npm run dev");
    commands.takeReminder();
    const stop = new AbortController();
    const yieldTurn = new AbortController();
    const { afterModel, runtime, written } = build(commands, { scope, signals: { stopSignal: stop.signal, yieldSignal: yieldTurn.signal } });
    let settled: Update | "pending" = "pending";
    const waiting = (afterModel({ messages: threadWith([{ id: "bg_1", command: "npm run dev" }], REPLY()) }, runtime) as Promise<Update>).then((u) => (settled = u));
    await vi.waitFor(() => expect(written.length).toBeGreaterThan(0));
    (which === "stop" ? stop : yieldTurn).abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (!ends) {
      expect(settled).toBe("pending");
      await commands.stopAll();
      await waiting;
      return;
    }
    await waiting;
    const update = settled as Update;
    expect(update?.jumpTo, "the model call that follows is refused by the turn boundary").toBe("model");
    expect(textOf(update?.messages?.[0])).toContain("Stopped with the turn.");
    await commands.stopAll();
  });

  it("lets a sub-agent wait only on the commands its own thread started", async () => {
    const { commands, start, end } = scriptedCommands();
    start("root_bg", "npm run dev");
    start("sub_bg", "npm test");
    commands.takeReminder();
    const { afterModel, runtime } = build(commands, { scope: "subagent" });
    let settled = false;
    const waiting = (afterModel({ messages: threadWith([{ id: "sub_bg", command: "npm test" }], REPLY()) }, runtime) as Promise<Update>).then((u) => {
      settled = true;
      return u;
    });
    end("root_bg", exited(0));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled, "the parent's command is not the sub-agent's to wait for").toBe(false);
    end("sub_bg", exited(0));
    expect((await waiting)?.messages?.map((m) => m.id)).toEqual([noticeIdOf("sub_bg")]);
  });
});
