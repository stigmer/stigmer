// Contract for the hidden prompt: a key pasted with its Enter, or typed by a
// terminal driver in one write, arrives as one chunk and must finish the
// prompt at its first Enter, without the newline in the value; backspace
// still edits. stdin is replaced with an emitter that claims to be a TTY.

import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { promptSecret } from "../prompt.js";

class FakeTty extends EventEmitter {
  readonly isTTY = true;
  rawMode = false;
  setRawMode(on: boolean): this {
    this.rawMode = on;
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
}

const realStdin = Object.getOwnPropertyDescriptor(process, "stdin")!;

function withFakeStdin(): FakeTty {
  const fake = new FakeTty();
  Object.defineProperty(process, "stdin", { value: fake, configurable: true });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  return fake;
}

afterEach(() => {
  Object.defineProperty(process, "stdin", realStdin);
  vi.restoreAllMocks();
});

describe("promptSecret", () => {
  it("finishes on a paste that carries its own Enter", async () => {
    const stdin = withFakeStdin();
    const answer = promptSecret("Anthropic API key");
    stdin.emit("data", Buffer.from("sk-ant-pasted\r"));
    await expect(answer).resolves.toBe("sk-ant-pasted");
    expect(stdin.rawMode).toBe(false);
  });

  it("reads keys typed one at a time, with backspace", async () => {
    const stdin = withFakeStdin();
    const answer = promptSecret("Anthropic API key");
    for (const key of ["a", "b", "x", "\u007f", "c", "\n"]) stdin.emit("data", Buffer.from(key));
    await expect(answer).resolves.toBe("abc");
  });

  it("leaves on Ctrl-C with code 130, the terminal out of raw mode", async () => {
    const stdin = withFakeStdin();
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    void promptSecret("Anthropic API key");
    stdin.emit("data", Buffer.from("sk-\u0003"));
    expect(exit).toHaveBeenCalledWith(130);
    expect(stdin.rawMode).toBe(false);
  });
});
