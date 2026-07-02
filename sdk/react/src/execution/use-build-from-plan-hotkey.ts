"use client";

import { useCallback, type KeyboardEvent } from "react";

/**
 * Card-scoped `Cmd/Ctrl+Enter` accelerator for the "Build from plan" action.
 *
 * Returns an `onKeyDown` handler for a plan card's root element. Because it is
 * attached to the card (not `window`), it fires only when the keystroke
 * originates from within the card — so the SDK never installs a global listener
 * that could hijack a host application's keyboard shortcuts (an embeddable-a11y
 * requirement). The card's primary button stays natively activatable with
 * Enter/Space when focused; this adds the power-user accelerator on top.
 *
 * No-op when there is no action wired or the action is disabled.
 *
 * Shared by {@link PlanArtifactCard} and {@link PlanCompletionCard} so the
 * accelerator's behavior lives in exactly one place and cannot drift between
 * the two cards.
 */
export function useBuildFromPlanHotkey(
  onImplement: (() => void) | undefined,
  disabled: boolean | undefined,
): (event: KeyboardEvent<HTMLElement>) => void {
  return useCallback(
    (event) => {
      if (
        onImplement &&
        !disabled &&
        event.key === "Enter" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        onImplement();
      }
    },
    [onImplement, disabled],
  );
}
