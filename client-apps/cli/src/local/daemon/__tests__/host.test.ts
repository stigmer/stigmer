// Pins the real process host's view of a child's end (stigmer#1845): a child
// counts as exited only once its output is in, so its last stderr lines are in
// the handle's tail and the log file, with its real exit code, and no chunk is
// written after the log stream ends. A grandchild that keeps the pipe open
// cannot hold the exit back past the grace. Real `node` children throughout;
// the supervisor's policy over the handle is tested with fakes elsewhere.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isProcessAlive, killProcess } from "../../state/proc.js";
import { EXIT_OUTPUT_GRACE_MS, NodeProcessHost, STDERR_TAIL_LINE_MAX, STDERR_TAIL_LINES } from "../host.js";
import type { ChildHandle, ExitInfo } from "../types.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "stigmer-host-"));
}

function spawnScript(source: string): { handle: ChildHandle; logFile: string; exited: Promise<ExitInfo> } {
  const dir = tempDir();
  const script = join(dir, "child.cjs");
  writeFileSync(script, source);
  const logFile = join(dir, "child.log");
  const handle = new NodeProcessHost().spawn({
    name: "stigmer-server",
    command: process.execPath,
    args: [script],
    env: process.env,
    logFile,
  });
  const exited = new Promise<ExitInfo>((resolve) => handle.onExit(resolve));
  return { handle, logFile, exited };
}

describe("NodeProcessHost — a child's end", () => {
  it("holds the last stderr lines and the real exit code once the child is observed exited", async () => {
    // Many lines then an immediate exit: the last ones are the likeliest to
    // arrive after Node's `exit` event.
    const { handle, logFile, exited } = spawnScript(
      `for (let i = 0; i < 2000; i += 1) process.stderr.write("noise " + i + "\\n");\n` +
        `process.stderr.write("boot failed: schema version 14 is newer than this server supports\\n");\n` +
        `process.exit(1);\n`,
    );
    expect(handle.exitInfo()).toBeNull();

    const info = await exited;

    expect(info).toEqual({ code: 1, signal: null });
    expect(handle.hasExited()).toBe(true);
    expect(handle.exitInfo()).toEqual({ code: 1, signal: null });
    const tail = handle.stderrTail();
    expect(tail).toHaveLength(STDERR_TAIL_LINES);
    expect(tail[tail.length - 1]).toBe("boot failed: schema version 14 is newer than this server supports");
    expect(tail[0]).toBe("noise 1991");
    // The log stream ended after the last chunk, so the file holds it too.
    await expect.poll(() => readFileSync(logFile, "utf8")).toContain("boot failed: schema version 14");
  });

  it("keeps a final line with no newline, and caps a long line", async () => {
    const long = "x".repeat(STDERR_TAIL_LINE_MAX + 50);
    const { handle, exited } = spawnScript(
      `process.stderr.write(${JSON.stringify(`${long}\n`)});\n` +
        `process.stderr.write("last words");\n` +
        `process.exitCode = 3;\n`,
    );

    await exited;

    expect(handle.exitInfo()).toEqual({ code: 3, signal: null });
    expect(handle.stderrTail()).toEqual([`${"x".repeat(STDERR_TAIL_LINE_MAX)}…`, "last words"]);
  });

  it("observes the exit within the grace when a grandchild keeps the pipe open", async () => {
    // The grandchild inherits both pipes and outlives its parent, writing to
    // each after the grace; it prints its pid so the test can stop it.
    const late = `setTimeout(() => { process.stdout.write("late out\\n"); process.stderr.write("late err\\n"); }, ${EXIT_OUTPUT_GRACE_MS + 400}); setInterval(() => {}, 1000)`;
    const { handle, logFile, exited } = spawnScript(
      `const { spawn } = require("node:child_process");\n` +
        `const g = spawn(process.execPath, ["-e", ${JSON.stringify(late)}], { stdio: ["ignore", "inherit", "inherit"] });\n` +
        `process.stderr.write("grandchild " + g.pid + "\\n");\n` +
        `setTimeout(() => process.exit(2), 100);\n`,
    );
    const started = Date.now();

    const info = await exited;

    expect(info).toEqual({ code: 2, signal: null });
    expect(Date.now() - started).toBeLessThan(100 + EXIT_OUTPUT_GRACE_MS + 2_000);
    const line = handle.stderrTail().find((l) => l.startsWith("grandchild "));
    const grandchild = Number.parseInt(line?.split(" ")[1] ?? "", 10);
    expect(isProcessAlive(grandchild)).toBe(true);
    // What arrives after the observed exit is dropped, never written to the
    // ended log stream.
    await new Promise((resolve) => setTimeout(resolve, 800));
    killProcess(grandchild, "SIGKILL");
    expect(handle.stderrTail()).not.toContain("late err");
    expect(readFileSync(logFile, "utf8")).not.toContain("late");
  });

  it("reports a command that cannot be spawned as exited, with the reason in the tail", async () => {
    const dir = tempDir();
    const handle = new NodeProcessHost().spawn({
      name: "stigmer-server",
      command: join(dir, "no-such-binary"),
      args: [],
      env: process.env,
      logFile: join(dir, "child.log"),
    });
    let calls = 0;
    const exited = new Promise<void>((resolve) =>
      handle.onExit(() => {
        calls += 1;
        resolve();
      }),
    );

    await exited;
    // Let any later `close` arrive: the callback still fires once.
    await new Promise((resolve) => setTimeout(resolve, EXIT_OUTPUT_GRACE_MS + 100));

    expect(calls).toBe(1);
    expect(handle.exitInfo()).toEqual({ code: null, signal: null });
    expect(handle.stderrTail()[0]).toMatch(/^failed to spawn .*no-such-binary: Error: spawn .* ENOENT/);
  });
});
