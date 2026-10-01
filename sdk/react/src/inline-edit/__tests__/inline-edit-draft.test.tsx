/**
 * The draft and focus contract of the click-to-edit text editors
 * (`InlineEditText`, `InlineEditTextarea`, `InlineEditImage`).
 *
 * Opening an editor seeds its draft from the stored value and puts focus (and,
 * for the textarea, the caret at the end) on the field without waiting a frame.
 * What these tests pin, each a way the editors once lost or overwrote text:
 * - focus is on the field as soon as the click returns, with no frame awaited;
 * - a selection made right after opening survives the next animation frame, so
 *   select-all-then-type replaces the value instead of appending to it
 *   (stigmer/stigmer#1575);
 * - a stored value that changes while the editor is open leaves an edited
 *   draft alone, and an untouched draft follows it, so saving never writes a
 *   stale copy over the change;
 * - cancel and reopen show the latest stored value, and save sends the draft.
 */
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InlineEditImage } from "../InlineEditImage.js";
import { InlineEditText } from "../InlineEditText.js";
import { InlineEditTextarea } from "../InlineEditTextarea.js";

afterEach(cleanup);

interface EditorProps {
  readonly value: string;
  readonly onSave: (newValue: string) => Promise<boolean>;
}

interface EditorCase {
  readonly name: string;
  readonly Editor: ComponentType<EditorProps>;
  /** The read-mode control that opens the editor. */
  readonly openButton: (value: string) => HTMLElement;
  readonly stored: string;
  readonly changed: string;
  readonly typed: string;
}

const EDITORS: readonly EditorCase[] = [
  {
    name: "InlineEditText",
    Editor: InlineEditText,
    openButton: (value) => screen.getByRole("button", { name: value }),
    stored: "Nightly digest",
    changed: "Nightly digest (renamed elsewhere)",
    typed: "Weekly digest",
  },
  {
    name: "InlineEditTextarea",
    Editor: InlineEditTextarea,
    openButton: (value) => screen.getByRole("button", { name: value }),
    stored: "Send today's reminders.",
    changed: "Send tomorrow's reminders.",
    typed: "Send this week's reminders.",
  },
  {
    name: "InlineEditImage",
    Editor: InlineEditImage,
    openButton: () => screen.getByRole("button", { name: "Change icon" }),
    stored: "https://assets.example.com/old.png",
    changed: "https://assets.example.com/elsewhere.png",
    typed: "https://assets.example.com/new.png",
  },
];

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function field(): HTMLInputElement | HTMLTextAreaElement {
  const el = screen.getByRole("textbox");
  if (
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLTextAreaElement)
  ) {
    throw new Error("the editor's field is neither an input nor a textarea");
  }
  return el;
}

describe.each(EDITORS)(
  "$name",
  ({ Editor, openButton, stored, changed, typed }) => {
    function open(value = stored): {
      onSave: ReturnType<typeof vi.fn<(v: string) => Promise<boolean>>>;
      rerender: (value: string) => void;
    } {
      const onSave = vi
        .fn<(v: string) => Promise<boolean>>()
        .mockResolvedValue(true);
      const view = render(<Editor value={value} onSave={onSave} />);
      fireEvent.click(openButton(value));
      return {
        onSave,
        rerender: (next) =>
          view.rerender(<Editor value={next} onSave={onSave} />),
      };
    }

    it("opens with the stored value and focus on the field, with no frame awaited", () => {
      open();

      expect(field().value).toBe(stored);
      expect(document.activeElement).toBe(field());
    });

    it("keeps a selection made right after opening through the next frame", async () => {
      open();
      const el = field();
      el.setSelectionRange(0, el.value.length);

      await nextFrame();

      expect(el.selectionStart).toBe(0);
      expect(el.selectionEnd).toBe(stored.length);
    });

    it("keeps the draft when the stored value changes while the editor is open", () => {
      const { rerender } = open();
      fireEvent.change(field(), { target: { value: typed } });

      rerender(changed);

      expect(field().value).toBe(typed);
    });

    it("lets an untouched draft follow a changed stored value, so save writes nothing stale", async () => {
      const { rerender, onSave } = open();

      rerender(changed);

      expect(field().value).toBe(changed);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await vi.waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
      expect(onSave).not.toHaveBeenCalled();
    });

    it("reopens on the latest stored value after cancel, and saves the draft", async () => {
      const { rerender, onSave } = open();
      fireEvent.change(field(), { target: { value: typed } });
      rerender(changed);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      fireEvent.click(openButton(changed));
      expect(field().value).toBe(changed);

      fireEvent.change(field(), { target: { value: typed } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith(typed));
    });
  },
);

describe("InlineEditTextarea caret", () => {
  it("puts the caret at the end of the stored value when it opens", () => {
    const value = "Send today's reminders.";
    render(
      <InlineEditTextarea
        value={value}
        onSave={vi.fn().mockResolvedValue(true)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: value }));

    expect(field().selectionStart).toBe(value.length);
    expect(field().selectionEnd).toBe(value.length);
  });
});
