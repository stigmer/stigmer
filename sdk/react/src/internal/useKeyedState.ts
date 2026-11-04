"use client";

/**
 * State that belongs to one key: a conversation's choices on a page that
 * stays mounted while the person moves between conversations.
 *
 * A host keeps the session viewer mounted across conversations (no
 * `key={id}` remount), so a plain `useState` holding a per-conversation
 * choice (the agent picked, "approve all") would carry it into the next
 * conversation (stigmer/stigmer#2760). Declaring the slot keyed makes the
 * scoping part of the declaration instead of a reset list someone must
 * remember to extend:
 *
 * - the render that carries a new key already reads `initial`, so no frame
 *   shows the previous key's value under the new one;
 * - the held slot is re-tagged to the new key, as a new visit, by a
 *   render-phase update (React's "adjust state when a prop changes"
 *   pattern: the component re-runs before the commit, with no extra commit
 *   or paint);
 * - a setter writes only during the visit it was created in, so a late
 *   write from a callback made for an earlier visit (an awaited path
 *   resolving after the switch) is dropped: never shown on the new key,
 *   and never landing on a later return to the old one. Each visit to a
 *   key starts from `initial`.
 *
 * The setter takes a value, not an updater, and keeps its identity while
 * the key holds (a callback naming it in its deps changes only when the
 * key does). Not to be confused with `useKeyedSubmission` in the core kit,
 * which tracks several concurrent operations by key; this holds one value
 * for whichever key is current.
 *
 * Pinned by `__tests__/useKeyedState.test.ts`.
 *
 * @internal Not part of the public API.
 */

import { useCallback, useState } from "react";

/** The value, the key it was written under, and which visit to that key. */
interface Held<T> {
  readonly key: string;
  /** Counts key changes, so a return to a key is a visit of its own. */
  readonly visit: number;
  readonly value: T;
}

/**
 * `useState` scoped to `key`: `initial` whenever the key is not the one the
 * value was written under. See the module header.
 */
export function useKeyedState<T>(key: string, initial: T): readonly [T, (value: T) => void] {
  const [held, setHeld] = useState<Held<T>>(() => ({ key, visit: 0, value: initial }));
  const current = held.key === key;
  // The visit this render belongs to: the held one, or the next one when
  // the key has just changed (the re-tag below commits it).
  const visit = current ? held.visit : held.visit + 1;
  if (!current) setHeld({ key, visit, value: initial });
  const value = current ? held.value : initial;

  const set = useCallback(
    (next: T) =>
      setHeld((prev) => (prev.key === key && prev.visit === visit ? { key, visit, value: next } : prev)),
    [key, visit],
  );
  return [value, set] as const;
}
