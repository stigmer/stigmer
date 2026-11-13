"use client";

// The backend a person last picked on the "In your app" tab, remembered in
// this browser, so every agent's tab opens on their stack. One choice for
// every organization: a person's backend is theirs, not an organization's.
// A per-viewer convenience and nothing more, the shape of the journey's
// hidden card (`journey/journeyHidden.ts`): it lives in `localStorage`,
// never reaches the server, and any failure (a private window, blocked
// storage, a value another version wrote) reads as the first stack and
// writes nothing.

import { useCallback, useState } from "react";
import { APP_HANDOVER_STACKS, type AppHandoverStack } from "@stigmer/client";

/** The `localStorage` key. */
export const APP_STACK_STORAGE_KEY = "stigmer:in-app:stack:v1";

const FIRST: AppHandoverStack = APP_HANDOVER_STACKS[0]?.id ?? "nextjs";

/** The stack remembered in this browser; the first one when none or unreadable. */
export function readRememberedStack(): AppHandoverStack {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(APP_STACK_STORAGE_KEY);
  } catch {
    return FIRST;
  }
  return APP_HANDOVER_STACKS.find((stack) => stack.id === raw)?.id ?? FIRST;
}

/** Remember `stack`; a failure writes nothing. */
export function rememberStack(stack: AppHandoverStack): void {
  try {
    window.localStorage.setItem(APP_STACK_STORAGE_KEY, stack);
  } catch {
    // Storage unavailable or full: the pick holds for this visit only.
  }
}

/** The stack to show, and the act that picks another. */
export function useRememberedStack(): readonly [AppHandoverStack, (stack: AppHandoverStack) => void] {
  const [stack, setStack] = useState<AppHandoverStack>(readRememberedStack);
  const pick = useCallback((next: AppHandoverStack) => {
    rememberStack(next);
    setStack(next);
  }, []);
  return [stack, pick] as const;
}
