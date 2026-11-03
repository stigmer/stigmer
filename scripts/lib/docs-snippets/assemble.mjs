/**
 * Builds the source file a compiler reads for one fence, keeping a map from
 * every line of that file back to the page line it came from, so a compile
 * error names the page and line a reader sees.
 *
 * Lines the gate adds (its convention's declarations, a wrapper's opening
 * and closing) map to null; an error there is reported at the fence's
 * opening line, because the fence is what made the convention wrong. Lines
 * of the page's `prelude` fence map to their own page lines and are marked,
 * so a compiler can tell an unused prelude import (one fragment uses some of
 * the prelude, another the rest) from the fence's own.
 */

export class Assembly {
  constructor() {
    /** @type {string[]} */
    this.lines = [];
    /** @type {(number | null)[]} */
    this.map = [];
    /** @type {Set<number>} 0-based indexes of the lines that came from the page's prelude */
    this.preludeIndexes = new Set();
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
   * Adds lines of the page's prelude fence, each mapped to its page line and
   * marked as the prelude's.
   * @param {string[]} lines
   * @param {number[]} pageLines the page line of each entry of `lines`
   */
  addPrelude(lines, pageLines) {
    lines.forEach((line, i) => {
      this.preludeIndexes.add(this.lines.length);
      this.lines.push(line);
      this.map.push(pageLines[i]);
    });
    return this;
  }

  /** Whether a 1-based line of the assembled file came from the page's prelude. */
  fromPrelude(line) {
    return this.preludeIndexes.has(line - 1);
  }

  /**
   * Adds a fence's lines as collect.mjs holds them, each with its page line.
   * @param {{text: string, line: number}[]} lines
   * @param {(line: string) => string} [transform] a per-line rewrite (an indent)
   */
  addSource(lines, transform = (l) => l) {
    for (const { text, line } of lines) {
      this.lines.push(transform(text));
      this.map.push(line);
    }
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

/**
 * An error at a line of a unit's assembled file, placed on the page: a line
 * the gate wrote reports at the fence, a prelude line at the prelude with
 * the fence named.
 */
export function located(unit, assembly, line, message) {
  const pageLine = line === 0 ? null : assembly.pageLine(line);
  if (pageLine === null) return { id: unit.id, page: unit.page, line: unit.line, message: `${message} (in the gate's convention for this fence)` };
  if (assembly.fromPrelude(line)) {
    return { id: unit.id, page: unit.page, line: pageLine, message: `${message} (in the page's prelude, compiling the fence at line ${unit.line})` };
  }
  return { id: unit.id, page: unit.page, line: pageLine, message };
}
