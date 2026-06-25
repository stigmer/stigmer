"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Disclosure state machine for progressively-revealed thread sections
 * (tool-call groups, individual tool rows, sub-agent cards).
 *
 * The challenge it solves: a section should open and close *on its own* as
 * the agent works (open while a tool runs, settle closed when it finishes),
 * yet a user's explicit click must win and never be stomped by the next
 * stream frame. Three components hand-rolled this same "auto unless the user
 * intervened" logic; this hook is the single source of that shape.
 *
 * `autoOpen` is the component's live opinion of whether the section *should*
 * be open right now (e.g. `isRunning || hasPendingApproval`). While the user
 * has not toggled, `open` tracks `autoOpen`. Once the user toggles, their
 * choice sticks for the lifetime of the component — the auto signal is
 * ignored from then on, so the section never reopens or recollapses under
 * them mid-stream.
 *
 * @param autoOpen Whether the section should auto-open given current state.
 * @param options.initialOpen First-render open state. Defaults to `autoOpen`.
 *   Use it to honour a caller-provided `defaultExpanded` before the first
 *   effect runs.
 * @returns A `[open, toggle]` tuple. `toggle` flips the state and marks it
 *   user-controlled.
 *
 * @example
 * ```tsx
 * const [open, toggle] = useAutoDisclosure(isRunning || hasPendingApproval);
 * <button aria-expanded={open} onClick={toggle}>…</button>
 * ```
 */
export function useAutoDisclosure(
  autoOpen: boolean,
  options?: { readonly initialOpen?: boolean },
): readonly [open: boolean, toggle: () => void] {
  const [open, setOpen] = useState(options?.initialOpen ?? autoOpen);
  const userToggledRef = useRef(false);
  const prevAutoOpenRef = useRef(autoOpen);

  useEffect(() => {
    // Sync only on a genuine transition of the auto signal — never on mount,
    // so `initialOpen` is honoured, and never against the user's choice.
    if (prevAutoOpenRef.current === autoOpen) return;
    prevAutoOpenRef.current = autoOpen;
    if (userToggledRef.current) return;
    setOpen(autoOpen);
  }, [autoOpen]);

  const toggle = useRef(() => {
    userToggledRef.current = true;
    setOpen((v) => !v);
  }).current;

  return [open, toggle];
}
