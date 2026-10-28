"use client";

import { useId } from "react";
import { AccountPreferencesPanel } from "../identity-account/AccountPreferencesPanel.js";

/** Props for {@link AccountPreferencesSection}. */
export interface AccountPreferencesSectionProps {
  /** Where Models & providers is, in the host's routing; the panel links it for the default models. */
  readonly modelsHubHref?: string;
}

/** Settings section for editing the current user's declared preferences. */
export function AccountPreferencesSection({ modelsHubHref }: AccountPreferencesSectionProps = {}) {
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
        Personal standing context shared with agents on runs you start.
      </p>

      <AccountPreferencesPanel modelsHubHref={modelsHubHref} />
    </section>
  );
}
