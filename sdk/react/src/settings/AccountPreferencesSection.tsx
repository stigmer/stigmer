"use client";

import { useId } from "react";
import { AccountPreferencesPanel } from "../identity-account/AccountPreferencesPanel.js";

/** Settings section for editing the current user's declared preferences. */
export function AccountPreferencesSection() {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="stg:text-foreground stg:mb-1 stg:text-sm stg:font-semibold"
      >
        Account Preferences
      </h2>
      <p className="stg:text-muted-foreground stg:mb-6 stg:text-xs">
        Personal standing context shared with agents on executions you run.
      </p>

      <AccountPreferencesPanel />
    </section>
  );
}
