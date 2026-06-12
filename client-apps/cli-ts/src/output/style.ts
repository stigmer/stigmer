// Minimal ANSI styling for human-facing output.
//
// Mirrors the Go CLI's reliance on fatih/color, which auto-disables when the
// target stream is not a TTY and honors NO_COLOR. Keeping this tiny avoids a
// dependency for what is a handful of escape codes.

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  faint: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
} as const;

/** A styler whose methods either wrap text in ANSI codes or pass it through. */
export interface Styler {
  green(text: string): string;
  yellow(text: string): string;
  red(text: string): string;
  bold(text: string): string;
  dim(text: string): string;
}

const PLAIN: Styler = {
  green: (t) => t,
  yellow: (t) => t,
  red: (t) => t,
  bold: (t) => t,
  dim: (t) => t,
};

const COLORED: Styler = {
  green: (t) => `${ANSI.green}${ANSI.bold}${t}${ANSI.reset}`,
  yellow: (t) => `${ANSI.yellow}${ANSI.bold}${t}${ANSI.reset}`,
  red: (t) => `${ANSI.red}${ANSI.bold}${t}${ANSI.reset}`,
  bold: (t) => `${ANSI.bold}${t}${ANSI.reset}`,
  dim: (t) => `${ANSI.faint}${t}${ANSI.reset}`,
};

/** Pick a styler: colored only when explicitly enabled. */
export function styler(colorize: boolean): Styler {
  return colorize ? COLORED : PLAIN;
}

/**
 * Whether color should be enabled for a stream. Disabled when NO_COLOR is set
 * (any value) or the stream is not an interactive TTY.
 */
export function shouldColorize(stream: { isTTY?: boolean }): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  return stream.isTTY === true;
}
