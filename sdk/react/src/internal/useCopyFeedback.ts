"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** How long the transient `copied` flag stays true after a successful copy. */
const COPIED_FEEDBACK_MS = 2000;

/** Return value of {@link useCopyFeedback}. */
export interface UseCopyFeedbackReturn {
  /**
   * Write `text` to the clipboard. Resolves `true` when the write landed and
   * `false` when it was rejected (insecure context, denied permission); a
   * rejected write leaves `copied` false so the affordance never claims a
   * copy that didn't happen. Callers with a manual fallback (e.g. selecting
   * the on-screen text for a hand copy) branch on the result; plain
   * affordances can ignore it.
   */
  readonly copy: (text: string) => Promise<boolean>;

  /**
   * `true` for a brief window after a successful copy (drives "Copied"
   * affordance feedback), then resets automatically.
   */
  readonly copied: boolean;
}

/**
 * Behavior hook for the copy-with-feedback shape: write locally-held text to
 * the clipboard and flash a transient `copied` flag for the affordance swap.
 *
 * This is the fetch-free sibling of `useArtifactCopy` (which resolves remote
 * artifact bytes at click time); use it wherever the text to copy is already
 * in hand — message content, identifiers, code blocks. One implementation
 * keeps the feedback window and the unmount-safety identical across surfaces.
 */
export function useCopyFeedback(): UseCopyFeedbackReturn {
  const [copied, setCopied] = useState(false);

  // Clear the pending "copied" timer on unmount so a resolved copy never sets
  // state on an unmounted component.
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    };
  }, []);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return false;
    }
    setCopied(true);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return true;
  }, []);

  return useMemo(() => ({ copy, copied }), [copy, copied]);
}
