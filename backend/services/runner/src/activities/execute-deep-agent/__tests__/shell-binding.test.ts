/**
 * The runner's shell on a real deepagents graph (`middleware/shell.ts`): the
 * facts the binding rests on, each against the installed deepagents and
 * LangChain, so an upgrade that moves either hook fails here instead of
 * silently running deepagents' own shell again.
 *  - The model sees ONE `execute`, with `command`, `timeout` and the
 *    intent `description`, on the parent and on a sub-agent's stack (built
 *    through `compileSubagents`, so the wiring is the one a turn uses).
 *  - An `execute` call runs the runner's tool (its clamp note is in the
 *    result, which deepagents' tool never writes), and the approval gate
 *    still holds it before it runs.
 *  - What the command prints while it runs reaches the graph's stream, and
 *    the native translator, as `tool_output_delta` under the call's own id,
 *    before the call finishes.
 *  - A graph whose backend cannot run a shell (plan mode) binds no
 *    `execute`, gets no shell middleware, and so no stop tool either.
 * The profile is resolved from the model's provider, so the scripted model
 * masquerades as ChatAnthropic (`shell-execute-gate.test.ts` explains why).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HumanMessage, isToolMessage, type BaseMessage } from "@langchain/core/messages";
import { Command, MemorySaver } from "@langchain/langgraph";
import { createDeepAgent } from "deepagents";

import { createApprovalGateMiddleware } from "../../../middleware/approval-gate.js";
import { createShellMiddleware } from "../../../middleware/shell.js";
import { createToolIntentMiddleware } from "../../../middleware/tool-intent.js";
import { CasCaptureShellBackend, createCasCaptureBackend } from "../cas-capture-backend.js";
import { CasCaptureObserver } from "../../../shared/filereview/cas-capture-observer.js";
import { registerStigmerDeepagentsProfiles, resetStigmerDeepagentsProfilesForTests } from "../deepagents-profiles.js";
import { createShellTool } from "../shell-tool.js";
import { compileSubagents } from "../subagent-transformer.js";
import { ToolScope } from "../../../shared/tool-lists.js";
import { DeepAgentTranslator } from "../translator.js";
import { ScriptedModel, readPendingInterrupts, type ScriptSelector } from "../__test-utils__/scripted-model.js";
import type { TranscriptEvent } from "../../../harness/transcript/events.js";

class ScriptedAnthropicModel extends ScriptedModel {
  static override lc_name(): string {
    return "ChatAnthropic";
  }
}

const MAX_TIMEOUT_SECONDS = 600;

/** One `execute` call, then a closing answer once its result is in. */
function callsExecute(command: string, timeout: number): ScriptSelector {
  return () => ({ toolCalls: [{ name: "execute", args: { command, timeout }, id: "exec_1" }], done: "ran" });
}

async function shellBackend(root: string): Promise<CasCaptureShellBackend> {
  const backend = await createCasCaptureBackend({
    rootDir: root,
    observer: new CasCaptureObserver({ rootDir: root, isIgnored: async () => true }),
    shellEnv: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
  });
  if (!(backend instanceof CasCaptureShellBackend)) throw new Error("expected a shell backend");
  return backend;
}

function shellStack(backend: CasCaptureShellBackend, extra: unknown[] = []): unknown[] {
  const tool = createShellTool({ backend, maxTimeoutSeconds: MAX_TIMEOUT_SECONDS, floorMs: 50 });
  return [createShellMiddleware({ tool }), createToolIntentMiddleware(), ...extra];
}

/** The tools the model was bound with, by name. */
function boundByName(bound: unknown[], name: string): Array<{ readonly schema?: { readonly properties?: Record<string, unknown> } }> {
  return bound.filter((t) => (t as { name?: unknown }).name === name) as Array<{ readonly schema?: { readonly properties?: Record<string, unknown> } }>;
}

function toolResults(messages: readonly BaseMessage[]): string[] {
  return messages.filter((m) => isToolMessage(m)).map((m) => String(m.content));
}

