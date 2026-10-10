// Pins the real effects behind `plugin eval`: the process's own streams; a
// `--json <path>` write that lands on disk; a sleep that waits its time,
// ends early on Ctrl+C's abort and returns at once when already aborted;
// `now` as the epoch clock; a SIGINT listener added and removed again, so a
// finished eval leaves Ctrl+C to the process; and `exit` as process.exit.
// No real signal is raised: the listener is called through the process's
// own listener list.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nodePluginEvalIo } from "../node-io.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("nodePluginEvalIo", () => {
  it("writes to the process's streams and the clock is the epoch's", () => {
    vi.useFakeTimers({ now: 1_074_000 });
    const io = nodePluginEvalIo();
    expect(io.stdout).toBe(process.stdout);
    expect(io.stderr).toBe(process.stderr);
    expect(io.now()).toBe(1_074_000);
  });

  it("writes the result document to its path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stigmer-plugin-eval-io-"));
    try {
      const path = join(dir, "results.json");
      await nodePluginEvalIo().writeFile(path, '{"schemaVersion":1}\n');
      expect(readFileSync(path, "utf8")).toBe('{"schemaVersion":1}\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sleeps its time, ends early on abort, and returns at once when already aborted", async () => {
    vi.useFakeTimers();
    const io = nodePluginEvalIo();

    let done = false;
    const full = io.sleep(2_000, new AbortController().signal).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await full;
    expect(done).toBe(true);

    const interrupt = new AbortController();
    let woke = false;
    const cut = io.sleep(60_000, interrupt.signal).then(() => (woke = true));
    interrupt.abort();
    await cut;
    expect(woke).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    await io.sleep(60_000, interrupt.signal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("listens for SIGINT until told to stop", () => {
    const io = nodePluginEvalIo();
    const before = process.listeners("SIGINT");
    const handler = vi.fn();
    const stop = io.onInterrupt(handler);
    const added = process.listeners("SIGINT").filter((listener) => !before.includes(listener));
    expect(added).toHaveLength(1);
    added[0]!("SIGINT");
    expect(handler).toHaveBeenCalledTimes(1);
    stop();
    expect(process.listeners("SIGINT")).toEqual(before);
  });

  it("exits the process with the code it is given", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${String(code)}`);
    });
    expect(() => nodePluginEvalIo().exit(130)).toThrow("exit 130");
    expect(exit).toHaveBeenCalledWith(130);
  });
});
