/**
 * The command runner (`../run-command.ts`) against real shells: output
 * streams as it is printed; a timeout keeps what was printed and stops the
 * whole process group; an abort does the same at once; a background child
 * that keeps the pipes open no longer holds the call open (stigmer#2432);
 * stdin is closed; the output is capped; and the formatted output keeps
 * deepagents' words.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_MAX_OUTPUT_BYTES, endingOf, formatCommandOutput, runCommand, type CommandResult } from "../run-command.js";

const ENV = { PATH: process.env.PATH ?? "/usr/bin:/bin" };

/** Whether a process with this pid is alive. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function eventually(check: () => boolean, ms = 5_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

function result(init: Partial<CommandResult>): CommandResult {
  return { stdout: "", stderr: "", exitCode: 0, timedOut: false, aborted: false, truncated: false, ...init };
}

describe("runCommand", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "run-command-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("runs in the workspace with only the given environment, and streams each chunk as it arrives", async () => {
    const chunks: string[] = [];
    let firstAt = 0;
    const started = Date.now();
    const done = await runCommand({
      command: "pwd; echo \"[$MARK]\"; echo \"[${HOME:-unset}]\"; sleep 0.5; echo late >&2",
      cwd,
      env: { ...ENV, MARK: "given" },
      timeoutSeconds: 10,
      onOutput: (chunk) => {
        if (chunks.length === 0) firstAt = Date.now() - started;
        chunks.push(chunk);
      },
    });
    expect(done.exitCode).toBe(0);
    expect(done.stdout).toContain(cwd.split("/").at(-1));
    expect(done.stdout).toContain("[given]");
    expect(done.stdout, "nothing is inherited from the runner").toContain("[unset]");
    expect(done.stderr).toBe("late\n");
    expect(firstAt, "the first line arrived before the command ended").toBeLessThan(450);
    expect(chunks.join("")).toContain("late");
  });

  it("keeps what was printed at a timeout and stops the whole process group", async () => {
    const pidFile = join(cwd, "child.pid");
    const done = await runCommand({
      command: `echo before; sleep 30 & echo $! > ${pidFile}; wait`,
      cwd,
      env: ENV,
      timeoutSeconds: 1,
    });
    expect(done.timedOut).toBe(true);
    expect(done.stdout).toBe("before\n");
    const { readFile } = await import("node:fs/promises");
    const child = Number((await readFile(pidFile, "utf8")).trim());
    expect(await eventually(() => !alive(child)), "the grandchild went with its group").toBe(true);
    expect(endingOf(done, 1)).toEqual({ kind: "timed-out", timeoutSeconds: 1 });
  });

  it("returns when the shell exits although a background child still holds the pipes (#2432)", async () => {
    const pidFile = join(cwd, "orphan.pid");
    const started = Date.now();
    const done = await runCommand({ command: `sleep 30 & echo $! > ${pidFile}; echo started`, cwd, env: ENV, timeoutSeconds: 20 });
    expect(Date.now() - started, "the call did not wait for the orphan").toBeLessThan(5_000);
    expect(done.exitCode).toBe(0);
    expect(done.stdout).toBe("started\n");
    expect(done.timedOut).toBe(false);
    const { readFile } = await import("node:fs/promises");
    const orphan = Number((await readFile(pidFile, "utf8")).trim());
    expect(alive(orphan), "a background child is not killed when its shell exits normally").toBe(true);
    process.kill(orphan, "SIGKILL");
  });

  it("stops the group at once when the caller aborts", async () => {
    const controller = new AbortController();
    const running = runCommand({ command: "echo working; sleep 30", cwd, env: ENV, timeoutSeconds: 60, signal: controller.signal, onOutput: () => controller.abort() });
    const done = await running;
    expect(done.aborted).toBe(true);
    expect(done.stdout).toBe("working\n");
    expect(endingOf(done, 60)).toEqual({ kind: "stopped" });
  });

  it("runs nothing when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const done = await runCommand({ command: "touch ran", cwd, env: ENV, timeoutSeconds: 5, signal: controller.signal });
    expect(done.aborted).toBe(true);
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(cwd, "ran"))).toBe(false);
  });

  it("closes stdin, so a command that reads input sees end of file", async () => {
    const done = await runCommand({ command: "cat; echo read-done", cwd, env: ENV, timeoutSeconds: 5 });
    expect(done.stdout).toBe("read-done\n");
  });

  it("caps each stream and says it truncated", async () => {
    const done = await runCommand({ command: "head -c 5000 /dev/zero | tr '\\0' a", cwd, env: ENV, timeoutSeconds: 5, maxOutputBytes: 1000 });
    expect(done.stdout).toHaveLength(1000);
    expect(done.truncated).toBe(true);
    expect(formatCommandOutput(done, 1000)).toContain("... Output truncated at 1000 bytes.");
  });

  it("reports a spawn that fails", async () => {
    const done = await runCommand({ command: "echo hi", cwd: join(cwd, "missing"), env: ENV, timeoutSeconds: 5 });
    expect(done.spawnError).toBeDefined();
    expect(endingOf(done, 5).kind).toBe("spawn-failed");
  });
});

describe("formatCommandOutput", () => {
  it("writes deepagents' words: stdout, prefixed stderr lines, no output, and the exit code after a failure", () => {
    expect(formatCommandOutput(result({ stdout: "out\n", stderr: "e1\ne2\n" }))).toBe("out\n\n[stderr] e1\n[stderr] e2");
    expect(formatCommandOutput(result({}))).toBe("<no output>");
    expect(formatCommandOutput(result({ stdout: "boom\n", exitCode: 2 }))).toBe("boom\n\nExit code: 2");
    expect(formatCommandOutput(result({ stdout: "x".repeat(3), truncated: true }))).toBe(`xxx\n\n... Output truncated at ${DEFAULT_MAX_OUTPUT_BYTES} bytes.`);
  });

  it("leaves the exit code to each door when the command was stopped", () => {
    expect(formatCommandOutput(result({ stdout: "partial\n", exitCode: null, timedOut: true }))).toBe("partial\n");
    expect(formatCommandOutput(result({ stdout: "partial\n", exitCode: null, aborted: true }))).toBe("partial\n");
  });

  it("names how it ended: an exit, a timeout, a stop or a failed spawn", () => {
    expect(endingOf(result({ exitCode: 3 }), 9)).toEqual({ kind: "exited", exitCode: 3 });
    expect(endingOf(result({ exitCode: null }), 9)).toEqual({ kind: "exited", exitCode: 1 });
    expect(endingOf(result({ spawnError: "ENOENT" }), 9)).toEqual({ kind: "spawn-failed", message: "ENOENT" });
  });
});
