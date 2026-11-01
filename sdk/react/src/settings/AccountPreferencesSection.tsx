"use client";

// The Account preferences settings page: the person's own standing context
// and defaults, shared with agents on the runs they start. The page frame
// is the shared `SettingsPage`; the panel draws its own data states.

import { AccountPreferencesPanel } from "../identity-account/AccountPreferencesPanel.js";
import { SettingsPage } from "./SettingsPage.js";

/** Props for {@link AccountPreferencesSection}. */
export interface AccountPreferencesSectionProps {
  /** Where Models & providers is, in the host's routing; the panel links it for the default models. */
  readonly modelsHubHref?: string;
}

/** Settings section for editing the current user's declared preferences. */
export function AccountPreferencesSection({ modelsHubHref }: AccountPreferencesSectionProps = {}) {
  return (
    <SettingsPage
      title="Account preferences"
      description="What agents know about you on every run you start, and the models you start with."
    >
      <AccountPreferencesPanel modelsHubHref={modelsHubHref} />
    </SettingsPage>
  );
}
