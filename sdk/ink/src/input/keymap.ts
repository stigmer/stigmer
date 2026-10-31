// What a key does to a text field, from Ink's reading of it: an edit of the
// buffer, sending, a step through history, or nothing the field owns.
//
// - Enter sends. A new line comes from `\` then Enter (the backslash is
//   replaced), Ctrl+J, Alt+Enter, or Shift+Enter where the terminal reports it
//   (the kitty keyboard protocol). A one-line field takes none of them.
// - Readline's common keys: arrows, Home/End and Ctrl+A/E, Alt+arrows and
//   Alt+B/F by word, Backspace/Delete, Ctrl+U/K/W.
// - Up and Down move between rows, then step through history from the first
//   or last row.
// - Keys the session owns (Esc, Ctrl+C, Tab, Ctrl+O, Ctrl+T) and any other
//   Ctrl or Alt chord are ignored, so they reach their owner.
//
// Proven by __tests__/text-buffer.test.ts.

import type { Key } from "ink";
import {
  deleteBack,
  deleteForward,
  insertText,
  killToRowEnd,
  killToRowStart,
  killWordBack,
  moveDown,
  moveLeft,
  moveRight,
  moveRowEnd,
  moveRowStart,
  moveUp,
  moveWordLeft,
  moveWordRight,
  type TextBuffer,
} from "./text-buffer.js";

/** What a key does to a field. */
export type KeyAction =
  | { readonly type: "edit"; readonly buffer: TextBuffer }
  | { readonly type: "submit" }
  | { readonly type: "history"; readonly direction: "back" | "forward" }
  | { readonly type: "none" };

/** How a field reads keys. */
export interface KeymapOptions {
  /** Whether the field takes new lines and moves between rows. */
  readonly multiline: boolean;
  /** Text that edits as one character (a collapsed paste's label). */
  readonly atoms?: readonly string[];
}

const NONE: KeyAction = { type: "none" };

function edit(buffer: TextBuffer): KeyAction {
  return { type: "edit", buffer };
}

/** What `input` with `key` does to `buffer` (module header). */
export function keyAction(input: string, key: Key, buffer: TextBuffer, options: KeymapOptions): KeyAction {
  const { multiline, atoms = [] } = options;
  if (key.return) {
    const newline = key.meta || key.shift;
    if (newline) return multiline ? edit(insertText(buffer, "\n")) : NONE;
    if (multiline && buffer.text[buffer.cursor - 1] === "\\") {
      return edit(insertText(deleteBack(buffer), "\n"));
    }
    return { type: "submit" };
  }
  if (input === "\n" && !key.ctrl && !key.meta) return multiline ? edit(insertText(buffer, "\n")) : NONE;
  if (key.escape || key.tab) return NONE;
  if (key.backspace) return edit(deleteBack(buffer, atoms));
  if (key.delete) return edit(deleteForward(buffer, atoms));
  if (key.leftArrow) return edit(key.meta || key.ctrl ? moveWordLeft(buffer) : moveLeft(buffer));
  if (key.rightArrow) return edit(key.meta || key.ctrl ? moveWordRight(buffer) : moveRight(buffer));
  if (key.home) return edit(moveRowStart(buffer));
  if (key.end) return edit(moveRowEnd(buffer));
  if (key.upArrow) {
    const moved = multiline ? moveUp(buffer) : undefined;
    return moved === undefined ? { type: "history", direction: "back" } : edit(moved);
  }
  if (key.downArrow) {
    const moved = multiline ? moveDown(buffer) : undefined;
    return moved === undefined ? { type: "history", direction: "forward" } : edit(moved);
  }
  if (key.ctrl) {
    switch (input) {
      case "a":
        return edit(moveRowStart(buffer));
      case "e":
        return edit(moveRowEnd(buffer));
      case "u":
        return edit(killToRowStart(buffer));
      case "k":
        return edit(killToRowEnd(buffer));
      case "w":
        return edit(killWordBack(buffer));
      default:
        return NONE;
    }
  }
  if (key.meta) {
    if (input === "b") return edit(moveWordLeft(buffer));
    if (input === "f") return edit(moveWordRight(buffer));
    return NONE;
  }
  if (input === "" || key.pageUp || key.pageDown) return NONE;
  // Typed text, or a paste the terminal did not mark arriving as one chunk.
  const text = input.replace(/\r\n?/g, "\n");
  return edit(insertText(buffer, multiline ? text : text.replace(/\n/g, " ")));
}
