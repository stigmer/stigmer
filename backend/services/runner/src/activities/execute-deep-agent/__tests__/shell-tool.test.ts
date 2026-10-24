/**
 * The native `execute` tool (`../shell-tool.ts`) over a scripted backend:
 * the default bound, a raised one honoured, one above the ceiling clamped and
 * said so; the call's signal handed to the command; output yielded as it
 * arrives and coalesced to the floor; and the result in deepagents' words,
 * with a timeout, a stop and a failed spawn each said plainly. In the
 * background: a start answers at once with its id, its file and the
 * artifact that records it, its bound defaults to the ceiling and is clamped
 * to it, a full or a closing registry refuses it in words, and the stop tool
 * ends a command at the agent's request, returns an ended one as it ended
 * and names an unknown id. Real processes are
 * `shared/shell/__tests__/run-command.test.ts`'s and
 * `background-commands.test.ts`'s; the tool on a real graph is
 * `shell-binding.test.ts`'s and `background-binding.test.ts`'s.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ToolMessage } from "@langchain/core/messages";

import { DEFAULT_SHELL_TIMEOUT_SECONDS, type ShellRunOptions } from "../cas-capture-backend.js";
import { backgroundArtifactOf, createShellTool, createStopBackgroundCommandTool, endingLine, shellResult, type ShellRunner } from "../shell-tool.js";
import type { CommandResult } from "../../../shared/shell/run-command.js";
import { BackgroundCommands, MAX_RUNNING_BACKGROUND_COMMANDS, type BackgroundOutputPaths } from "../../../shared/shell/background-commands.js";

function result(init: Partial<CommandResult>): CommandResult {
  return { stdout: "", stderr: "", exitCode: 0, timedOut: false, aborted: false, truncated: false, ...init };
}

/** A backend whose command prints `chunks`, `gapMs` apart, then ends with `ending`. */
function scripted(chunks: readonly string[], ending: Partial<CommandResult> = {}, gapMs = 0) {
  const runs: Array<{ readonly command: string; readonly options: ShellRunOptions }> = [];
  const backend: ShellRunner = {
    async runShell(command, options) {
      runs.push({ command, options });
      for (const chunk of chunks) {
        if (gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
        options.onOutput?.(chunk, "stdout");
      }
      return result({ stdout: chunks.join(""), ...ending });
    },
  };
  return { backend, runs };
}

/** Run the tool's generator to its end: every yielded chunk, and the result it returns. */
async function drive(tool: ReturnType<typeof createShellTool>, input: Record<string, unknown>, signal?: AbortSignal) {
  const yielded: string[] = [];
  // `func` is LangChain's (input, runManager, config) wrapper over the tool's function.
  const raw = (await (tool as unknown as { func: (input: unknown, runManager?: unknown, config?: unknown) => Promise<unknown> }).func(input, undefined, signal ? { signal } : undefined)) as AsyncGenerator<string, string>;
  for (;;) {
    const step = await raw.next();
    if (step.done) return { yielded, result: step.value };
    yielded.push(step.value);
  }
}

describe("the native execute tool", () => {
  it("runs at deepagents' default bound unless the model raises it, and passes the call's signal", async () => {
    const { backend, runs } = scripted(["ok\n"]);
    const tool = createShellTool({ backend, maxTimeoutSeconds: 600, floorMs: 1 });
    const controller = new AbortController();
    await drive(tool, { command: "make" }, controller.signal);
    await drive(tool, { command: "make test", timeout: 900 / 2 });
    expect(runs.map((r) => [r.command, r.options.timeoutSeconds])).toEqual([
      ["make", DEFAULT_SHELL_TIMEOUT_SECONDS],
      ["make test", 450],
    ]);
    expect(runs[0]!.options.signal).toBe(controller.signal);
  });

  it("clamps a timeout above the ceiling and says so in the result", async () => {
    const { backend, runs } = scripted(["built\n"]);
    const tool = createShellTool({ backend, maxTimeoutSeconds: 600, floorMs: 1 });
    const { result: text } = await drive(tool, { command: "make", timeout: 7_200 });
    expect(runs[0]!.options.timeoutSeconds).toBe(600);
    expect(text).toBe(
      "built\n\n[Command succeeded with exit code 0]\n[The timeout asked for, 7200 seconds, is above this runner's limit; the command ran with 600]",
    );
  });

  it("yields the output as it arrives, coalesced to the floor, and returns the whole result", async () => {
    const { backend } = scripted(["a\n", "b\n", "c\n"], {}, 20);
    const tool = createShellTool({ backend, maxTimeoutSeconds: 600, floorMs: 1_000 });
    const { yielded, result: text } = await drive(tool, { command: "build" });
    expect(yielded.join("")).toBe("a\nb\nc\n");
    expect(yielded.length, "lines that arrive inside one floor ride one chunk").toBeLessThan(3);
    expect(text).toBe("a\nb\nc\n\n[Command succeeded with exit code 0]");
  });

  it("yields each chunk apart when they arrive further apart than the floor", async () => {
    const { backend } = scripted(["a\n", "b\n"], {}, 60);
    const tool = createShellTool({ backend, maxTimeoutSeconds: 600, floorMs: 10 });
    const { yielded } = await drive(tool, { command: "build" });
    expect(yielded).toEqual(["a\n", "b\n"]);
  });
});

describe("shellResult", () => {
  it("is deepagents' result after a failed exit, with the truncation note", () => {
    expect(shellResult(result({ stdout: "boom\n", exitCode: 2, truncated: true }), 120, undefined)).toBe(
      "boom\n\n\n... Output truncated at 100000 bytes.\n\nExit code: 2\n[Command failed with exit code 2]\n[Output was truncated due to size limits]",
    );
  });

  it("keeps what a timed-out command printed and says it was stopped", () => {
    expect(shellResult(result({ stdout: "compiling 1\n", exitCode: null, timedOut: true }), 120, undefined)).toBe(
      "compiling 1\n\n[Command timed out after 120 seconds; its processes were stopped]",
    );
  });

  it("says a command stopped with the turn, and words a failed spawn", () => {
    expect(shellResult(result({ stdout: "half\n", exitCode: null, aborted: true }), 120, undefined)).toBe(
      "half\n\n[Command stopped with the turn; its processes were stopped]",
    );
    expect(shellResult(result({ spawnError: "spawn /bin/sh ENOENT" }), 120, undefined)).toBe(
      "Error executing command: spawn /bin/sh ENOENT\n[Command failed with exit code 1]",
    );
  });
});

/** A backend whose commands run until their signal aborts or the test ends them. */
function held() {
  const runs: Array<{ readonly command: string; readonly options: ShellRunOptions; readonly end: (r: CommandResult) => void }> = [];
  const backend: ShellRunner = {
    runShell: (command, options) =>
      new Promise<CommandResult>((resolve) => {
        runs.push({ command, options, end: resolve });
        options.signal?.addEventListener("abort", () => resolve(result({ stdout: "partial\n", exitCode: null, aborted: true })), { once: true });
      }),
  };
  return { backend, runs };
}

const OUTPUT_DIR = mkdtempSync(join(tmpdir(), "shell-tool-background-"));
afterAll(() => rmSync(OUTPUT_DIR, { recursive: true, force: true }));
const PATHS: BackgroundOutputPaths = { virtual: (id) => `/large_tool_results/background-${id}.log`, real: (id) => join(OUTPUT_DIR, `background-${id}.log`) };

/** Run the tool as a tool call `id` would: the call in its config. */
async function call(tool: unknown, input: Record<string, unknown>, id: string | undefined): Promise<unknown> {
  const config = id === undefined ? undefined : { toolCall: { id, name: "execute", args: input } };
  const raw = await (tool as { func: (input: unknown, runManager?: unknown, config?: unknown) => Promise<unknown> }).func(input, undefined, config);
  if (raw !== null && typeof raw === "object" && Symbol.asyncIterator in raw) {
    const generator = raw as AsyncGenerator<unknown, unknown>;
    for (;;) {
      const step = await generator.next();
      if (step.done) return step.value;
    }
  }
  return raw;
}

function contentOf(answer: unknown): string {
  return ToolMessage.isInstance(answer) ? String(answer.content) : String(answer);
}

describe("the native execute tool in the background", () => {
  it("answers at once with the id, the file and the artifact, and runs at the ceiling unless asked for less", async () => {
    const { backend, runs } = held();
    const commands = new BackgroundCommands();
    const tool = createShellTool({ backend, maxTimeoutSeconds: 600, floorMs: 1, background: { commands, outputPaths: PATHS } });

    const answer = await call(tool, { command: "npm run dev", background: true }, "bg_1");
    expect(ToolMessage.isInstance(answer)).toBe(true);
    expect(contentOf(answer)).toBe(
      "Started in the background (id bg_1). Output is going to /large_tool_results/background-bg_1.log; you will be told when it ends. Do not poll it.",
    );
    expect(backgroundArtifactOf((answer as ToolMessage).artifact)).toEqual({ id: "bg_1" });
    expect(commands.running().map((c) => c.id)).toEqual(["bg_1"]);

    await call(tool, { command: "npm test", background: true, timeout: 90 }, "bg_2");
    expect(contentOf(await call(tool, { command: "make", background: true, timeout: 900 }, "bg_3"))).toContain(
      "[The timeout asked for, 900 seconds, is above this runner's limit; the command ran with 600]",
    );
    expect(runs.map((r) => r.options.timeoutSeconds)).toEqual([600, 90, 600]);
    await commands.stopAll();
  });

  it("says so when the session keeps no output file", async () => {
    const commands = new BackgroundCommands();
    const tool = createShellTool({ backend: held().backend, maxTimeoutSeconds: 600, floorMs: 1, background: { commands, outputPaths: undefined } });
    expect(contentOf(await call(tool, { command: "sleep 9", background: true }, "bg_1"))).toBe(
      "Started in the background (id bg_1). This session keeps no output file; you will be told the last of its output when it ends. Do not poll it.",
    );
    await commands.stopAll();
  });

  it("refuses in words a start past the running cap, one as the turn ends, and one with no tool call", async () => {
    const commands = new BackgroundCommands();
    const tool = createShellTool({ backend: held().backend, maxTimeoutSeconds: 600, floorMs: 1, background: { commands, outputPaths: PATHS } });
    const ids = Array.from({ length: MAX_RUNNING_BACKGROUND_COMMANDS }, (_, i) => `bg_${i}`);
    for (const id of ids) await call(tool, { command: "sleep 9", background: true }, id);
    expect(await call(tool, { command: "sleep 9", background: true }, "bg_x")).toBe(
      `Not started: ${MAX_RUNNING_BACKGROUND_COMMANDS} commands already run in the background (${ids.join(", ")}). Stop one with stop_background_command, or wait for one to end.`,
    );
    expect(await call(tool, { command: "sleep 9", background: true }, undefined)).toBe("Error: a command can run in the background only as a tool call.");
    await commands.stopAll();
    expect(await call(tool, { command: "sleep 9", background: true }, "bg_y")).toBe("Not started: the turn is ending.");
  });

  it("runs the command in the foreground where no registry is given", async () => {
    const { backend, runs } = scripted(["ok\n"]);
    const tool = createShellTool({ backend, maxTimeoutSeconds: 600, floorMs: 1 });
    expect(contentOf(await call(tool, { command: "make", background: true }, "bg_1"))).toContain("[Command succeeded with exit code 0]");
    expect(runs).toHaveLength(1);
  });
});

describe("the background artifact and the ending line", () => {
  it("reads a start or an ending off a tool result's artifact, and nothing else", () => {
    expect(backgroundArtifactOf({ background: { id: "bg_1" } })).toEqual({ id: "bg_1" });
    expect(backgroundArtifactOf({ background: { ended: "bg_1" } })).toEqual({ ended: "bg_1" });
    for (const other of [undefined, null, "x", {}, { background: null }, { background: "bg_1" }, { background: { id: 7 } }]) {
      expect(backgroundArtifactOf(other), JSON.stringify(other)).toBeUndefined();
    }
  });

  it("says a command that failed to start, and who stopped one", () => {
    expect(endingLine({ kind: "spawn-failed", message: "spawn /bin/sh ENOENT" })).toBe("[Command failed to start: spawn /bin/sh ENOENT]");
    expect(endingLine({ kind: "stopped" }, { by: "agent", callId: "stop_1" })).toBe("[Stopped at your request; its processes were stopped]");
    expect(endingLine({ kind: "stopped" }, { by: "person" })).toBe("[Stopped by the person; its processes were stopped]");
    expect(endingLine({ kind: "stopped" }, { by: "approval" })).toBe("[Command stopped with the turn; its processes were stopped]");
    expect(endingLine({ kind: "stopped" })).toBe("[Command stopped with the turn; its processes were stopped]");
  });
});

describe("the stop tool", () => {
  it("stops a running command at the agent's request, and records the ending on its result", async () => {
    const { backend } = held();
    const commands = new BackgroundCommands();
    const shell = createShellTool({ backend, maxTimeoutSeconds: 600, floorMs: 1, background: { commands, outputPaths: PATHS } });
    await call(shell, { command: "npm run dev", background: true }, "bg_1");
    const answer = await call(createStopBackgroundCommandTool(commands), { id: "bg_1" }, "stop_1");
    expect(contentOf(answer)).toBe("partial\n\n[Stopped at your request; its processes were stopped]");
    expect(backgroundArtifactOf((answer as ToolMessage).artifact)).toEqual({ ended: "bg_1" });
    expect((answer as ToolMessage).tool_call_id).toBe("stop_1");
  });

  it("returns an ended command as it ended, and names an id this turn never started", async () => {
    const { backend, runs } = held();
    const commands = new BackgroundCommands();
    const shell = createShellTool({ backend, maxTimeoutSeconds: 600, floorMs: 1, background: { commands, outputPaths: PATHS } });
    await call(shell, { command: "npm test", background: true }, "bg_1");
    await call(shell, { command: "npm run dev", background: true }, "bg_2");
    runs[0]!.end(result({ stdout: "1 failed\n", exitCode: 1 }));
    await commands.whenAnyEnds(["bg_1"], new AbortController().signal);
    const stop = createStopBackgroundCommandTool(commands);
    expect(contentOf(await call(stop, { id: "bg_1" }, "stop_1"))).toBe("It had already ended.\n1 failed\n\nExit code: 1\n[Command failed with exit code 1]");
    expect(await call(stop, { id: "bg_9" }, "stop_2")).toBe("No command started in the background in this turn has id bg_9. Running: bg_2.");
    await commands.stopAll();
    expect(await call(stop, { id: "bg_9" }, "stop_3")).toBe("No command started in the background in this turn has id bg_9. None is running.");
  });
});
