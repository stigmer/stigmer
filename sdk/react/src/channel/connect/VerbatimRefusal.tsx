"use client";

import type { ReactNode } from "react";
import { getUserMessage } from "@stigmer/sdk";

/**
 * The plain install-refusal alert: the server's copy rendered verbatim —
 * the server owns that vocabulary. Both connect dialogs fall back to
 * this for any refusal they don't recognize; provider-guided refusals
 * (a known ErrorInfo reason with actionable copy) stay provider-local
 * and reuse {@link RefusalBox} for the chrome.
 */
export function VerbatimRefusal({ error }: { readonly error: Error }) {
  return <RefusalBox>{getUserMessage(error)}</RefusalBox>;
}

/** The refusal alert chrome, shared by verbatim and guided refusals. */
export function RefusalBox({ children }: { readonly children: ReactNode }) {
  return (
    <div
      role="alert"
      className="space-y-1 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
    >
      {children}
    </div>
  );
}
