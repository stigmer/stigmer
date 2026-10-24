/**
 * The background-command registry against real processes
 * (`shared/shell/background-commands.ts`): a start runs on and writes its
 * file, the file keeps its cap, one command stops at the agent's request
 * and every command stops with the invocation, a stop resolves only once
 * every process in the group has gone (a child that ignores SIGTERM
 * included), the running cap refuses a ninth start, and a waiter wakes on
 * an ending or its own signal.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BackgroundCommands,
  MAX_BACKGROUND_OUTPUT_BYTES,
  MAX_RUNNING_BACKGROUND_COMMANDS,
  backgroundOutputFileName,
  type BackgroundStartRequest,
} from "../background-commands.js";
import { runCommand } from "../run-command.js";

const ENV = { PATH: process.env.PATH ?? "/usr/bin:/bin" };

describe("background commands", () => {
  let dir: string;
  let commands: BackgroundCommands;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "background-commands-"));
    commands = new BackgroundCommands();
  });

  afterEach(async () => {
    await commands.stopAll();
    await rm(dir, { recursive: true, force: true });
  });

  function request(id: string, command: string, options: { readonly file?: boolean; readonly timeoutSeconds?: number } = {}): BackgroundStartRequest {
    return {
      id,
      command,
      timeoutSeconds: options.timeoutSeconds ?? 60,
      outputPath: options.file === false ? undefined : join(dir, backgroundOutputFileName(id)),
      run: (run) => runCommand({ command, cwd: dir, env: ENV, timeoutSeconds: options.timeoutSeconds ?? 60, ...run }),
    };
  }

  async function ended(id: string): Promise<void> {
    await commands.whenAnyEnds([id], new AbortController().signal);
  }

  it("runs on after the start returns, writes its output to its file, and records how it ended", async () => {
    expect(commands.start(request("call_1", "sleep 0.3; echo out; echo err >&2; exit 3"))).toEqual({ kind: "started" });
    expect(commands.running().map((c) => c.id)).toEqual(["call_1"]);
    await ended("call_1");
    const command = commands.get("call_1")!;
    expect(command.result?.exitCode).toBe(3);
    expect(command.result?.stdout).toBe("out\n");
    expect(await readFile(join(dir, backgroundOutputFileName("call_1")), "utf8")).toBe("out\nerr\n");
    expect(commands.running()).toEqual([]);
  });

  it("names a file every filesystem takes, from any tool call id", () => {
    expect(backgroundOutputFileName("toolu_01AB-c")).toBe("background-toolu_01AB-c.log");
    expect(backgroundOutputFileName("call/../x y"), "no separator or dot survives").toBe("background-call____x_y.log");
  });

  it("keeps no file when the session has none, and still records the output", async () => {
    commands.start(request("call_1", "echo kept", { file: false }));
    await ended("call_1");
    expect(commands.get("call_1")?.result?.stdout).toBe("kept\n");
  });

  it("runs on and records its ending when its file cannot be opened", async () => {
    commands.start({ ...request("call_1", "echo kept"), outputPath: join(dir, "missing", "background-call_1.log") });
    await ended("call_1");
    expect(commands.get("call_1")?.result?.stdout).toBe("kept\n");
    await expect(readFile(join(dir, "missing", "background-call_1.log"))).rejects.toThrow();
  });

  it("keeps the first bytes of a long output in its file and says how much it dropped", async () => {
    const over = 4096;
    commands.start(request("call_1", `head -c ${MAX_BACKGROUND_OUTPUT_BYTES + over} /dev/zero | tr '\\0' 'a'`));
    await ended("call_1");
    const file = await readFile(join(dir, backgroundOutputFileName("call_1")), "utf8");
    expect(file.startsWith("a".repeat(1000))).toBe(true);
    expect(file).toContain(`[${over} bytes dropped: this file keeps the first ${MAX_BACKGROUND_OUTPUT_BYTES} bytes]`);
    expect(file.length).toBe(MAX_BACKGROUND_OUTPUT_BYTES + `\n… [${over} bytes dropped: this file keeps the first ${MAX_BACKGROUND_OUTPUT_BYTES} bytes] …\n`.length);
  });

  it("stops one command at the agent's request, and says so", async () => {
    commands.start(request("call_1", "sleep 30"));
    commands.start(request("call_2", "sleep 30"));
    const stopped = await commands.stop("call_1");
    expect(stopped?.stoppedOnRequest).toBe(true);
    expect(stopped?.result?.aborted).toBe(true);
    expect(commands.running().map((c) => c.id)).toEqual(["call_2"]);
    expect(await commands.stop("call_9"), "an id this invocation never started").toBeUndefined();
  });

  it("returns an ended command as it ended when asked to stop it", async () => {
    commands.start(request("call_1", "echo done"));
    await ended("call_1");
    const command = await commands.stop("call_1");
    expect(command?.stoppedOnRequest).toBe(false);
    expect(command?.result?.exitCode).toBe(0);
  });

  it("resolves a stop only once every process of the group has gone, a child ignoring SIGTERM included", async () => {
    const marker = join(dir, "child-alive");
    // The child ignores SIGTERM and touches the marker every 50 ms: only SIGKILL ends it.
    commands.start(request("call_1", `sh -c 'trap "" TERM; while true; do touch ${marker}; sleep 0.05; done' & wait`));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await commands.stopAll();
    await rm(marker, { force: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(readFile(marker), "nothing of the group is left to touch the marker").rejects.toThrow();
  }, 15_000);

  it("stops a child an ended command left behind, at the invocation's end", async () => {
    const marker = join(dir, "orphan-alive");
    commands.start(request("call_1", `(while true; do touch ${marker}; sleep 0.05; done) & echo left`));
    await ended("call_1");
    expect(commands.get("call_1")?.result?.exitCode).toBe(0);
    await commands.stopAll();
    await rm(marker, { force: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(readFile(marker)).rejects.toThrow();
  }, 15_000);

  it(`refuses a start past ${MAX_RUNNING_BACKGROUND_COMMANDS} running, naming them, and admits one once a command ends`, async () => {
    const ids = Array.from({ length: MAX_RUNNING_BACKGROUND_COMMANDS }, (_, i) => `call_${i}`);
    for (const id of ids) expect(commands.start(request(id, "sleep 30")).kind).toBe("started");
    expect(commands.start(request("call_x", "sleep 30"))).toEqual({ kind: "full", running: ids });
    await commands.stop("call_0");
    expect(commands.start(request("call_x", "sleep 30")).kind).toBe("started");
  });

  it("refuses every start once the invocation has stopped them all", async () => {
    await commands.stopAll();
    expect(commands.start(request("call_1", "echo late"))).toEqual({ kind: "closed" });
    expect(commands.all()).toEqual([]);
  });

  it("wakes a waiter on an ending, at once when one has already ended, and on its own signal", async () => {
    commands.start(request("call_1", "sleep 30"));
    commands.start(request("call_2", "sleep 0.2"));
    await commands.whenAnyEnds(["call_1", "call_2"], new AbortController().signal);
    expect(commands.get("call_2")?.result).toBeDefined();
    await commands.whenAnyEnds(["call_2"], new AbortController().signal);

    const controller = new AbortController();
    const waiting = commands.whenAnyEnds(["call_1"], controller.signal);
    controller.abort();
    await waiting;
    expect(commands.get("call_1")?.result, "the signal woke it, not an ending").toBeUndefined();
  });

  it("gives the round-end reminder once, and remembers why an earlier invocation's commands stopped", () => {
    expect(commands.takeReminder()).toBe(true);
    expect(commands.takeReminder()).toBe(false);
    expect(commands.priorStop()).toBe("interrupted");
    commands.resumesApproval();
    expect(commands.priorStop()).toBe("approval");
  });
});
