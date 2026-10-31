// A reply's markdown as its top-level blocks, read with marked's lexer: what
// components/Markdown.tsx draws, and what lets a streaming reply settle block
// by block. Text is only ever appended, so a block a blank line or a new
// block's start closed can no longer change, with one exception: the block
// being written may turn out to continue a list above it ("1. one", a blank
// line, then "2" that becomes "2. two"). So the thread writes every block but
// the last to the terminal's history once, and keeps a list just above the
// last one live with it.
//
// Trade-offs:
//   - The lexer runs over the whole text at each update, so a reference-style
//     link resolves when its definition is in the text; one defined after the
//     block that uses it settled draws as its text alone.
//   - Spacing and link definitions are not blocks: they draw nothing.
//
// Proven by __tests__/markdown.test.ts.

import { Lexer, type Token } from "marked";

/** The kinds of top-level token that draw nothing. */
const NOT_DRAWN: ReadonlySet<string> = new Set(["space", "def"]);

/** The top-level blocks of a markdown text, in order: what draws, spacing and link definitions left out. */
export function markdownBlocks(text: string): readonly Token[] {
  return Lexer.lex(text).filter((token) => !NOT_DRAWN.has(token.type));
}

/**
 * How many of a text's blocks can no longer change: all of them once the text
 * is complete; while it is still being written, every one but the last, and
 * but a list just above the last, which the last may still join.
 */
export function settledBlockCount(blocks: readonly Token[], writing: boolean): number {
  if (!writing) return blocks.length;
  const open = blocks.at(-2)?.type === "list" ? 2 : 1;
  return Math.max(0, blocks.length - open);
}
