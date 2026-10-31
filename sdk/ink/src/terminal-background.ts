// Whether the terminal draws on a light or a dark background, for a host whose
// own colours differ between the two (theme.ts: a theme given as a function of
// the background). Stigmer's default needs no answer: it is black and white,
// and a terminal's palette already adapts the status hues, so nothing asks
// unless a host's theme does.
//
// It asks the terminal with OSC 11 ("what is your background colour?") and
// reads the reply, `ESC ] 11 ; rgb:RRRR/GGGG/BBBB` ended by BEL or ST. Behind
// it, it asks for the device attributes (DA1, `ESC [ c`), which every terminal
// answers, and answers in order: once that reply is in, the colour has come or
// never will. So a terminal that does not know OSC 11 costs one round trip,
// and a slow link (SSH) is waited for rather than timed out, which would leave
// a late reply for Ink to read as keys typed into the composer. A terminal
// that answers neither, or a stream that is not a TTY, falls back to
// `COLORFGBG` ("15;0": foreground 15, background 0).
//
// Trade-offs, after Ink's own kitty-keyboard query:
//   - It runs only on a TTY, in raw mode so the reply is not echoed, and
//     restores the mode it found.
//   - Bytes that arrive with the replies that are not part of them (a key the
//     person pressed) are given back to stdin, so Ink reads them; a reply the
//     timeout cut short is dropped, not given back.
//   - The timeout bounds what a terminal that answers nothing costs: one
//     second by default, paid only by a host that asked. A reply later than
//     that still reaches Ink.
//
// Proven by __tests__/terminal-background.test.ts.

/** What the background reads as. */
export type TerminalBackground = "light" | "dark" | "unknown";

/** The streams and environment the detection reads. */
export interface DetectBackgroundOptions {
  /** Where the reply is read; `process.stdin` by default. */
  readonly stdin?: NodeJS.ReadStream;
  /** Where the question is written; `process.stdout` by default. */
  readonly stdout?: NodeJS.WriteStream;
  /** The environment `COLORFGBG` is read from; `process.env` by default. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** How long to wait for a terminal that does not answer; 1000 ms by default. */
  readonly timeoutMs?: number;
}

/** The question: the background colour, ended by ST. */
export const OSC11_QUERY = "\u001b]11;?\u001b\\";

/** The question every terminal answers, asked after the colour, so its reply says the colour's is in. */
export const DA1_QUERY = "\u001b[c";

/** A reply to DA1: `ESC [ ?` and the attributes, ended by `c`. */
const DA1_REPLY = /\u001b\[\?[\d;]*c/;

/** The start of a reply the timeout cut short, at the end of what was read. */
const CUT_REPLY = /\u001b(?:\](?:1(?:1(?:;[^\u0007\u001b]*\u001b?)?)?)?|\[(?:\?[\d;]*)?)?$/;

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
    // The colour's reply, taken out of what was read, and what is left.
    const answer = (bytes: string): { readonly background: TerminalBackground; readonly rest: string } => {
      const reply = parseOsc11Reply(bytes);
      return reply === undefined ? { background: fallback, rest: bytes } : { background: reply.background, rest: bytes.slice(0, reply.start) + bytes.slice(reply.end) };
    };
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
      const attributes = DA1_REPLY.exec(read);
      if (attributes === null) return;
      const { background, rest } = answer(read.slice(0, attributes.index));
      finish(background, rest + read.slice(attributes.index + attributes[0].length));
    };
    const timer = setTimeout(() => {
      const { background, rest } = answer(read);
      finish(background, rest.replace(CUT_REPLY, ""));
    }, options.timeoutMs ?? 1000);
    if (!wasRaw) stdin.setRawMode(true);
    stdin.on("data", onData);
    stdin.resume();
    stdout.write(OSC11_QUERY + DA1_QUERY);
  });
}
