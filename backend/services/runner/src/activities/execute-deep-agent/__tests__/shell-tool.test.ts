/**
 * The native `execute` tool (`../shell-tool.ts`) over a scripted backend:
 * the default bound, a raised one honoured, one above the ceiling clamped and
 * said so; the call's signal handed to the command; output yielded as it
 * arrives and coalesced to the floor; and the result in deepagents' words,
 * with a timeout, a stop and a failed spawn each said plainly. Real
 * processes are `shared/shell/__tests__/run-command.test.ts`'s; the tool on
 * a real graph is `shell-binding.test.ts`'s.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_SHELL_TIMEOUT_SECONDS, type ShellRunOptions } from "../cas-capture-backend.js";
import { createShellTool, shellResult, type ShellRunner } from "../shell-tool.js";
import type { CommandResult } from "../../../shared/shell/run-command.js";

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
