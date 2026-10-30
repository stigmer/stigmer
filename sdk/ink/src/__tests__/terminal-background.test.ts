// Pins the terminal background detection (INK-12): the OSC 11 reply read as
// light or dark, `COLORFGBG` as the fallback, a silent terminal bounded by
// the timeout, raw mode restored, and a key that arrived with the reply given
// back to stdin for Ink to read.
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { OSC11_QUERY, backgroundFromColorFgBg, detectBackground, parseOsc11Reply } from "../terminal-background.js";

/** A TTY stdin that records its raw mode and what was given back. */
class TtyStdin extends EventEmitter {
  readonly isTTY: boolean;
  isRaw = false;
  paused = true;
  readonly rawModes: boolean[] = [];
  readonly unshifted: string[] = [];
  constructor(isTTY = true) {
    super();
    this.isTTY = isTTY;
  }
  setRawMode(mode: boolean): void {
    this.isRaw = mode;
    this.rawModes.push(mode);
  }
  isPaused(): boolean {
    return this.paused;
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
  unshift(chunk: Buffer): void {
    this.unshifted.push(chunk.toString());
  }
}

/** A TTY stdout that answers the query, after `delayMs`, with `reply` (or never). */
class TtyStdout {
  readonly isTTY: boolean;
  readonly written: string[] = [];
  constructor(
    private readonly stdin: TtyStdin,
    private readonly reply: string | undefined,
    isTTY = true,
  ) {
    this.isTTY = isTTY;
  }
  write(data: string): boolean {
    this.written.push(data);
    const reply = this.reply;
    if (data === OSC11_QUERY && reply !== undefined) setTimeout(() => this.stdin.emit("data", Buffer.from(reply)), 5);
    return true;
  }
}

function detect(reply: string | undefined, env: Record<string, string> = {}, tty = true) {
  const stdin = new TtyStdin(tty);
  const stdout = new TtyStdout(stdin, reply, tty);
  const result = detectBackground({
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    env,
    timeoutMs: 40,
  });
  return { result, stdin, stdout };
}

describe("INK-12 colours read on a light and a dark terminal", () => {
  it("reads a reply's colour as light or dark, by its luminance, at any channel width", () => {
    expect(parseOsc11Reply("\u001b]11;rgb:ffff/ffff/ffff\u0007")?.background).toBe("light");
    expect(parseOsc11Reply("\u001b]11;rgb:1e1e/1e1e/1e1e\u001b\\")?.background).toBe("dark");
    expect(parseOsc11Reply("\u001b]11;rgb:fd/f6/e3\u0007")?.background).toBe("light");
    expect(parseOsc11Reply("\u001b]11;rgba:0000/0000/0000/ffff\u0007")?.background).toBe("dark");
    expect(parseOsc11Reply("x\u001b]11;rgb:0/0/0\u0007y")).toEqual({ background: "dark", start: 1, end: 16 });
    expect(parseOsc11Reply("\u001b]11;rgb:ffff/ffff")).toBeUndefined();
    expect(parseOsc11Reply("plain keys")).toBeUndefined();
  });

  it("reads COLORFGBG's last field: 7 and 9 to 15 light, the rest dark, anything else unknown", () => {
    expect(backgroundFromColorFgBg("0;15")).toBe("light");
    expect(backgroundFromColorFgBg("0;7")).toBe("light");
    expect(backgroundFromColorFgBg("15;default;0")).toBe("dark");
    expect(backgroundFromColorFgBg("15;8")).toBe("dark");
    expect(backgroundFromColorFgBg("15;16")).toBe("dark");
    expect(backgroundFromColorFgBg("15;default")).toBe("unknown");
    expect(backgroundFromColorFgBg(undefined)).toBe("unknown");
  });

  it("asks the terminal, reads its answer, and leaves stdin as it found it", async () => {
    const { result, stdin, stdout } = detect("\u001b]11;rgb:ffff/ffff/ffff\u001b\\");
    expect(await result).toBe("light");
    expect(stdout.written).toEqual([OSC11_QUERY]);
    expect(stdin.rawModes).toEqual([true, false]);
    expect(stdin.isPaused()).toBe(true);
    expect(stdin.listenerCount("data")).toBe(0);
    expect(stdin.unshifted).toEqual([]);
  });

  it("gives back a key that arrived with the reply, so Ink reads it", async () => {
    const { result, stdin } = detect("a\u001b]11;rgb:0000/0000/0000\u0007b");
    expect(await result).toBe("dark");
    expect(stdin.unshifted).toEqual(["ab"]);
  });

  it("falls back to COLORFGBG when the terminal does not answer in time", async () => {
    const { result, stdin } = detect(undefined, { COLORFGBG: "0;15" });
    expect(await result).toBe("light");
    expect(stdin.rawModes).toEqual([true, false]);
    expect(await detect(undefined).result).toBe("unknown");
  });

  it("asks nothing off a terminal", async () => {
    const { result, stdout } = detect("\u001b]11;rgb:ffff/ffff/ffff\u0007", { COLORFGBG: "15;0" }, false);
    expect(await result).toBe("dark");
    expect(stdout.written).toEqual([]);
  });

  it("keeps raw mode on when it found it on", async () => {
    const stdin = new TtyStdin();
    stdin.isRaw = true;
    const stdout = new TtyStdout(stdin, "\u001b]11;rgb:ffff/ffff/ffff\u0007");
    const background = await detectBackground({ stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, env: {} });
    expect(background).toBe("light");
    expect(stdin.rawModes).toEqual([]);
  });
});
