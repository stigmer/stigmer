/**
 * Builds the source file a compiler reads for one fence, keeping a map from
 * every line of that file back to the page line it came from, so a compile
 * error names the page and line a reader sees.
 *
 * Lines the gate adds (a prelude's imports and declarations, a wrapper's
 * opening and closing) map to null; an error there is reported at the fence's
 * opening line, because the fence is what made the prelude wrong.
 */

export class Assembly {
  constructor() {
    /** @type {string[]} */
    this.lines = [];
    /** @type {(number | null)[]} */
    this.map = [];
  }

  /** Adds lines the gate wrote. */
  add(...lines) {
    for (const text of lines) {
      for (const line of text.split("\n")) {
        this.lines.push(line);
        this.map.push(null);
      }
    }
    return this;
  }

  /**
   * Adds a fence's body lines, each mapped to its page line.
   * @param {string[]} bodyLines the body, one entry per line
   * @param {number} firstPageLine the page line of the body's first line
   * @param {(line: string) => string} [transform] a per-line rewrite (an indent)
   */
  addBody(bodyLines, firstPageLine, transform = (l) => l) {
    bodyLines.forEach((line, i) => {
      this.lines.push(transform(line));
      this.map.push(firstPageLine + i);
    });
    return this;
  }

  text() {
    return `${this.lines.join("\n")}\n`;
  }

  /** The page line for a 1-based line of the assembled file, or null for a gate-written line. */
  pageLine(line) {
    return this.map[line - 1] ?? null;
  }
}

/** A fence body as lines, without the trailing empty line its final newline makes. */
export function bodyLines(body) {
  const lines = body.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
