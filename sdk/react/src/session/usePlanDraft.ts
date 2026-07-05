"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { SessionPlan } from "../library/detect-plan-artifact.js";

/**
 * Identity of a plan for draft scoping: the execution that published it plus
 * the artifact's content hash. A refined plan (new execution) or a republished
 * plan (same key, new hash) produces a NEW identity, which orphans any draft
 * of the previous plan — a draft of plan N must never silently ride along
 * once plan N+1 exists.
 */
export function planDraftKey(plan: SessionPlan): string {
  return `${plan.executionId}:${plan.artifact.contentHash}`;
}

/** Controller returned by {@link usePlanDraft}. */
export interface PlanDraftController {
  /**
   * The user's in-place edit of the current plan, or `null` when the plan is
   * unedited. Always scoped to the CURRENT plan — a draft made against a
   * superseded plan reads as `null` here (it is dropped, never migrated).
   */
  readonly draftText: string | null;
  /** True when the current plan has an active draft. */
  readonly isEdited: boolean;
  /**
   * Set (or update) the draft for the current plan. Pass `null` to revert to
   * the published plan. No-ops when the session has no plan.
   */
  readonly setDraft: (text: string | null) => void;
  /**
   * Snapshot reader for submit-time consumers: returns the current draft (or
   * `null`) without the caller depending on draft state. Referentially stable
   * for the lifetime of the component (DD-010) — the "Build" action reads the
   * draft through this at click time, so per-keystroke draft updates never
   * re-bind the build callback or re-render the conversation column.
   */
  readonly readDraft: () => string | null;
}

interface DraftState {
  readonly key: string;
  readonly text: string;
}

/**
 * Owns the local draft of the session's current plan (Phase: refine before
 * build). The draft is a client-side overlay — the published `plan.md`
 * artifact is immutable and is never written back (edit-as-input, not
 * artifact mutation). The approved plan (draft if edited, else the artifact
 * text) is delivered to the implement execution as an attachment.
 *
 * Ownership lives at the viewer level, NOT inside the plan document tab's
 * editor: the panel subtree unmounts wholesale on collapse (and the editor
 * remounts per plan identity), so editor-local state would be destroyed by
 * every collapse or tab switch — silently losing the user's edits.
 *
 * Supersession is derived, not synchronized: the draft is stored with the
 * plan identity it was made against ({@link planDraftKey}), and reads resolve
 * against the CURRENT plan's identity. When a newer plan arrives the old
 * draft simply stops matching — no effect, no cleanup, no stale-flush race.
 */
export function usePlanDraft(
  plan: SessionPlan | undefined,
): PlanDraftController {
  const [draft, setDraftState] = useState<DraftState | null>(null);

  const currentKey = plan ? planDraftKey(plan) : null;
  const draftText =
    draft !== null && currentKey !== null && draft.key === currentKey
      ? draft.text
      : null;

  // Render-synced mirrors so `readDraft` stays referentially stable while
  // always observing the latest draft/plan (the useSessionPanel viewRef
  // pattern).
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const currentKeyRef = useRef(currentKey);
  currentKeyRef.current = currentKey;

  const setDraft = useCallback(
    (text: string | null) => {
      const key = currentKeyRef.current;
      if (!key) return;
      setDraftState(text === null ? null : { key, text });
    },
    [],
  );

  const readDraft = useCallback((): string | null => {
    const current = draftRef.current;
    const key = currentKeyRef.current;
    return current !== null && key !== null && current.key === key
      ? current.text
      : null;
  }, []);

  return useMemo(
    () => ({
      draftText,
      isEdited: draftText !== null,
      setDraft,
      readDraft,
    }),
    [draftText, setDraft, readDraft],
  );
}
