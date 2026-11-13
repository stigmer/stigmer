"use client";

import type { ReactNode } from "react";
import { ErrorMessage } from "../../error/ErrorMessage.js";
import { Notice } from "../../internal/surface/Notice.js";

/** What every install refusal says first. */
const REFUSAL_HEADLINE = "The install didn't go through.";

/**
 * The plain install-refusal alert: the server's copy rendered verbatim —
 * the server owns that vocabulary. Both connect dialogs fall back to
 * this for any refusal they don't recognize; provider-guided refusals
 * (a known ErrorInfo reason with actionable copy) stay provider-local
 * and reuse {@link RefusalBox} for the chrome.
 */
export function VerbatimRefusal({ error }: { readonly error: Error }) {
  return <ErrorMessage error={error} title={REFUSAL_HEADLINE} />;
}

/** The refusal alert chrome for a guided refusal: the kit's failed notice, its lines under the headline. */
export function RefusalBox({ children }: { readonly children: ReactNode }) {
  return (
    <Notice tone="failed" role="alert" headline={REFUSAL_HEADLINE}>
      <div className="stg:space-y-1">{children}</div>
    </Notice>
  );
}
