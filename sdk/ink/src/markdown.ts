// A reply's markdown as its top-level blocks, read with marked's lexer: what
// components/Markdown.tsx draws, and what lets a streaming reply settle block
// by block. Every block but the last of a reply still being written can no
// longer change, because text is only ever appended: a later line starts a new
// block, it does not reach back into one that a blank line or a new block's
// start already closed. So the thread writes those blocks to the terminal's
// history once and keeps only the last one live.
//
// Trade-offs:
//   - The lexer runs over the whole text at each update, so a reference-style
//     link resolves when its definition is in the text; one defined after the
//     block that uses it settled draws as its text alone.
//   - Spacing and link definitions are not blocks: they draw nothing.
//
// Proven by __tests__/markdown.test.tsx.

import { Lexer, type Token } from "marked";

/** The kinds of top-level token that draw nothing. */
const NOT_DRAWN: ReadonlySet<string> = new Set(["space", "def"]);

/** The top-level blocks of a markdown text, in order: what draws, spacing and link definitions left out. */
export function markdownBlocks(text: string): readonly Token[] {
  if (text.trim() === "") return [];
  return Lexer.lex(text).filter((token) => !NOT_DRAWN.has(token.type));
}

/**
 * How many of a text's blocks can no longer change: all of them once the text
 * is complete, every one but the last while it is still being written.
 */
export function settledBlockCount(blockCount: number, writing: boolean): number {
  return writing ? Math.max(0, blockCount - 1) : blockCount;
}
