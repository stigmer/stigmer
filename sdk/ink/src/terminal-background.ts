// Whether the terminal draws on a light or a dark background, for a host whose
// own colours differ between the two (theme.ts: a theme given as a function of
// the background). Stigmer's default needs no answer: it is black and white,
// and a terminal's palette already adapts the status hues, so nothing asks
// unless a host's theme does.
//
// It asks the terminal with OSC 11 ("what is your background colour?") and
// reads the reply, `ESC ] 11 ; rgb:RRRR/GGGG/BBBB` ended by BEL or ST; a
// terminal that does not answer within the timeout, or a stream that is not a
// TTY, falls back to `COLORFGBG` ("15;0": foreground 15, background 0).
//
// Trade-offs, after Ink's own kitty-keyboard query:
//   - It runs only on a TTY, in raw mode so the reply is not echoed, and
//     restores the mode it found.
//   - Bytes that arrive with or after the reply that are not part of it (a key
//     the person pressed) are given back to stdin, so Ink reads them.
//   - The timeout bounds what a silent terminal costs: 100 ms by default,
//     paid only by a host that asked.
//
// Proven by __tests__/terminal-background.test.ts.

/** What the background reads as. */
export type TerminalBackground = "light" | "dark" | "unknown";

/** The streams and environment the detection reads. */
export interface DetectBackgroundOptions {
  readonly stdin?: NodeJS.ReadStream;
  readonly stdout?: NodeJS.WriteStream;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** How long to wait for the terminal's reply; 100 ms by default. */
  readonly timeoutMs?: number;
}

/** The question: the background colour, ended by ST. */
export const OSC11_QUERY = "\u001b]11;?\u001b\\";

/** A reply to OSC 11: up to four hex digits per channel, ended by BEL or ST. */
const OSC11_REPLY = /\u001b\]11;rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})(?:\/[0-9a-f]{1,4})?(?:\u0007|\u001b\\)/i;

/** The background a reply names, and the reply's place in the bytes read; undefined when they hold no whole reply. */
export function parseOsc11Reply(data: string): { readonly background: "light" | "dark"; readonly start: number; readonly end: number } | undefined {
  const match = OSC11_REPLY.exec(data);
  if (match === null) return undefined;
  const [red, green, blue] = [match[1]!, match[2]!, match[3]!].map((hex) => Number.parseInt(hex, 16) / (16 ** hex.length - 1));
  // Relative luminance, by the sRGB weights; above half reads as light.
  const luminance = 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  return { background: luminance > 0.5 ? "light" : "dark", start: match.index, end: match.index + match[0].length };
}

/** The background `COLORFGBG` names ("fg;bg", or "fg;default;bg"): 7 and 9 to 15 are light, the rest dark. */
export function backgroundFromColorFgBg(value: string | undefined): TerminalBackground {
  const last = value?.split(";").at(-1);
  if (last === undefined || !/^\d+$/.test(last)) return "unknown";
  const index = Number(last);
  return index === 7 || (index >= 9 && index <= 15) ? "light" : "dark";
}

/** The terminal's background: asked with OSC 11, else read from `COLORFGBG`, else "unknown" (module header). */
export async function detectBackground(options: DetectBackgroundOptions = {}): Promise<TerminalBackground> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const fallback = backgroundFromColorFgBg((options.env ?? process.env).COLORFGBG);
  if (stdin.isTTY !== true || stdout.isTTY !== true || typeof stdin.setRawMode !== "function") return fallback;

  const wasRaw = stdin.isRaw === true;
  const wasPaused = stdin.isPaused();
  return new Promise<TerminalBackground>((resolve) => {
    let read = "";
    const finish = (background: TerminalBackground, leftover: string): void => {
      clearTimeout(timer);
      stdin.off("data", onData);
      if (!wasRaw) stdin.setRawMode(false);
      if (wasPaused) stdin.pause();
      if (leftover !== "") stdin.unshift(Buffer.from(leftover));
      resolve(background);
    };
    const onData = (chunk: Buffer | string): void => {
      read += chunk.toString();
      const reply = parseOsc11Reply(read);
      if (reply !== undefined) finish(reply.background, read.slice(0, reply.start) + read.slice(reply.end));
    };
    const timer = setTimeout(() => finish(fallback, read), options.timeoutMs ?? 100);
    if (!wasRaw) stdin.setRawMode(true);
    stdin.on("data", onData);
    stdin.resume();
    stdout.write(OSC11_QUERY);
  });
}
