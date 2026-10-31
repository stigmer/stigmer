// The kit's one text field, over the shared editing model (input/): one line
// for the deny reason and a picker's search, or several for the composer,
// which grows to `maxRows` and then scrolls within itself, keeping the cursor's
// row in view. The cursor is drawn in inverse, and the terminal's own cursor
// is placed on it (`useCursor`), so an input method composes where the person
// types. A bracketed paste arrives whole (`usePaste`): the owner may take it
// (the composer collapses a large one), or it goes in as typed.
import React, { useRef } from "react";
import { Box, Text, useCursor, useInput, usePaste, type DOMElement, type Key } from "ink";
import { keyAction } from "../input/keymap.js";
import { cursorPosition, insertText, rowsOf, type TextBuffer } from "../input/text-buffer.js";

/** Props for {@link TextField}. */
export interface TextFieldProps {
  /** The text and cursor. */
  readonly value: TextBuffer;
  /** Called with each edit. */
  readonly onChange: (value: TextBuffer) => void;
  /** Called on Enter (without a new-line chord), with the text as sent. */
  readonly onSubmit: (value: TextBuffer) => void;
  /** Called when Up or Down has no row to move to: the composer walks its history. */
  readonly onHistory?: (direction: "back" | "forward") => void;
  /** Called with a bracketed paste instead of inserting it. */
  readonly onPaste?: (text: string) => void;
  /** Sees each key first; returning true keeps the field from acting on it (an open menu's arrows). */
  readonly intercept?: (input: string, key: Key) => boolean;
  /** Whether the field reads keys and shows its cursor. Defaults to `true`. */
  readonly focus?: boolean;
  /** Whether it takes several lines. Defaults to `false`. */
  readonly multiline?: boolean;
  /** Text that edits as one character (a collapsed paste's label). */
  readonly atoms?: readonly string[];
  /** Shown dim while the field is empty. */
  readonly placeholder?: string;
  /** The most rows shown before it scrolls; 8 by default. */
  readonly maxRows?: number;
}

/** Where a laid-out element sits in Ink's frame, summed up its ancestors. */
function framePosition(node: DOMElement | null): { readonly x: number; readonly y: number } | undefined {
  let x = 0;
  let y = 0;
  let current: DOMElement | undefined = node ?? undefined;
  while (current?.yogaNode !== undefined) {
    x += current.yogaNode.getComputedLeft();
    y += current.yogaNode.getComputedTop();
    current = current.parentNode;
  }
  return node === null ? undefined : { x, y };
}

/** A text field (module header). */
export function TextField({
  value,
  onChange,
  onSubmit,
  onHistory,
  onPaste,
  intercept,
  focus = true,
  multiline = false,
  atoms,
  placeholder = "",
  maxRows = 8,
}: TextFieldProps) {
  const box = useRef<DOMElement>(null);

  useInput(
    (input, key) => {
      if (intercept?.(input, key) === true) return;
      const action = keyAction(input, key, value, { multiline, atoms });
      if (action.type === "edit") onChange(action.buffer);
      else if (action.type === "submit") {
        if (action.buffer !== undefined) onChange(action.buffer);
        onSubmit(action.buffer ?? value);
      }
      else if (action.type === "history") onHistory?.(action.direction);
    },
    { isActive: focus },
  );

  usePaste(
    (text) => {
      if (onPaste !== undefined) onPaste(text);
      else onChange(insertText(value, multiline ? text.replace(/\r\n?/g, "\n") : text.replace(/[\r\n]+/g, " ")));
    },
    { isActive: focus },
  );

  const rows = rowsOf(value);
  const { row, column } = cursorPosition(value);
  const top = row < maxRows ? 0 : row - maxRows + 1;
  const shown = rows.slice(top, top + maxRows);

  // The terminal cursor on the drawn one, from the frame's last layout: the
  // field moves only when what is above it changes. Only a focused field
  // places it, so a field without focus never hides another's.
  const at = focus ? framePosition(box.current) : undefined;
  const cursor = focus ? (
    <TerminalCursor position={at === undefined ? undefined : { x: at.x + [...(rows[row] ?? "").slice(0, column)].length, y: at.y + row - top }} />
  ) : null;

  if (value.text === "") {
    return (
      <Box ref={box}>
        {cursor}
        {focus ? <Text inverse>{placeholder.slice(0, 1) || " "}</Text> : null}
        <Text dimColor>{focus ? placeholder.slice(1) : placeholder}</Text>
      </Box>
    );
  }

  return (
    <Box ref={box} flexDirection="column">
      {cursor}
      {shown.map((line, index) => {
        const lineRow = top + index;
        if (!focus || lineRow !== row) return <Text key={lineRow}>{line === "" ? " " : line}</Text>;
        return (
          <Text key={lineRow}>
            {line.slice(0, column)}
            <Text inverse>{line[column] ?? " "}</Text>
            {line.slice(column + 1)}
          </Text>
        );
      })}
    </Box>
  );
}

/** Places the terminal's cursor at `position` (hidden when undefined) while it is mounted. */
function TerminalCursor({ position }: { readonly position: { readonly x: number; readonly y: number } | undefined }): null {
  const { setCursorPosition } = useCursor();
  setCursorPosition(position);
  return null;
}
