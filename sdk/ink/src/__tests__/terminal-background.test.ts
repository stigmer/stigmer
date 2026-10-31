// Pins the terminal background detection (INK-12): the OSC 11 reply read as
// light or dark, the DA1 reply behind it ending the wait (so a slow link is
// waited for and a terminal without OSC 11 costs one round trip),
// `COLORFGBG` as the fallback, a silent terminal bounded by the timeout, raw
// mode restored, a key that arrived with the replies given back to stdin for
// Ink to read, and a reply the timeout cut short dropped.
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { DA1_QUERY, OSC11_QUERY, backgroundFromColorFgBg, detectBackground, parseOsc11Reply } from "../terminal-background.js";

/** What every terminal answers to DA1. */
const DA1 = "\u001b[?62;22c";

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
    private readonly delayMs = 5,
  ) {
    this.isTTY = isTTY;
  }
  write(data: string): boolean {
    this.written.push(data);
    const reply = this.reply;
    // A paused stream delivers nothing, as a real one would.
    if (data === OSC11_QUERY + DA1_QUERY && reply !== undefined) {
      setTimeout(() => !this.stdin.isPaused() && this.stdin.emit("data", Buffer.from(reply)), this.delayMs);
    }
    return true;
  }
}

function detect(reply: string | undefined, env: Record<string, string> = {}, tty = true, stdoutTty = tty, timeoutMs = 40) {
  const stdin = new TtyStdin(tty);
  const stdout = new TtyStdout(stdin, reply, stdoutTty);
  const result = detectBackground({
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    env,
    timeoutMs,
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
    // Mid-grey, either side of half: 128 of 255 is light, 127 dark.
    expect(parseOsc11Reply("\u001b]11;rgb:80/80/80\u0007")?.background).toBe("light");
    expect(parseOsc11Reply("\u001b]11;rgb:7f/7f/7f\u0007")?.background).toBe("dark");
    // Blue counts toward the light: green alone is under half here.
    expect(parseOsc11Reply("\u001b]11;rgb:00/9e/ff\u0007")?.background).toBe("light");
    expect(parseOsc11Reply("\u001b]11;rgb:00/9e/00\u0007")?.background).toBe("dark");
    // Exactly half, as this formula computes it, reads as dark.
    expect(parseOsc11Reply("\u001b]11;rgb:2f/8f/d3\u0007")?.background).toBe("dark");
    expect(parseOsc11Reply("\u001b]11;rgb:ffff/ffff")).toBeUndefined();
    expect(parseOsc11Reply("plain keys")).toBeUndefined();
  });

  it("reads COLORFGBG's last field: 7 and 9 to 15 light, the rest dark, anything else unknown", () => {
    expect(backgroundFromColorFgBg("0;15")).toBe("light");
    expect(backgroundFromColorFgBg("0;7")).toBe("light");
    expect(backgroundFromColorFgBg("0;9")).toBe("light");
    expect(backgroundFromColorFgBg("0;6")).toBe("dark");
    expect(backgroundFromColorFgBg("15;x0")).toBe("unknown");
    expect(backgroundFromColorFgBg("15;0x")).toBe("unknown");
    expect(backgroundFromColorFgBg("15;default;0")).toBe("dark");
    expect(backgroundFromColorFgBg("15;8")).toBe("dark");
    expect(backgroundFromColorFgBg("15;16")).toBe("dark");
    expect(backgroundFromColorFgBg("15;default")).toBe("unknown");
    expect(backgroundFromColorFgBg(undefined)).toBe("unknown");
  });

  it("asks the terminal, reads its answer, and leaves stdin as it found it", async () => {
    const { result, stdin, stdout } = detect(`\u001b]11;rgb:ffff/ffff/ffff\u001b\\${DA1}`);
    expect(await result).toBe("light");
    expect(stdout.written).toEqual([OSC11_QUERY + DA1_QUERY]);
    expect(stdin.rawModes).toEqual([true, false]);
    expect(stdin.isPaused()).toBe(true);
    expect(stdin.listenerCount("data")).toBe(0);
    expect(stdin.unshifted).toEqual([]);
  });

  it("gives back a key that arrived with the replies, so Ink reads it", async () => {
    const { result, stdin } = detect(`a\u001b]11;rgb:0000/0000/0000\u0007b${DA1}c`);
    expect(await result).toBe("dark");
    expect(stdin.unshifted).toEqual(["abc"]);
  });

  it("waits for a slow terminal's reply past what a timer would allow, so none reaches Ink as keys", async () => {
    const stdin = new TtyStdin();
    const stdout = new TtyStdout(stdin, `\u001b]11;rgb:1e1e/1e1e/1e1e\u0007${DA1}`, true, 150);
    const result = detectBackground({ stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, env: {} });
    expect(await result).toBe("dark");
    expect(stdin.unshifted).toEqual([]);
  });

  it("ends at the DA1 reply when the terminal does not know OSC 11, long before the timeout", async () => {
    const started = Date.now();
    const { result, stdin } = detect(DA1, { COLORFGBG: "0;15" }, true, true, 10_000);
    expect(await result).toBe("light");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(stdin.unshifted).toEqual([]);
  });

  it("falls back to COLORFGBG when the terminal does not answer in time", async () => {
    const { result, stdin } = detect(undefined, { COLORFGBG: "0;15" });
    expect(await result).toBe("light");
    expect(stdin.rawModes).toEqual([true, false]);
    expect(await detect(undefined).result).toBe("unknown");
  });

  it("at the timeout, reads a colour that came without DA1, and drops a reply cut short instead of giving it to Ink", async () => {
    const colourOnly = detect("k\u001b]11;rgb:ffff/ffff/ffff\u0007\u001b[?62");
    expect(await colourOnly.result).toBe("light");
    expect(colourOnly.stdin.unshifted).toEqual(["k"]);
    for (const cut of ["\u001b]11;rgb:1e1e/1e", "\u001b]11;rgb:1e1e/1e1e/1e1e\u001b", "\u001b]1", "\u001b]", "\u001b"]) {
      const { result, stdin } = detect(`k${cut}`);
      expect(await result).toBe("unknown");
      expect(stdin.unshifted).toEqual(["k"]);
    }
  });

  it("asks nothing unless both streams are a terminal that takes raw mode", async () => {
    const white = "\u001b]11;rgb:ffff/ffff/ffff\u0007";
    for (const [stdinTty, stdoutTty] of [[false, false], [true, false], [false, true]] as const) {
      const { result, stdout } = detect(white, { COLORFGBG: "15;0" }, stdinTty, stdoutTty);
      expect(await result).toBe("dark");
      expect(stdout.written).toEqual([]);
    }
    const stdin = Object.assign(new TtyStdin(), { setRawMode: undefined });
    const stdout = new TtyStdout(stdin as unknown as TtyStdin, white);
    expect(await detectBackground({ stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, env: {} })).toBe("unknown");
    expect(stdout.written).toEqual([]);
  });

  it("leaves a flowing stdin flowing, and its timeout does not fire after the answer", async () => {
    const stdin = new TtyStdin();
    stdin.resume();
    const stdout = new TtyStdout(stdin, `\u001b]11;rgb:0/0/0\u0007${DA1}`);
    const result = detectBackground({ stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, env: {}, timeoutMs: 40 });
    expect(await result).toBe("dark");
    expect(stdin.isPaused()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(stdin.rawModes).toEqual([true, false]);
  });

  it("keeps raw mode on when it found it on", async () => {
    const stdin = new TtyStdin();
    stdin.isRaw = true;
    const stdout = new TtyStdout(stdin, `\u001b]11;rgb:ffff/ffff/ffff\u0007${DA1}`);
    const background = await detectBackground({ stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, env: {} });
    expect(background).toBe("light");
    expect(stdin.rawModes).toEqual([]);
  });
});
