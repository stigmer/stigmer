/**
 * Background commands on a real deepagents graph: the facts the design rests
 * on, each against the installed deepagents, LangChain and LangGraph, so an
 * upgrade that moves one fails here.
 *  - The model sees `background` on `execute`, and `stop_background_command`
 *    beside it (bound through the shell middleware's own `tools`).
 *  - A background call answers at once: the model reads the start before
 *    the command has ended.
 *  - At a round's end with a command running, the model is reminded once,
 *    then the turn waits; while it waits the open-operations fold holds a
 *    real stall watchdog whose window is far shorter than the wait, and the
 *    command's notice reaches the next model call. The person is told in a
 *    `system_note`.
 *  - With the turn-input middleware ahead of it, a person's message sent
 *    during the wait ends the wait and is delivered once, by that
 *    middleware: langchain runs round-end hooks newest first and a jump
 *    leaves the chain (`middleware/background-commands.ts`).
 *  - The start's artifact survives a save and a reload of the thread
 *    (sqlite, the saver the runner ships), and an invocation that resumes
 *    the person's approval tells the agent the command was stopped at that
 *    pause.
 * The profile is resolved from the model's provider, so the scripted model
 * masquerades as ChatAnthropic (`shell-execute-gate.test.ts` explains why).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HumanMessage, isHumanMessage, isToolMessage, type BaseMessage } from "@langchain/core/messages";
import { Command, MemorySaver } from "@langchain/langgraph";
import { createDeepAgent } from "deepagents";

import { createApprovalGateMiddleware } from "../../../middleware/approval-gate.js";
import { createBackgroundCommandsMiddleware, noticeIdOf } from "../../../middleware/background-commands.js";
import { createShellMiddleware } from "../../../middleware/shell.js";
import { createToolIntentMiddleware } from "../../../middleware/tool-intent.js";
import { OpenOperations } from "../../../harness/open-operations.js";
import type { TranscriptEvent } from "../../../harness/transcript/events.js";
import type { TurnInputChannel, TurnMessage } from "../../../harness/turn-input.js";
import { SqliteCheckpointSaver } from "../../../shared/checkpointer/sqlite-saver.js";
import { BackgroundCommands, backgroundOutputFileName, type BackgroundOutputPaths } from "../../../shared/shell/background-commands.js";
import { startStallWatchdog } from "../../../shared/stall-watchdog.js";
import { CasCaptureShellBackend, createCasCaptureBackend } from "../cas-capture-backend.js";
import { CasCaptureObserver } from "../cas-capture-observer.js";
import { registerStigmerDeepagentsProfiles, resetStigmerDeepagentsProfilesForTests } from "../deepagents-profiles.js";
import { backgroundArtifactOf, createShellBinding, STOP_BACKGROUND_TOOL_NAME } from "../shell-tool.js";
import { DeepAgentTranslator } from "../translator.js";
import { createTurnInputMiddleware } from "../turn-input-middleware.js";
import { ScriptedModel, readPendingInterrupts, type ScriptedTurn, type TurnPlayer } from "../__test-utils__/scripted-model.js";

class ScriptedAnthropicModel extends ScriptedModel {
  static override lc_name(): string {
    return "ChatAnthropic";
  }
}

const MAX_TIMEOUT_SECONDS = 600;

async function shellBackend(root: string): Promise<CasCaptureShellBackend> {
  const backend = await createCasCaptureBackend({
    rootDir: root,
    observer: new CasCaptureObserver({ rootDir: root, isIgnored: async () => true }),
    shellEnv: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
  });
  if (!(backend instanceof CasCaptureShellBackend)) throw new Error("expected a shell backend");
  return backend;
}

function outputPathsIn(dir: string): BackgroundOutputPaths {
  return { virtual: (id) => `/large_tool_results/${backgroundOutputFileName(id)}`, real: (id) => join(dir, backgroundOutputFileName(id)) };
}

function textOf(message: BaseMessage | undefined): string {
  if (message === undefined) return "";
  return typeof message.content === "string" ? message.content : message.text;
}

/** The model's next turn, read off the transcript: what the conversation does not yet show. */
function player(steps: (transcript: readonly BaseMessage[]) => ScriptedTurn): TurnPlayer {
  return steps;
}

