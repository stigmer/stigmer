"use client";

// The person's notifications on this device: whether it tells them when a
// conversation they started needs them. Nothing here is read from the
// server; the choice is this browser's. Account preferences draws it as one
// of its sections; `NotificationsSection` keeps it as a page of its own for
// a host that mounts it alone.

import { useState } from "react";
import { getUserMessage } from "@stigmer/client";
import { SwitchField } from "../internal/form/SwitchField.js";
import { FieldError } from "../internal/form/Field.js";
import { Notice } from "../internal/surface/Notice.js";
import { Section } from "../resource-detail/Section.js";
import { SettingsPage } from "./SettingsPage.js";
import { useAttentionNotificationsSetting } from "../session/attentionNotificationsSetting.js";

/** Props for {@link NotificationsSection}. */
export interface NotificationsSectionProps {
  /**
   * Asks the system's permission to show notifications, from the person's
   * own flip of the switch: the console asks the browser, the desktop app its
   * plugin. Resolves whether notifications may be shown.
   */
  readonly requestPermission: () => Promise<boolean>;
  /** The host cannot show notifications at all: the switch is off and disabled. */
  readonly unsupported?: boolean;
}

/**
 * The switch that tells the person when a conversation they started needs
 * them, with what stops it: a browser that blocked notifications, one that
 * cannot show them, or a permission request that failed.
 *
 * @internal Drawn by {@link NotificationsSection} and Account preferences.
 */
export function NotificationsSwitch({ requestPermission, unsupported = false }: NotificationsSectionProps) {
  const { on, set } = useAttentionNotificationsSetting();
  const [asking, setAsking] = useState(false);
  const [refused, setRefused] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  async function onToggle(next: boolean) {
    setRefused(false);
    setFailure(null);
    if (!next) {
      set(false);
      return;
    }
    setAsking(true);
    try {
      const allowed = await requestPermission();
      setRefused(!allowed);
      set(allowed);
    } catch (err) {
      // The request itself failed (a plugin error, a browser that threw):
      // the switch stays off and says why, rather than silently undoing the
      // flip (stigmer#2857).
      set(false);
      setFailure(err);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="stg:flex stg:flex-col stg:gap-3">
      <SwitchField
        label="Tell me when a conversation needs me"
        hint="A notification when a conversation you started finishes, stops with an error, or waits for your answer, unless you're looking at it. On this device only."
        checked={on && !unsupported}
        onCheckedChange={(next) => void onToggle(next)}
        disabled={asking || unsupported}
      />
      {unsupported && <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">This browser can&apos;t show notifications.</p>}
      {refused && (
        <Notice tone="paused" role="status" headline="Your browser blocked notifications for this site.">
          Allow them for this site in your browser&apos;s or your system&apos;s settings, then turn this on again.
        </Notice>
      )}
      {failure !== null && (
        <FieldError>Couldn&apos;t ask to show notifications: {getUserMessage(failure)} Try again.</FieldError>
      )}
    </div>
  );
}

/**
 * Settings section for the person's choice to be told when a conversation
 * they started finishes, fails, or waits for their answer, as a page of its
 * own. Turning it on asks the system's permission first, so a page never
 * asks on load; a refusal leaves it off and says where to allow it. The
 * choice is this browser's ({@link useAttentionNotificationsSetting}).
 * The console draws the same switch as a section of Account preferences
 * (`AccountPreferencesSection`'s `requestPermission`).
 */
export function NotificationsSection(props: NotificationsSectionProps) {
  return (
    <SettingsPage title="Notifications" description="When this device tells you about your conversations. Applies on this device only.">
      <Section title="Conversations">
        <div className="stg:p-4">
          <NotificationsSwitch {...props} />
        </div>
      </Section>
    </SettingsPage>
  );
}
