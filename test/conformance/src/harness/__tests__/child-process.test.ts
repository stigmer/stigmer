// Unit arms for the harness's one child-process discipline: a stop resolves
// only on exit and escalates to SIGKILL on a bounded grace; the output tee
// ends its file sink only after the child's stdio has closed, so a chunk
// emitted during the child's shutdown lands in the file instead of throwing
// `ERR_STREAM_WRITE_AFTER_END` (the Class B teardown red of entry 20260908.01).
// Pure: a fake child, a temp file, fake timers. No target.
// Domain: conformance harness (process lifecycle).
import { EventEmitter } from "node:events";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopChild, teeChildOutput, type ChildHandle } from "../child-process";

// The narrowest thing that satisfies ChildHandle. `kill` records signals and
// leaves exiting to the test, which is what lets each arm choose its ordering.
class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly signals: string[] = [];

  kill(signal?: NodeJS.Signals | number): boolean {
    this.signals.push(String(signal ?? "SIGTERM"));
    return true;
  }

  // Exit as a signalled process would: the exit event first, stdio close after
  // the pipes drain (a separate tick, as in Node).
  exitBySignal(signal: NodeJS.Signals): void {
    this.signalCode = signal;
    this.emit("exit", null, signal);
  }

  closeStdio(): void {
    this.stdout.end();
    this.stderr.end();
    this.emit("close", this.exitCode, this.signalCode);
  }

  asHandle(): ChildHandle {
    return this as unknown as ChildHandle;
  }
}

// Lets stream `data` events and settled promises land. Real setImmediate: the
// fake timers below take only the timeout pair, so this stays a real tick.
async function flush(): Promise<void> {
  await new Promise<void>((resolveFlushed) => setImmediate(resolveFlushed));
}

// Only the grace timers are faked; streams and flush() keep the real loop.
const FAKE_TIMEOUTS_ONLY: NonNullable<Parameters<typeof vi.useFakeTimers>[0]> = {
  toFake: ["setTimeout", "clearTimeout"],
};

describe("stopChild", () => {
  beforeEach(() => {
    vi.useFakeTimers(FAKE_TIMEOUTS_ONLY);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the requested signal and resolves only once the child has exited", async () => {
    const child = new FakeChild();
    let settled = false;
    const stopping = stopChild(child.asHandle(), { signal: "SIGTERM", graceMs: 1_000 }).then(() => {
      settled = true;
    });
    await flush();
    expect(child.signals).toEqual(["SIGTERM"]);
    expect(settled, "a stop is not done before exit").toBe(false);

    child.exitBySignal("SIGTERM");
    await stopping;
    expect(settled).toBe(true);
    expect(child.signals, "no SIGKILL when the child left within the grace").toEqual(["SIGTERM"]);
  });

  it("escalates to SIGKILL after the grace, telling the caller once", async () => {
    const child = new FakeChild();
    const onForceKill = vi.fn();
    const stopping = stopChild(child.asHandle(), { signal: "SIGTERM", graceMs: 1_000, onForceKill });
    await flush();

    await vi.advanceTimersByTimeAsync(999);
    expect(child.signals).toEqual(["SIGTERM"]);
    expect(onForceKill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(onForceKill).toHaveBeenCalledTimes(1);

    child.exitBySignal("SIGKILL");
    await stopping;
  });

  it("does not arm a grace when the signal is already SIGKILL", async () => {
    const child = new FakeChild();
    const onForceKill = vi.fn();
    const stopping = stopChild(child.asHandle(), { signal: "SIGKILL", graceMs: 10, onForceKill });
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.signals).toEqual(["SIGKILL"]);
    expect(onForceKill).not.toHaveBeenCalled();
    child.exitBySignal("SIGKILL");
    await stopping;
  });

  it("is a no-op on a child that has already exited", async () => {
    const child = new FakeChild();
    child.exitCode = 0;
    await stopChild(child.asHandle(), { signal: "SIGTERM", graceMs: 1_000 });
    expect(child.signals).toEqual([]);
  });
});

describe("teeChildOutput", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "conformance-child-process-"));
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a chunk emitted between the stop signal and stdio close to the file — the ordering that used to throw write-after-end", async () => {
    const child = new FakeChild();
    const file = join(dir, "runner.log");
    const tee = teeChildOutput(child.asHandle(), { tailBytes: 8_000, file });

    child.stdout.write("Worker ready, polling for tasks\n");
    await flush();

    // The caller's stop: signal, await exit, THEN close the tee. The runner's
    // shutdown line arrives after `exit` and before `close` — exactly where
    // the old runner-process.ts had already ended its sink.
    const stopping = stopChild(child.asHandle(), { signal: "SIGTERM", graceMs: 1_000 });
    await flush();
    child.exitBySignal("SIGTERM");
    await stopping;

    const closing = tee.close();
    child.stderr.write("worker drained, shutting down\n");
    await flush();
    child.closeStdio();
    await closing;

    const written = await readFile(file, "utf8");
    expect(written).toBe("Worker ready, polling for tasks\nworker drained, shutting down\n");
    expect(tee.tail()).toBe(written);
  });

  it("bounds the in-memory tail to tailBytes and hands each chunk to onChunk", async () => {
    const child = new FakeChild();
    const seen: string[] = [];
    const tee = teeChildOutput(child.asHandle(), { tailBytes: 10, onChunk: (text) => seen.push(text) });
    child.stdout.write("0123456789");
    child.stdout.write("abcdef");
    await flush();
    expect(tee.tail()).toBe("6789abcdef");
    expect(seen).toEqual(["0123456789", "abcdef"]);
    await tee.close();
  });

  it("ends the sink anyway once the close grace expires, and drops a straggling chunk instead of throwing", async () => {
    vi.useFakeTimers(FAKE_TIMEOUTS_ONLY);
    const child = new FakeChild();
    const file = join(dir, "server.log");
    const tee = teeChildOutput(child.asHandle(), { tailBytes: 8_000, file });
    child.stdout.write("listening\n");
    await flush();
    child.exitBySignal("SIGKILL");

    // A grandchild holds the pipes: `close` never comes.
    let closed = false;
    const closing = tee.close(50).then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(49);
    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(closed).toBe(true);

    expect(() => child.stdout.write("late\n")).not.toThrow();
    await flush();
    expect(tee.tail(), "the tail still sees the straggler").toBe("listening\nlate\n");
    expect(await readFile(file, "utf8"), "the file does not").toBe("listening\n");
  });

  it("close() is idempotent and a no-op without a file", async () => {
    const child = new FakeChild();
    const tee = teeChildOutput(child.asHandle(), { tailBytes: 100 });
    await tee.close();
    await tee.close();

    const withFile = teeChildOutput(new FakeChild().asHandle(), { tailBytes: 100, file: join(dir, "twice.log") });
    const first = withFile.close(10);
    const second = withFile.close(10);
    expect(second).toBe(first);
    await first;
  });
});
