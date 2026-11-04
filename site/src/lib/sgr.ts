/**
 * The terminal's text, as the docs draw it: a recording's frame (escape
 * codes kept, as the terminal kit draws it) turned into lines of styled
 * runs a `<pre>` can show.
 *
 * Only the codes the terminal kit may write are read: reset, bold, dim,
 * italic, underline and inverse with their ends, and the status hues (red,
 * green, yellow) with the default foreground, the colours INK-15 allows on
 * the UX bar (sdk/ink/src/__tests__/session-frames.test.tsx). Any other
 * escape sequence throws, so a frame that starts carrying one fails the
 * site's test of every recording rather than drawing a stray code.
 */

/** A status hue a run may carry. */
export type Hue = "red" | "green" | "yellow";

/** How a run of text is drawn. */
export interface RunStyle {
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly inverse: boolean;
  readonly hue: Hue | null;
}

/** A run of text in one style. */
export interface StyledRun {
  readonly text: string;
  readonly style: RunStyle;
}

const PLAIN: RunStyle = { bold: false, dim: false, italic: false, underline: false, inverse: false, hue: null };

/** What each code the kit may write does to the style. */
const CODES: Readonly<Record<number, (style: RunStyle) => RunStyle>> = {
  0: () => PLAIN,
  1: (s) => ({ ...s, bold: true }),
  2: (s) => ({ ...s, dim: true }),
  3: (s) => ({ ...s, italic: true }),
  4: (s) => ({ ...s, underline: true }),
  7: (s) => ({ ...s, inverse: true }),
  22: (s) => ({ ...s, bold: false, dim: false }),
  23: (s) => ({ ...s, italic: false }),
  24: (s) => ({ ...s, underline: false }),
  27: (s) => ({ ...s, inverse: false }),
  31: (s) => ({ ...s, hue: "red" }),
  32: (s) => ({ ...s, hue: "green" }),
  33: (s) => ({ ...s, hue: "yellow" }),
  39: (s) => ({ ...s, hue: null }),
};

/** An escape sequence: CSI with its parameters and final byte, or any other ESC form. */
const ESCAPE = /\u001b(?:\[([0-9;]*)([A-Za-z])|.)/g;

/** `text` as lines of styled runs; throws on a code the terminal kit may not write. */
export function styledLines(text: string): StyledRun[][] {
  const lines: StyledRun[][] = [[]];
  let style = PLAIN;
  const push = (chunk: string) => {
    const parts = chunk.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part !== "") lines.at(-1)!.push({ text: part, style });
    });
  };
  let from = 0;
  for (const match of text.matchAll(ESCAPE)) {
    push(text.slice(from, match.index));
    from = match.index + match[0].length;
    if (match[2] !== "m") throw new Error(`a terminal frame carries ${JSON.stringify(match[0])}, which the docs do not draw`);
    const params = match[1] === "" ? [0] : match[1]!.split(";").map(Number);
    for (const code of params) {
      const apply = CODES[code];
      if (apply === undefined) throw new Error(`a terminal frame sets SGR ${code} (${JSON.stringify(match[0])}), which the docs do not draw`);
      style = apply(style);
    }
  }
  push(text.slice(from));
  return lines;
}

/** `text` with every escape code removed: what a reader of the markdown exports reads. */
export function plainText(text: string): string {
  return styledLines(text)
    .map((line) => line.map((run) => run.text).join(""))
    .join("\n");
}
