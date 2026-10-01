"use client";

/**
 * The draft, focus and caret contract shared by the click-to-edit text
 * editors (`InlineEditText`, `InlineEditTextarea`, `InlineEditImage`), kept in
 * one place so the three cannot drift apart. Internal: not exported from the
 * package.
 *
 * - Opening seeds the draft from the stored value and focuses the field in
 *   the commit that shows it, never a frame later, so a selection made right
 *   after opening (select-all, then type) is not collapsed afterwards
 *   (stigmer/stigmer#1575). A layout effect is used rather than a passive one
 *   because, in a browser, a passive effect may run after paint and after the
 *   next input.
 * - An untouched draft follows the stored value, so a save never writes a
 *   stale copy over a change made elsewhere; once the user edits, the draft
 *   is theirs until they save or cancel. The follow is adjusted during render
 *   (the `ResizableSplit` idiom), so the field never shows the stale value.
 */
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import type { RefObject } from "react";

/** Return value of {@link useInlineDraft}. */
export interface UseInlineDraftReturn {
  /** `true` while the field is open for editing. */
  readonly isEditing: boolean;
  /** Open or close the field without reseeding the draft. */
  readonly setIsEditing: (editing: boolean) => void;
  /** The text in the field. */
  readonly draft: string;
  /** Replace the text in the field (the user typed, or a control reset it). */
  readonly setDraft: (draft: string) => void;
  /** Open the field with the draft seeded from the stored value. */
  readonly startEditing: () => void;
}

/**
 * Holds an inline editor's open state and draft, and places focus when the
 * field opens (the contract in this module's header).
 *
 * @param value - The stored value.
 * @param fieldRef - The input or textarea shown while editing.
 * @param options.caretAtEnd - Place the caret after the text on opening.
 */
export function useInlineDraft(
  value: string,
  fieldRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  options?: { readonly caretAtEnd?: boolean },
): UseInlineDraftReturn {
  const caretAtEnd = options?.caretAtEnd ?? false;
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // The stored value the draft was last seeded from.
  const [seed, setSeed] = useState(value);

  // An untouched draft follows the stored value (see the module header).
  if (value !== seed) {
    setSeed(value);
    if (draft === seed) setDraft(value);
  }

  const startEditing = useCallback(() => {
    setDraft(value);
    setSeed(value);
    setIsEditing(true);
  }, [value]);

  // A layout effect, not a frame later: focus (and the caret) land in the
  // commit that shows the field, before the browser handles the next input.
  useLayoutEffect(() => {
    if (!isEditing) return;
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    if (caretAtEnd) {
      const end = field.value.length;
      field.setSelectionRange(end, end);
    }
  }, [isEditing, fieldRef, caretAtEnd]);

  return useMemo(
    () => ({ isEditing, setIsEditing, draft, setDraft, startEditing }),
    [isEditing, draft, startEditing],
  );
}
