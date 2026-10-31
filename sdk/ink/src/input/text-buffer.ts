// One editing model for every text field in the terminal kit: a text and a
// cursor, and each edit a function from one buffer to the next, so the
// composer, the deny reason and the picker's search edit alike and every edit
// is a plain test.
//
// - The cursor is an index into the text, 0 to its length.
// - A row is a line of the text; Up and Down keep the column where the row
//   allows, and say when there is no row to move to (the composer then walks
//   its history).
// - A word is a run of characters other than whitespace.
// - An atom is a piece of text that edits as one character: a collapsed
//   paste's label, which Backspace and Delete remove whole.
//
// Proven by __tests__/text-buffer.test.ts.

/** A field's text and where the cursor sits in it. */
export interface TextBuffer {
  readonly text: string;
  /** An index into `text`, from 0 to its length. */
  readonly cursor: number;
}

/** The empty buffer. */
export const EMPTY_BUFFER: TextBuffer = { text: "", cursor: 0 };

/** A buffer holding `text`, the cursor at its end unless given. */
export function bufferOf(text: string, cursor = text.length): TextBuffer {
  return { text, cursor: Math.max(0, Math.min(cursor, text.length)) };
}

/** `insert` typed at the cursor. */
export function insertText(buffer: TextBuffer, insert: string): TextBuffer {
  const { text, cursor } = buffer;
  return { text: text.slice(0, cursor) + insert + text.slice(cursor), cursor: cursor + insert.length };
}

/** Backspace: the character before the cursor, or the whole atom that ends there. */
export function deleteBack(buffer: TextBuffer, atoms: readonly string[] = []): TextBuffer {
  const { text, cursor } = buffer;
  if (cursor === 0) return buffer;
  const atom = atoms.find((candidate) => candidate !== "" && text.slice(0, cursor).endsWith(candidate));
  const length = atom?.length ?? 1;
  return { text: text.slice(0, cursor - length) + text.slice(cursor), cursor: cursor - length };
}

/** Delete: the character after the cursor, or the whole atom that starts there. */
export function deleteForward(buffer: TextBuffer, atoms: readonly string[] = []): TextBuffer {
  const { text, cursor } = buffer;
  if (cursor === text.length) return buffer;
  const atom = atoms.find((candidate) => candidate !== "" && text.startsWith(candidate, cursor));
  return { text: text.slice(0, cursor) + text.slice(cursor + (atom?.length ?? 1)), cursor };
}

/** The cursor one character left. */
export function moveLeft(buffer: TextBuffer): TextBuffer {
  return { ...buffer, cursor: Math.max(0, buffer.cursor - 1) };
}

/** The cursor one character right. */
export function moveRight(buffer: TextBuffer): TextBuffer {
  return { ...buffer, cursor: Math.min(buffer.text.length, buffer.cursor + 1) };
}

/** Where the cursor's row starts. */
function rowStart(text: string, cursor: number): number {
  return text.lastIndexOf("\n", cursor - 1) + 1;
}

/** Where the cursor's row ends. */
function rowEnd(text: string, cursor: number): number {
  const end = text.indexOf("\n", cursor);
  return end === -1 ? text.length : end;
}

/** Home, Ctrl+A: the start of the cursor's row. */
export function moveRowStart(buffer: TextBuffer): TextBuffer {
  return { ...buffer, cursor: rowStart(buffer.text, buffer.cursor) };
}

/** End, Ctrl+E: the end of the cursor's row. */
export function moveRowEnd(buffer: TextBuffer): TextBuffer {
  return { ...buffer, cursor: rowEnd(buffer.text, buffer.cursor) };
}

/** Where the word before the cursor starts, past any whitespace. */
function wordStartBefore(text: string, cursor: number): number {
  let at = cursor;
  while (at > 0 && /\s/.test(text[at - 1]!)) at -= 1;
  while (at > 0 && !/\s/.test(text[at - 1]!)) at -= 1;
  return at;
}

/** Alt+Left: the start of the word before the cursor. */
export function moveWordLeft(buffer: TextBuffer): TextBuffer {
  return { ...buffer, cursor: wordStartBefore(buffer.text, buffer.cursor) };
}

/** Alt+Right: the end of the word after the cursor. */
export function moveWordRight(buffer: TextBuffer): TextBuffer {
  const { text } = buffer;
  let at = buffer.cursor;
  while (at < text.length && /\s/.test(text[at]!)) at += 1;
  while (at < text.length && !/\s/.test(text[at]!)) at += 1;
  return { ...buffer, cursor: at };
}

/** Ctrl+U: everything from the row's start to the cursor. */
export function killToRowStart(buffer: TextBuffer): TextBuffer {
  const start = rowStart(buffer.text, buffer.cursor);
  return { text: buffer.text.slice(0, start) + buffer.text.slice(buffer.cursor), cursor: start };
}

/** Ctrl+K: everything from the cursor to the row's end. */
export function killToRowEnd(buffer: TextBuffer): TextBuffer {
  const end = rowEnd(buffer.text, buffer.cursor);
  return { text: buffer.text.slice(0, buffer.cursor) + buffer.text.slice(end), cursor: buffer.cursor };
}

/** Ctrl+W: the word before the cursor, and the whitespace after it. */
export function killWordBack(buffer: TextBuffer): TextBuffer {
  const start = wordStartBefore(buffer.text, buffer.cursor);
  return { text: buffer.text.slice(0, start) + buffer.text.slice(buffer.cursor), cursor: start };
}

/** The cursor's row and column, from 0. */
export function cursorPosition(buffer: TextBuffer): { readonly row: number; readonly column: number } {
  const before = buffer.text.slice(0, buffer.cursor);
  const row = before.split("\n").length - 1;
  return { row, column: buffer.cursor - rowStart(buffer.text, buffer.cursor) };
}

/** The buffer's rows. */
export function rowsOf(buffer: TextBuffer): readonly string[] {
  return buffer.text.split("\n");
}

/** Up: the same column a row above; undefined on the first row. */
export function moveUp(buffer: TextBuffer): TextBuffer | undefined {
  return moveRow(buffer, -1);
}

/** Down: the same column a row below; undefined on the last row. */
export function moveDown(buffer: TextBuffer): TextBuffer | undefined {
  return moveRow(buffer, 1);
}

function moveRow(buffer: TextBuffer, step: -1 | 1): TextBuffer | undefined {
  const rows = rowsOf(buffer);
  const { row, column } = cursorPosition(buffer);
  const target = row + step;
  if (target < 0 || target >= rows.length) return undefined;
  const start = rows.slice(0, target).reduce((sum, line) => sum + line.length + 1, 0);
  return { ...buffer, cursor: start + Math.min(column, rows[target]!.length) };
}