/** A turn-input channel over an in-memory queue, as the session's queue answers claims. */
class QueueChannel implements TurnInputChannel {
  private readonly queue: TurnMessage[] = [];
  private readonly taken: TurnMessage[] = [];
  private readonly listeners = new Set<() => void>();

  send(id: string, text: string): void {
    this.queue.push({ id, text, message: [], visionImages: [], visionNotViewable: [] });
    for (const listener of this.listeners) listener();
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
    return this.taken.filter((message) => !delivered.has(message.id));
  }
}

describe("background commands on a real graph", () => {
  let root: string;
  let offload: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "background-binding-"));
    offload = join(root, "..", `${root.split("/").pop()}-offload`);
    await mkdir(offload, { recursive: true });
    resetStigmerDeepagentsProfilesForTests();
    registerStigmerDeepagentsProfiles();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(offload, { recursive: true, force: true });
    resetStigmerDeepagentsProfilesForTests();
  });

  async function stack(commands: BackgroundCommands, extra: { readonly before?: unknown[]; readonly after?: unknown[] } = {}): Promise<{ backend: CasCaptureShellBackend; middleware: unknown[] }> {
    const backend = await shellBackend(root);
    const binding = createShellBinding({
      backend,
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
      floorMs: 50,
      background: { commands, outputPaths: outputPathsIn(offload) },
    });
    return {
      backend,
      middleware: [
        ...(extra.before ?? []),
        createShellMiddleware(binding),
        createBackgroundCommandsMiddleware({ ...binding.background!, scope: "root", claimEveryMs: 50 }),
        createToolIntentMiddleware(),
        ...(extra.after ?? []),
      ],
    };
  }

  it("declares background on execute and binds the stop tool beside it", async () => {
    const bound: unknown[] = [];
    const commands = new BackgroundCommands();
    const { backend, middleware } = await stack(commands);
    const graph = await createDeepAgent({
      model: new ScriptedAnthropicModel(() => ({ turns: [{ text: "ok" }] }), bound),
      systemPrompt: "work",
      backend,
      middleware,
    } as Parameters<typeof createDeepAgent>[0]);
    await graph.invoke({ messages: [new HumanMessage({ content: "go" })] }, { configurable: { thread_id: "t1" }, recursionLimit: 20 });

    const named = (name: string) => bound.filter((t) => (t as { name?: unknown }).name === name) as Array<{ schema?: { properties?: Record<string, unknown> } }>;
    expect(named("execute")).toHaveLength(1);
    expect(Object.keys(named("execute")[0]!.schema?.properties ?? {})).toContain("background");
    expect(named(STOP_BACKGROUND_TOOL_NAME)).toHaveLength(1);
  });

  it("answers at once, reminds once, waits holding the watchdog, and delivers the ending to the next model call", async () => {
    const commands = new BackgroundCommands();
    const { backend, middleware } = await stack(commands);
    let endedWhenStartRead: boolean | undefined;
    const graph = await createDeepAgent({
      model: new ScriptedAnthropicModel(() =>
        player((transcript) => {
          const last = transcript.at(-1);
          if (isToolMessage(last)) {
            endedWhenStartRead = commands.get("bg_1")?.result !== undefined;
            return { text: "it runs; I am done for now" };
          }
          if (last !== undefined && isHumanMessage(last) && textOf(last).startsWith("<background-commands-running>")) return { text: "I will wait for it" };
          if (last !== undefined && isHumanMessage(last) && textOf(last).startsWith("<background-command ")) return { text: "the suite passed" };
          return { toolCalls: [{ name: "execute", args: { command: "sleep 1.5; echo suite-done", background: true }, id: "bg_1" }] };
        }),
      ),
      checkpointer: new MemorySaver() as never,
      systemPrompt: "work",
      backend,
      middleware,
    } as Parameters<typeof createDeepAgent>[0]);

    const translator = new DeepAgentTranslator(null);
    const operations = new OpenOperations({ subAgentProgress: "streamed" });
    const seen: TranscriptEvent[] = [];
    let stalled = false;
    const watchdog = startStallWatchdog(300, () => (stalled = true), { held: () => operations.held() });
    try {
      const run = (await graph.streamEvents({ messages: [new HumanMessage({ content: "run the suite" })] }, { configurable: { thread_id: "t2" }, recursionLimit: 30, version: "v3" } as never)) as unknown as AsyncIterable<Parameters<DeepAgentTranslator["translate"]>[0]>;
      for await (const event of run) {
        for (const fact of translator.translate(event)) {
          seen.push(fact);
          operations.observe(fact);
        }
        watchdog.recordActivity();
      }
    } finally {
      watchdog.stop();
    }

    expect(endedWhenStartRead, "the model read the start before the command ended").toBe(false);
    expect(stalled, "the wait held a 300 ms watchdog over a 1.5 s command").toBe(false);
    const kinds = seen.map((fact) => fact.kind);
    expect(kinds).toContain("background_wait_started");
    expect(kinds.indexOf("background_wait_finished")).toBeGreaterThan(kinds.indexOf("background_wait_started"));
    const notes = seen.filter((fact): fact is Extract<TranscriptEvent, { kind: "system_note" }> => fact.kind === "system_note");
    expect(notes.map((note) => note.text)).toEqual(["Background command `sleep 1.5; echo suite-done` exited with code 0."]);

    const state = (await graph.getState({ configurable: { thread_id: "t2" } })) as { readonly values: { readonly messages: BaseMessage[] } };
    const messages = state.values.messages;
    const reminders = messages.filter((m) => isHumanMessage(m) && textOf(m).startsWith("<background-commands-running>"));
    expect(reminders, "reminded once").toHaveLength(1);
    const notice = messages.find((m) => m.id === noticeIdOf("bg_1"));
    expect(textOf(notice)).toContain('ended="exit 0"');
    expect(textOf(notice)).toContain("suite-done");
    expect(textOf(notice)).toContain(`/large_tool_results/${backgroundOutputFileName("bg_1")}`);
    expect(textOf(messages.at(-1))).toBe("the suite passed");
  });

  it("hands a person's message during the wait to the turn-input middleware, which delivers it once", async () => {
    const commands = new BackgroundCommands();
    const channel = new QueueChannel();
    const turnInput = createTurnInputMiddleware({ input: channel, stopped: () => false });
    const backend = await shellBackend(root);
    const binding = createShellBinding({ backend, maxTimeoutSeconds: MAX_TIMEOUT_SECONDS, floorMs: 50, background: { commands, outputPaths: outputPathsIn(offload) } });
    const middleware = [
      turnInput,
      createShellMiddleware(binding),
      createBackgroundCommandsMiddleware({ ...binding.background!, scope: "root", input: { channel }, claimEveryMs: 50 }),
      createToolIntentMiddleware(),
    ];
    const graph = await createDeepAgent({
      model: new ScriptedAnthropicModel(() =>
        player((transcript) => {
          const last = transcript.at(-1);
          if (isToolMessage(last) && last.name === STOP_BACKGROUND_TOOL_NAME) return { text: "stopped it as you asked" };
          if (isToolMessage(last)) return { text: "it runs" };
          if (last !== undefined && isHumanMessage(last) && last.id === "msg-1") return { toolCalls: [{ name: STOP_BACKGROUND_TOOL_NAME, args: { id: "bg_1" }, id: "stop_1" }] };
          if (last !== undefined && isHumanMessage(last) && textOf(last).startsWith("<background-commands-running>")) {
            setTimeout(() => channel.send("msg-1", "stop the server"), 200);
            return { text: "waiting for the server" };
          }
          return { toolCalls: [{ name: "execute", args: { command: "sleep 30", background: true }, id: "bg_1" }] };
        }),
      ),
      systemPrompt: "work",
      backend,
      middleware,
    } as Parameters<typeof createDeepAgent>[0]);

    const started = Date.now();
    const state = await graph.invoke({ messages: [new HumanMessage({ content: "start the server" })] }, { configurable: { thread_id: "t3" }, recursionLimit: 30 });
    expect(Date.now() - started, "the message ended the wait, not the command").toBeLessThan(15_000);

    const messages = state.messages as BaseMessage[];
    expect(messages.filter((m) => m.id === "msg-1"), "delivered once").toHaveLength(1);
    const stop = messages.find((m) => isToolMessage(m) && m.name === STOP_BACKGROUND_TOOL_NAME);
    expect(textOf(stop)).toContain("[Stopped at your request; its processes were stopped]");
    expect(backgroundArtifactOf((stop as { artifact?: unknown }).artifact)).toEqual({ ended: "bg_1" });
    expect(messages.find((m) => m.id === noticeIdOf("bg_1")), "a stop the agent asked for is not told again").toBeUndefined();
    expect(textOf(messages.at(-1))).toBe("stopped it as you asked");
    await commands.stopAll();
  });

  it("keeps the start's artifact across a save and a reload, and tells the resumed invocation the command was stopped at the approval pause", async () => {
    const dbPath = join(offload, "checkpoints.sqlite");
    await writeFile(join(root, "keep.txt"), "x");
    const gate = () => createApprovalGateMiddleware({ mcpDefault: { destructive: new Set(), unlisted: new Set<string>(), leasedServers: new Set() }, toolServerMap: new Map() });
    const script = player((transcript) => {
      const last = transcript.at(-1);
      if (last !== undefined && isHumanMessage(last) && textOf(last).startsWith("<background-command ")) return { text: "noted; it was stopped" };
      const toolResults = transcript.filter((m) => isToolMessage(m)).length;
      if (toolResults === 0) return { toolCalls: [{ name: "execute", args: { command: "sleep 30", background: true }, id: "bg_1" }] };
      if (toolResults === 1) return { toolCalls: [{ name: "execute", args: { command: "echo gated" }, id: "fg_1" }] };
      return { text: "done" };
    });
    const config = { configurable: { thread_id: "t4" }, recursionLimit: 30 };
    const approveAll = async (graph: { getState(c: unknown): Promise<unknown> }): Promise<Command> => {
      const resume: Record<string, { action: string }> = {};
      for (const pending of readPendingInterrupts((await graph.getState(config)) as never)) resume[pending.interruptId] = { action: "approve" };
      return new Command({ resume });
    };

    // Invocation 1: the background start asks, and is approved.
    const first = new BackgroundCommands();
    const one = await stack(first, { after: [gate()] });
    let saver = new SqliteCheckpointSaver(dbPath);
    const graphOne = await createDeepAgent({ model: new ScriptedAnthropicModel(() => script), checkpointer: saver as never, systemPrompt: "work", backend: one.backend, middleware: one.middleware } as Parameters<typeof createDeepAgent>[0]);
    await graphOne.invoke({ messages: [new HumanMessage({ content: "go" })] }, config);
    await first.stopAll();

    // Invocation 2 resumes that approval: the command starts, and the next call asks; the invocation ends and stops it.
    const second = new BackgroundCommands();
    second.resumesApproval();
    const two = await stack(second, { after: [gate()] });
    saver = new SqliteCheckpointSaver(dbPath);
    const graphTwo = await createDeepAgent({ model: new ScriptedAnthropicModel(() => script), checkpointer: saver as never, systemPrompt: "work", backend: two.backend, middleware: two.middleware } as Parameters<typeof createDeepAgent>[0]);
    await graphTwo.invoke(await approveAll(graphTwo), config);
    expect(second.running().map((c) => c.id), "the background command runs while the next call waits for approval").toEqual(["bg_1"]);
    await second.stopAll();
    expect(second.get("bg_1")?.result?.aborted, "stopped with its invocation").toBe(true);

    // Invocation 3, on a reopened saver: the thread still records the start, and the agent is told why it stopped.
    const third = new BackgroundCommands();
    third.resumesApproval();
    const three = await stack(third, { after: [gate()] });
    saver = new SqliteCheckpointSaver(dbPath);
    const graphThree = await createDeepAgent({ model: new ScriptedAnthropicModel(() => script), checkpointer: saver as never, systemPrompt: "work", backend: three.backend, middleware: three.middleware } as Parameters<typeof createDeepAgent>[0]);
    const state = await graphThree.invoke(await approveAll(graphThree), config);
    const messages = state.messages as BaseMessage[];
    const start = messages.find((m) => isToolMessage(m) && m.tool_call_id === "bg_1");
    expect(backgroundArtifactOf((start as { artifact?: unknown }).artifact), "the artifact survived the reload").toEqual({ id: "bg_1" });
    const notice = messages.find((m) => m.id === noticeIdOf("bg_1"));
    expect(textOf(notice)).toContain('ended="stopped"');
    expect(textOf(notice)).toContain("Stopped when the turn paused for your approval.");
    expect(messages.filter((m) => m.id === noticeIdOf("bg_1"))).toHaveLength(1);
    expect(third.all(), "nothing was started again").toHaveLength(0);
    expect(textOf(messages.at(-1))).toBe("noted; it was stopped");
  });
});
