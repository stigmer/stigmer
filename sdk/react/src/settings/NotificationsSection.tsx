"use client";

// The Notifications settings page: whether this device tells the person
// when a conversation they started needs them. Nothing here is read from
// the server; the choice is this browser's.

import { useId, useState } from "react";
import { Switch } from "../switch/Switch.js";
import { Card } from "../internal/surface/Card.js";
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
 * Settings section for the person's choice to be told when a conversation
 * they started finishes, fails, or waits for their answer. Turning it on asks
 * the system's permission first, so a page never asks on load; a refusal
 * leaves it off and says where to allow it. The choice is this browser's
 * ({@link useAttentionNotificationsSetting}).
 */
export function NotificationsSection({ requestPermission, unsupported = false }: NotificationsSectionProps) {
  const switchId = useId();
  const { on, set } = useAttentionNotificationsSetting();
  const [asking, setAsking] = useState(false);
  const [refused, setRefused] = useState(false);

  async function onToggle(next: boolean) {
    setRefused(false);
    if (!next) {
      set(false);
      return;
    }
    setAsking(true);
    try {
      const allowed = await requestPermission();
      setRefused(!allowed);
      set(allowed);
    } finally {
      setAsking(false);
    }
  }

  return (
    <SettingsPage title="Notifications" description="When this device tells you about your conversations. Applies on this device only.">
      <Card className="stg:space-y-1">
        <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
          <div className="stg:min-w-0 stg:flex-1">
            <span id={`${switchId}-title`} className="stg:block stg:text-xs stg:font-medium stg:text-foreground">
              Tell me when a conversation needs me
            </span>
            <p
              id={`${switchId}-description`}
              className="stg:text-2xs stg:leading-snug stg:text-muted-foreground"
            >
              A notification when a conversation you started finishes, stops with an error, or waits for your
              answer, unless you are looking at it.
            </p>
          </div>
          <Switch
            id={switchId}
            checked={on && !unsupported}
            onCheckedChange={(next) => void onToggle(next)}
            disabled={asking || unsupported}
            aria-labelledby={`${switchId}-title`}
            aria-describedby={`${switchId}-description`}
          />
        </div>
        {unsupported && (
          <p className="stg:text-2xs stg:text-muted-foreground">This browser cannot show notifications.</p>
        )}
        {refused && (
          <p className="stg:text-2xs stg:text-destructive" role="alert">
            Notifications are blocked. Allow them for this site in your browser or system settings, then turn this on.
          </p>
        )}
      </Card>
    </SettingsPage>
  );
}
