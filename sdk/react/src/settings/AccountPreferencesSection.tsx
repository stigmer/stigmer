"use client";

// The Account preferences settings page: the person's own standing context
// and defaults, shared with agents on the runs they start, and this device's
// notifications. The page frame is the shared `SettingsPage`; the panel
// draws its own data states. Notifications were a page of one switch; they
// are a section here, shown when the host can ask the system's permission.

import { AccountPreferencesPanel } from "../identity-account/AccountPreferencesPanel.js";
import { Section } from "../resource-detail/Section.js";
import { NotificationsSwitch } from "./NotificationsSection.js";
import { SettingsPage } from "./SettingsPage.js";

/** Props for {@link AccountPreferencesSection}. */
export interface AccountPreferencesSectionProps {
  /** Where Models & providers is, in the host's routing; the panel links it for the default models. */
  readonly modelsHubHref?: string;
  /**
   * Asks the system's permission to show notifications (the browser's, or
   * the desktop app's plugin). When given, the page draws "Notifications on
   * this device" as its last section; when left out, it draws none.
   */
  readonly requestPermission?: () => Promise<boolean>;
  /** The host cannot show notifications at all: the switch is off and disabled. */
  readonly unsupported?: boolean;
}

/** Settings section for editing the current user's declared preferences and this device's notifications. */
export function AccountPreferencesSection({ modelsHubHref, requestPermission, unsupported }: AccountPreferencesSectionProps = {}) {
  return (
    <SettingsPage
      title="Account preferences"
      description="What agents know about you on every run you start, and the models you start with."
    >
      <div className="stg:flex stg:flex-col stg:gap-4">
        <AccountPreferencesPanel modelsHubHref={modelsHubHref} />
        {requestPermission && (
          <Section title="Notifications on this device">
            <div className="stg:flex stg:flex-col stg:gap-3 stg:p-4">
              <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">Saves as you switch it.</p>
              <NotificationsSwitch requestPermission={requestPermission} unsupported={unsupported} />
            </div>
          </Section>
        )}
      </div>
    </SettingsPage>
  );
}
