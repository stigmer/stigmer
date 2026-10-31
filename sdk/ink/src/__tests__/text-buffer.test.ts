// Pins the kit's one editing model (input/text-buffer.ts) and what each key
// does to it (input/keymap.ts): new lines by `\`+Enter, Ctrl+J, Alt+Enter and
// Shift+Enter in a multi-line field and none in a one-line field, readline's
// common keys, rows before history, atoms edited whole, and the session's own
// keys passed through.
import { describe, expect, it } from "vitest";
import type { Key } from "ink";
import { keyAction } from "../input/keymap.js";
import {
  EMPTY_BUFFER,
  bufferOf,
  cursorPosition,
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
  rowsOf,
} from "../input/text-buffer.js";

/** Ink's reading of a key, every flag off but those given. */
function key(flags: Partial<Key> = {}): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...flags,
  };
}

/** "text|more" as a buffer, the bar marking the cursor. */
function at(marked: string) {
  const cursor = marked.indexOf("|");
  return bufferOf(marked.slice(0, cursor) + marked.slice(cursor + 1), cursor);
}

/** A buffer written back as "text|more". */
function shown(buffer: { text: string; cursor: number }): string {
  return `${buffer.text.slice(0, buffer.cursor)}|${buffer.text.slice(buffer.cursor)}`;
}

const MULTI = { multiline: true } as const;
const SINGLE = { multiline: false } as const;

describe("the text buffer", () => {
  it("inserts and deletes at the cursor, and does nothing past either end", () => {
    expect(shown(insertText(at("ab|cd"), "XY"))).toBe("abXY|cd");
    expect(shown(deleteBack(at("ab|cd"), []))).toBe("a|cd");
    expect(shown(deleteForward(at("ab|cd"), []))).toBe("ab|d");
    expect(deleteBack(at("|ab"), [])).toEqual(at("|ab"));
    expect(deleteForward(at("ab|"), [])).toEqual(at("ab|"));
    expect(bufferOf("abc", 9)).toEqual({ text: "abc", cursor: 3 });
    expect(bufferOf("abc", -1)).toEqual({ text: "abc", cursor: 0 });
    expect(EMPTY_BUFFER).toEqual({ text: "", cursor: 0 });
  });

  it("removes an atom whole, from either side", () => {
    const label = "[Pasted text #1 +4 lines]";
    expect(shown(deleteBack(at(`see ${label}|!`), [label]))).toBe("see |!");
    expect(shown(deleteForward(at(`see |${label}!`), [label]))).toBe("see |!");
    expect(shown(deleteBack(at(`see ${label}x|`), [label]))).toBe(`see ${label}|`);
    expect(shown(deleteBack(at("ab|"), [""]))).toBe("a|");
    expect(shown(deleteForward(at("a|b"), [""]))).toBe("a|");
    // An atom elsewhere in the text is not the one at the cursor.
    expect(shown(deleteForward(at("x|y[P]"), ["[P]"]))).toBe("x|[P]");
    expect(shown(deleteBack(at("[P]y|"), ["[P]"]))).toBe("[P]|");
  });

  it("moves by character, by row end and by word", () => {
    expect(shown(moveLeft(at("ab|")))).toBe("a|b");
    expect(shown(moveLeft(at("|ab")))).toBe("|ab");
    expect(shown(moveRight(at("a|b")))).toBe("ab|");
    expect(moveRight(at("ab|")).cursor).toBe(2);
    expect(shown(moveRowStart(at("one\ntw|o")))).toBe("one\n|two");
    expect(shown(moveRowEnd(at("o|ne\ntwo")))).toBe("one|\ntwo");
    expect(shown(moveRowStart(at("on|e")))).toBe("|one");
    expect(shown(moveRowEnd(at("on|e")))).toBe("one|");
    expect(shown(moveWordLeft(at("fix the  bil|ling")))).toBe("fix the  |billing");
    expect(shown(moveWordLeft(at("fix the  |billing")))).toBe("fix |the  billing");
    expect(shown(moveWordRight(at("fix| the billing")))).toBe("fix the| billing");
    expect(shown(moveWordRight(at("fix the bill|")))).toBe("fix the bill|");
    // At either end of the text the cursor stays inside it.
    expect(moveWordLeft(at("one|")).cursor).toBe(0);
    expect(moveWordLeft(at("  |")).cursor).toBe(0);
    expect(moveWordRight(at("|one")).cursor).toBe(3);
    expect(moveWordRight(at("|  ")).cursor).toBe(2);
    expect(killWordBack(at("one|")).cursor).toBe(0);
  });

  it("kills to the row's start, to its end, and the word before", () => {
    expect(shown(killToRowStart(at("one\ntw|o")))).toBe("one\n|o");
    expect(shown(killToRowEnd(at("o|ne\ntwo")))).toBe("o|\ntwo");
    expect(shown(killWordBack(at("fix the bill  |x")))).toBe("fix the |x");
  });

  it("moves between rows at the same column where the row allows, and says when there is none", () => {
    expect(shown(moveUp(at("short\nlonger lin|e"))!)).toBe("short|\nlonger line");
    expect(shown(moveDown(at("a|bc\nd"))!)).toBe("abc\nd|");
    expect(shown(moveDown(at("ab|c\nlonger"))!)).toBe("abc\nlo|nger");
    expect(moveUp(at("on|e\ntwo"))).toBeUndefined();
    expect(moveDown(at("one\ntw|o"))).toBeUndefined();
    expect(cursorPosition(at("one\ntw|o"))).toEqual({ row: 1, column: 2 });
    expect(rowsOf(at("a\n\nb|"))).toEqual(["a", "", "b"]);
  });
});

