// Text another person or a model wrote, made safe to print to a terminal.
//
// A description, a SKILL.md pushed from someone's repository, an agent's
// instructions, a run's error quoting model output: any of them can carry
// an escape sequence (ESC [1A ESC [2K erases a line to fake output; an OSC 52
// writes the reader's clipboard). The CLI prints such text only through
// these two helpers, the same rule run-scores.ts and eval-run/report.ts keep
// for their own cells.
//
// Proven by __tests__/printable.test.ts.

// C0 controls but the line break, DEL, and the C1 controls.
const CONTROLS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

/**
 * `text` with every control character removed, its line breaks kept; a tab
 * becomes two spaces, so a column it would have jumped to stays a column.
 */
export function printable(text: string): string {
  return text.replace(/\t/g, "  ").replace(CONTROLS, "");
}

/** `text` as one table cell: each run of whitespace or control characters becomes one space. */
export function printableCell(text: string): string {
  return text.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
}