describe("the runner's shell on a real graph", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "shell-binding-"));
    resetStigmerDeepagentsProfilesForTests();
    registerStigmerDeepagentsProfiles();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    resetStigmerDeepagentsProfilesForTests();
  });

  it("shows the model one execute with command, timeout and description, and the call runs the runner's tool", async () => {
    const bound: unknown[] = [];
    const backend = await shellBackend(root);
    const graph = await createDeepAgent({
      model: new ScriptedAnthropicModel(callsExecute("echo hello", MAX_TIMEOUT_SECONDS + 1), bound),
      systemPrompt: "work",
      backend,
      middleware: shellStack(backend),
    } as Parameters<typeof createDeepAgent>[0]);

    const state = await graph.invoke({ messages: [new HumanMessage({ content: "go" })] }, { configurable: { thread_id: "t1" }, recursionLimit: 20 });

    const shells = boundByName(bound, "execute");
    expect(shells, "exactly one execute is bound").toHaveLength(1);
    expect(Object.keys(shells[0]!.schema?.properties ?? {}).sort()).toEqual(["command", "description", "timeout"]);
    const [result] = toolResults(state.messages as BaseMessage[]);
    expect(result).toContain("hello");
    expect(result).toContain("[Command succeeded with exit code 0]");
    expect(result, "only the runner's tool writes the clamp note").toContain(`the command ran with ${MAX_TIMEOUT_SECONDS}`);
  });

  it("is still held by the approval gate, and runs the runner's tool once approved", async () => {
    const marker = join(root, "gated.txt");
    const backend = await shellBackend(root);
    const checkpointer = new MemorySaver();
    const gate = createApprovalGateMiddleware({ mcpDefault: { destructive: new Set(), unlisted: new Set<string>(), leasedServers: new Set() }, toolServerMap: new Map() });
    const graph = await createDeepAgent({
      model: new ScriptedAnthropicModel(callsExecute("echo ran > gated.txt && echo done", MAX_TIMEOUT_SECONDS + 1)),
      checkpointer: checkpointer as never,
      systemPrompt: "work",
      backend,
      middleware: shellStack(backend, [gate]),
    } as Parameters<typeof createDeepAgent>[0]);
    const config = { configurable: { thread_id: "t2" }, recursionLimit: 20 };

    await graph.invoke({ messages: [new HumanMessage({ content: "go" })] }, config);
    const pending = readPendingInterrupts((await graph.getState(config)) as never);
    expect(pending.map((p) => p.toolName)).toEqual(["execute"]);
    await expect(readFile(marker, "utf8"), "a held call never ran").rejects.toThrow();

    const resume: Record<string, { action: string }> = {};
    for (const p of pending) resume[p.interruptId] = { action: "approve" };
    const state = await graph.invoke(new Command({ resume }), config);
    expect(await readFile(marker, "utf8")).toBe("ran\n");
    expect(toolResults(state.messages as BaseMessage[]).at(-1)).toContain(`the command ran with ${MAX_TIMEOUT_SECONDS}`);
  });

  it("streams what the command prints to the translator under the call's id, before the call finishes", async () => {
    const backend = await shellBackend(root);
    const graph = await createDeepAgent({
      model: new ScriptedAnthropicModel(callsExecute("echo first; sleep 1; echo second", 30)),
      systemPrompt: "work",
      backend,
      middleware: shellStack(backend),
    } as Parameters<typeof createDeepAgent>[0]);
    const translator = new DeepAgentTranslator(null);
    const seen: TranscriptEvent[] = [];

    const run = (await graph.streamEvents({ messages: [new HumanMessage({ content: "go" })] }, { configurable: { thread_id: "t3" }, recursionLimit: 20, version: "v3" } as never)) as unknown as AsyncIterable<Parameters<DeepAgentTranslator["translate"]>[0]>;
    for await (const event of run) seen.push(...translator.translate(event));

    const deltas = seen.filter((e): e is Extract<TranscriptEvent, { kind: "tool_output_delta" }> => e.kind === "tool_output_delta");
    expect(deltas.map((d) => d.callId)).toContain("exec_1");
    expect(deltas.map((d) => d.delta).join("")).toBe("first\nsecond\n");
    const firstDelta = seen.findIndex((e) => e.kind === "tool_output_delta");
    const finished = seen.findIndex((e) => e.kind === "tool_finished" && e.callId === "exec_1");
    expect(firstDelta, "the first line streamed").toBeGreaterThanOrEqual(0);
    expect(firstDelta < finished, "and before the call finished").toBe(true);
  });

  it("gives a sub-agent the same execute over its own shell, through compileSubagents", async () => {
    const bound: unknown[] = [];
    const [compiled] = await compileSubagents(
      [{ name: "helper", description: "Helps.", systemPrompt: "help", tools: [], scope: ToolScope.unrestricted() }],
      {
        parentModelName: "claude-sonnet-4-6",
        workspaceRootDir: root,
        casObserver: new CasCaptureObserver({ rootDir: root, isIgnored: async () => true }),
        shellEnv: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
        shellStreaming: { maxTimeoutSeconds: MAX_TIMEOUT_SECONDS, floorMs: 50 },
        modelFactory: async () => new ScriptedAnthropicModel(callsExecute("echo from-helper", MAX_TIMEOUT_SECONDS + 1), bound),
      },
    );
    const runnable = compiled!.runnable as { invoke(input: unknown, config: unknown): Promise<{ messages: BaseMessage[] }> };
    const state = await runnable.invoke({ messages: [new HumanMessage({ content: "go" })] }, { configurable: { thread_id: "t5" }, recursionLimit: 20 });

    const shells = boundByName(bound, "execute");
    expect(shells.length, "the sub-agent's model sees execute").toBeGreaterThan(0);
    for (const shell of shells) expect(Object.keys(shell.schema?.properties ?? {}).sort()).toEqual(["command", "description", "timeout"]);
    const [result] = toolResults(state.messages);
    expect(result).toContain("from-helper");
    expect(result).toContain(`the command ran with ${MAX_TIMEOUT_SECONDS}`);
  });

  it("is never installed on a graph that cannot run a shell: no execute is bound", async () => {
    const bound: unknown[] = [];
    const backend = await createCasCaptureBackend({
      rootDir: root,
      observer: new CasCaptureObserver({ rootDir: root, isIgnored: async () => true }),
    });
    expect(backend).not.toBeInstanceOf(CasCaptureShellBackend);
    const graph = await createDeepAgent({
      model: new ScriptedAnthropicModel(() => ({ toolCalls: [], done: "ok" }), bound),
      systemPrompt: "work",
      backend,
      middleware: [createToolIntentMiddleware()],
    } as Parameters<typeof createDeepAgent>[0]);
    await graph.invoke({ messages: [new HumanMessage({ content: "go" })] }, { configurable: { thread_id: "t4" }, recursionLimit: 20 });
    expect(boundByName(bound, "execute")).toHaveLength(0);
    expect(boundByName(bound, "stop_background_command"), "nor the stop tool, which only the shell middleware binds").toHaveLength(0);
  });
});