describe("INK-08 the composer takes several lines, paste, and history", () => {
  it("starts a new line on \\ then Enter, Ctrl+J, Alt+Enter and Shift+Enter, and sends on Enter", () => {
    expect(keyAction("\r", key({ return: true }), at("only the tests\\|"), MULTI)).toEqual({ type: "edit", buffer: at("only the tests\n|") });
    expect(keyAction("\n", key(), at("a|"), MULTI)).toEqual({ type: "edit", buffer: at("a\n|") });
    expect(keyAction("\r", key({ return: true, meta: true }), at("a|"), MULTI)).toEqual({ type: "edit", buffer: at("a\n|") });
    expect(keyAction("\r", key({ return: true, shift: true }), at("a|"), MULTI)).toEqual({ type: "edit", buffer: at("a\n|") });
    expect(keyAction("\r", key({ return: true }), at("a|"), MULTI)).toEqual({ type: "submit" });
  });

  it("reads Enter at the end of text typed in one read as sending it, and a carriage return inside as a new line", () => {
    expect(keyAction("and keep it small\r", key(), at("only the tests\n|"), MULTI)).toEqual({ type: "submit", buffer: at("only the tests\nand keep it small|") });
    expect(keyAction("ok\r", key(), at("|"), SINGLE)).toEqual({ type: "submit", buffer: at("ok|") });
    expect(keyAction("a\rb", key(), at("|"), MULTI)).toEqual({ type: "edit", buffer: at("a\nb|") });
  });

  it("takes no new line in a one-line field, and sends on Enter even after a backslash", () => {
    expect(keyAction("\n", key(), at("a|"), SINGLE)).toEqual({ type: "none" });
    expect(keyAction("\r", key({ return: true, meta: true }), at("a|"), SINGLE)).toEqual({ type: "none" });
    expect(keyAction("\r", key({ return: true }), at("a\\|"), SINGLE)).toEqual({ type: "submit" });
    expect(keyAction("x\ny", key(), at("a|"), SINGLE)).toEqual({ type: "edit", buffer: at("ax y|") });
  });

  it("moves between rows, then steps through history from the first or last row", () => {
    expect(keyAction("", key({ upArrow: true }), at("a\nb|"), MULTI)).toEqual({ type: "edit", buffer: at("a|\nb") });
    expect(keyAction("", key({ upArrow: true }), at("a|\nb"), MULTI)).toEqual({ type: "history", direction: "back" });
    expect(keyAction("", key({ downArrow: true }), at("a|\nb"), MULTI)).toEqual({ type: "edit", buffer: at("a\nb|") });
    expect(keyAction("", key({ downArrow: true }), at("a\nb|"), MULTI)).toEqual({ type: "history", direction: "forward" });
    expect(keyAction("", key({ upArrow: true }), at("a|"), SINGLE)).toEqual({ type: "history", direction: "back" });
    expect(keyAction("", key({ downArrow: true }), at("a|"), SINGLE)).toEqual({ type: "history", direction: "forward" });
  });

  it("edits with readline's common keys", () => {
    const edited = (input: string, flags: Partial<Key>, marked: string, atoms?: readonly string[]) => {
      const action = keyAction(input, key(flags), at(marked), { multiline: true, atoms });
      return action.type === "edit" ? shown(action.buffer) : action.type;
    };
    expect(edited("", { backspace: true }, "ab|")).toBe("a|");
    expect(edited("", { delete: true }, "a|b")).toBe("a|");
    expect(edited("", { backspace: true }, "x[P]|", ["[P]"])).toBe("x|");
    expect(edited("", { delete: true }, "x|[P]", ["[P]"])).toBe("x|");
    expect(edited("", { leftArrow: true }, "ab|")).toBe("a|b");
    expect(edited("", { rightArrow: true }, "|ab")).toBe("a|b");
    expect(edited("", { leftArrow: true, meta: true }, "one two|")).toBe("one |two");
    expect(edited("", { rightArrow: true, ctrl: true }, "|one two")).toBe("one| two");
    expect(edited("", { leftArrow: true, ctrl: true }, "one two|")).toBe("one |two");
    expect(edited("", { rightArrow: true, meta: true }, "|one two")).toBe("one| two");
    expect(edited("", { home: true }, "ab|")).toBe("|ab");
    expect(edited("", { end: true }, "|ab")).toBe("ab|");
    expect(edited("a", { ctrl: true }, "ab|")).toBe("|ab");
    expect(edited("e", { ctrl: true }, "|ab")).toBe("ab|");
    expect(edited("u", { ctrl: true }, "ab|c")).toBe("|c");
    expect(edited("k", { ctrl: true }, "a|bc")).toBe("a|");
    expect(edited("w", { ctrl: true }, "one two|")).toBe("one |");
    expect(edited("b", { meta: true }, "one two|")).toBe("one |two");
    expect(edited("f", { meta: true }, "|one two")).toBe("one| two");
    expect(edited("é", {}, "caf|")).toBe("café|");
    expect(edited("x\r\ny", {}, "|")).toBe("x\ny|");
  });

  it("leaves the session's keys and unknown chords to their owners", () => {
    for (const [input, flags] of [
      ["", { escape: true }],
      ["", { tab: true }],
      ["", { tab: true, shift: true }],
      ["c", { ctrl: true }],
      ["o", { ctrl: true }],
      ["t", { ctrl: true }],
      ["x", { meta: true }],
      ["", { pageUp: true }],
      ["", { pageDown: true }],
      ["", {}],
      ["\n", { ctrl: true }],
    ] as const) {
      expect(keyAction(input, key(flags), at("ab|"), MULTI)).toEqual({ type: "none" });
    }
  });
});
