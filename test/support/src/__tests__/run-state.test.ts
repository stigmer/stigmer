// Unit arms for a run's state file: a worker reads what setup wrote, without
// the stamp; a teardown takes only the file its own process wrote, removes
// one whose writer has exited (or that has no stamp, or does not parse), and
// leaves one a running process wrote, so a killed earlier run's file is never
// read as this run's (stigmer#1594).
// Real temp files; a real child process for a writer that is alive and one
// that has exited. No target.
// Domain: test support (stack spawns).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRunState, takeRunState, writeRunState } from "../run-state.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "run-state-"));
  file = join(dir, "state.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A file as another process would have written it. */
function writeAs(writerPid: number | undefined, state: object): void {
  writeFileSync(file, JSON.stringify(writerPid === undefined ? state : { ...state, writerPid }));
}

/** A child that is running until `stop` is called. */
function liveChild(): { pid: number; stop: () => Promise<void> } {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  if (child.pid === undefined) throw new Error("the child did not start");
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return {
    pid: child.pid,
    stop: async () => {
      child.kill("SIGKILL");
      await exited;
    },
  };
}

describe("readRunState", () => {
  it("gives a worker the state setup wrote, without the stamp", () => {
    writeRunState(file, { reused: false, mockLlmControlUrl: "http://127.0.0.1:1" });
    expect(readRunState(file)).toEqual({ reused: false, mockLlmControlUrl: "http://127.0.0.1:1" });
  });

  it("is undefined with no file, or one that does not parse", () => {
    expect(readRunState(file)).toBeUndefined();
    writeFileSync(file, "{ not json");
    expect(readRunState(file)).toBeUndefined();
  });
});

describe("takeRunState", () => {
  it("finds nothing when this run wrote nothing", () => {
    expect(takeRunState(file)).toEqual({ kind: "none" });
  });

  it("takes and removes this process's own file", () => {
    writeRunState(file, { reused: false });
    expect(takeRunState(file)).toEqual({ kind: "own", state: { reused: false } });
    expect(existsSync(file)).toBe(false);
  });

  it("removes a file whose writer has exited, as stale", async () => {
    const writer = liveChild();
    await writer.stop();
    writeAs(writer.pid, { reused: false });
    expect(takeRunState(file)).toEqual({ kind: "stale", writerPid: writer.pid });
    expect(existsSync(file)).toBe(false);
  });

  it("removes a file with no stamp, or one that does not parse, as stale", () => {
    writeAs(undefined, { reused: false });
    expect(takeRunState(file)).toEqual({ kind: "stale", writerPid: undefined });
    expect(existsSync(file)).toBe(false);
    writeFileSync(file, "{ not json");
    expect(takeRunState(file)).toEqual({ kind: "stale", writerPid: undefined });
    expect(existsSync(file)).toBe(false);
  });

  it("leaves a file a running process wrote in place", async () => {
    const writer = liveChild();
    try {
      writeAs(writer.pid, { reused: false });
      expect(takeRunState(file)).toEqual({ kind: "live-elsewhere", writerPid: writer.pid });
      expect(existsSync(file)).toBe(true);
    } finally {
      await writer.stop();
    }
  });
});
