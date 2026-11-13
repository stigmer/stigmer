"use client";

// The one frame every channel card shares in an agent's Channels tab: the
// type's mark, the channel's name, its type and state, the type's own
// details, then its controls (the on/off switch where the channel can
// serve, and its menu). A chat link and a Slack workspace read as the same
// kind of thing because they sit in the same frame; only the middle and
// the menu differ, and those are each card's own.

import type { ComponentType, ReactNode } from "react";
import { Card } from "../internal/surface/Card.js";
import { TruncatedText } from "../internal/truncated-text.js";
import type { StatusPhase } from "../resource-workbench/types.js";
import { StatusBadge } from "../status/StatusBadge.js";

/** Props for {@link ChannelCardFrame}. */
export interface ChannelCardFrameProps {
  /** The channel type's mark. */
  readonly Icon: ComponentType<{ readonly className?: string }>;
  /** The channel type's label ("Chat link", "Slack"). */
  readonly typeLabel: string;
  /** The channel's display name (or slug). */
  readonly name: string;
  /** The channel's state ({@link ChannelStatePill}). */
  readonly state: ReactNode;
  /** The type's own lines under the name. */
  readonly details: ReactNode;
  /** The switch, any connect button, and the menu, in that order. */
  readonly controls: ReactNode;
  /** Anything under the card's row: a readiness warning, a dialog mount. */
  readonly children?: ReactNode;
}

/** One channel's card: the frame every channel type renders in. */
export function ChannelCardFrame({
  Icon,
  typeLabel,
  name,
  state,
  details,
  controls,
  children,
}: ChannelCardFrameProps) {
  return (
    <Card role="group" aria-label={`${typeLabel}: ${name}`}>
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
        <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-2.5">
          <Icon className="stg:size-5 stg:shrink-0 stg:text-foreground" />
          <div className="stg:min-w-0">
            <div className="stg:flex stg:items-center stg:gap-2">
              <TruncatedText
                text={name}
                className="stg:text-sm stg:font-medium stg:text-foreground"
              />
              <span className="stg:shrink-0 stg:text-xs stg:text-muted-foreground">
                {typeLabel}
              </span>
              {state}
            </div>
            {details}
          </div>
        </div>

        <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-2">
          {controls}
        </div>
      </div>
      {children}
    </Card>
  );
}

/** Tone of a {@link ChannelStatePill}. */
export type ChannelStateTone = "success" | "destructive" | "muted";

/** The status pill's phase for each tone. */
const TONE_PHASES: Record<ChannelStateTone, StatusPhase> = {
  success: "ready",
  destructive: "failed",
  muted: "disabled",
};

/** A channel's state beside its name, on the status pill ("Active", "Pending install"). */
export function ChannelStatePill({
  label,
  tone,
}: {
  readonly label: string;
  readonly tone: ChannelStateTone;
}) {
  return <StatusBadge phase={TONE_PHASES[tone]} label={label} />;
}
