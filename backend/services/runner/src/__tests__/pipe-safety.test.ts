import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Writable } from "node:stream";
import { isBrokenPipeError, guardStream, reportFatal } from "../pipe-safety.js";

// Minimal stand-in for a writable host pipe: records writes and lets a test drive
// `error` events deterministically, which is exactly the EPIPE condition from #177.
class FakeWritable extends EventEmitter {
  public writes: string[] = [];
  public throwOnWrite: Error | null = null;
  write(chunk: string): boolean {
    if (this.throwOnWrite) throw this.throwOnWrite;
    this.writes.push(chunk);
    return true;
  }
}

function asWritable(fake: FakeWritable): Writable {
  return fake as unknown as Writable;
}

function pipeError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("isBrokenPipeError", () => {
  it.each([
    ["EPIPE", true],
    ["ERR_STREAM_DESTROYED", true],
    ["ERR_STREAM_WRITE_AFTER_END", true],
    ["ECONNRESET", false],
    ["ENOENT", false],
  ])("classifies code %s as %s", (code, expected) => {
    expect(isBrokenPipeError(pipeError(code))).toBe(expected);
  });

  it("is false for non-error / code-less values", () => {
    expect(isBrokenPipeError(undefined)).toBe(false);
    expect(isBrokenPipeError(null)).toBe(false);
    expect(isBrokenPipeError(new Error("no code"))).toBe(false);
    expect(isBrokenPipeError("EPIPE")).toBe(false);
  });
});

describe("guardStream", () => {
  it("writes through on the happy path", () => {
    const fake = new FakeWritable();
    const write = guardStream(asWritable(fake));

    expect(write("hello\n")).toBe(true);
    expect(fake.writes).toEqual(["hello\n"]);
  });

  it("detaches to a silent no-op after an EPIPE error (the #177 regression)", () => {
    const fake = new FakeWritable();
    const onUnexpected = vi.fn();
    const write = guardStream(asWritable(fake), onUnexpected);

    // Emitting `error` must not throw — a listener is what stops EPIPE from
    // escalating to uncaughtException and forming the busy loop.
    expect(() => fake.emit("error", pipeError("EPIPE"))).not.toThrow();

    expect(write("after\n")).toBe(false);
    expect(fake.writes).toEqual([]);
    expect(onUnexpected).not.toHaveBeenCalled();
  });

  it("reports an unexpected (non-broken-pipe) error exactly once", () => {
    const fake = new FakeWritable();
    const onUnexpected = vi.fn();
    const write = guardStream(asWritable(fake), onUnexpected);

    fake.emit("error", pipeError("ECONNRESET"));
    fake.emit("error", pipeError("ECONNRESET"));

    expect(onUnexpected).toHaveBeenCalledTimes(1);
    expect(write("after\n")).toBe(false);
  });

  it("detaches when stream.write throws synchronously instead of propagating", () => {
    const fake = new FakeWritable();
    fake.throwOnWrite = pipeError("ERR_STREAM_WRITE_AFTER_END");
    const write = guardStream(asWritable(fake));

    expect(() => write("boom\n")).not.toThrow();
    expect(write("boom\n")).toBe(false);

    // Once detached, even a now-healthy stream is left alone (we never retry).
    fake.throwOnWrite = null;
    expect(write("recovered\n")).toBe(false);
    expect(fake.writes).toEqual([]);
  });
});

describe("reportFatal", () => {
  it("writes the label and error detail", () => {
    const writes: string[] = [];
    reportFatal((chunk) => (writes.push(chunk), true), "Uncaught:", new Error("kaboom"));

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("Uncaught:");
    expect(writes[0]).toContain("kaboom");
  });

  it("stringifies non-Error values", () => {
    const writes: string[] = [];
    reportFatal((chunk) => (writes.push(chunk), true), "Uncaught:", "plain string");

    expect(writes[0]).toContain("plain string");
  });

  it("never throws even when the writer itself throws (the re-entrancy trap)", () => {
    const throwingWriter = (): boolean => {
      throw pipeError("EPIPE");
    };

    expect(() => reportFatal(throwingWriter, "Uncaught:", new Error("x"))).not.toThrow();
  });
});
