"use client";

// What a settings page about an organization shows before one is active:
// the shared first-use empty state, in the same words on every page, so a
// person who has not chosen an organization is told what to do rather than
// shown an empty list.

import { EmptyState } from "../empty-state/EmptyState.js";

/** What an empty list tells a person who may not add to it: who can. */
export const ASK_AN_ADMIN = "Ask one of them if this organization needs one.";

/** The prompt a settings page shows when no organization is active; `what` is what the page would show ("its members"). */
export function NoOrganization({ what }: { readonly what: string }) {
  return (
    <EmptyState
      variant="first-use"
      title="No organization selected"
      description={`Choose an organization to see ${what}.`}
    />
  );
}
