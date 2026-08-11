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
      className="stg:space-y-1 stg:rounded-md stg:border stg:border-destructive/30 stg:bg-destructive-subtle stg:px-3 stg:py-2 stg:text-xs stg:text-destructive"
    >
      {children}
    </div>
  );
}
