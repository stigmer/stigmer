"use client";

// Whether a person hid the journey's card on the dashboard, remembered in
// this browser per organization. A per-viewer convenience and nothing more,
// the same shape as the remembered plugin picks
// (`plugin/rememberedPluginPicks.ts`): the choice lives in `localStorage`,
// never reaches the server or another person, and any failure (a private
// window, blocked storage) reads as "not hidden" and writes nothing, so the
// card shows rather than vanish for a reason nobody chose.

import { useCallback, useState } from "react";

/** The `localStorage` key prefix; the organization's id follows it. */
export const JOURNEY_HIDDEN_STORAGE_KEY = "stigmer:journey:hidden:v1";

function keyFor(org: string): string {
  return `${JOURNEY_HIDDEN_STORAGE_KEY}:${org}`;
}

/** Whether the journey's card is hidden for `org` in this browser; false when unknown. */
export function readJourneyHidden(org: string): boolean {
  if (org === "") return false;
  try {
    return window.localStorage.getItem(keyFor(org)) === "1";
  } catch {
    return false;
  }
}

/** Remember that the journey's card is hidden for `org`; a failure writes nothing. */
export function rememberJourneyHidden(org: string): void {
  if (org === "") return;
  try {
    window.localStorage.setItem(keyFor(org), "1");
  } catch {
    // Storage unavailable or full: the card is hidden for this visit only.
  }
}

/** Whether the card is hidden for `org`, and the act that hides it; each organization reads its own. */
export function useJourneyHidden(org: string): { readonly hidden: boolean; readonly hide: () => void } {
  const [state, setState] = useState(() => ({ org, hidden: readJourneyHidden(org) }));
  // Another organization reads its own choice, during render, so no frame
  // shows the previous organization's.
  if (state.org !== org) setState({ org, hidden: readJourneyHidden(org) });
  const hidden = state.org === org ? state.hidden : readJourneyHidden(org);
  const hide = useCallback(() => {
    rememberJourneyHidden(org);
    setState({ org, hidden: true });
  }, [org]);
  return { hidden, hide };
}
