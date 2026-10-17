"use client";

// The one frame every channel card shares in an agent's Channels tab: the
// type's mark, the channel's name, its type and state, the type's own
// details, then its controls (the on/off switch where the channel can
// serve, and its menu). A chat link and a Slack workspace read as the same
// kind of thing because they sit in the same frame; only the middle and
// the menu differ, and those are each card's own.

import type { ComponentType, ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { TruncatedText } from "../internal/truncated-text.js";

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
    <div
      role="group"
      aria-label={`${typeLabel}: ${name}`}
      className="stg:rounded-lg stg:border stg:border-border stg:p-4"
    >
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
    </div>
  );
}

/** Tone of a {@link ChannelStatePill}. */
export type ChannelStateTone = "success" | "destructive" | "muted";

const TONE_CLASSES: Record<ChannelStateTone, string> = {
  success: "stg:text-success",
  destructive: "stg:text-destructive",
  muted: "stg:text-muted-foreground",
};

/** A channel's state beside its name: a dot and a word ("Active", "Pending install"). */
export function ChannelStatePill({
  label,
  tone,
}: {
  readonly label: string;
  readonly tone: ChannelStateTone;
}) {
  return (
    <span
      className={cn(
        "stg:inline-flex stg:shrink-0 stg:items-center stg:gap-1.5 stg:text-xs",
        TONE_CLASSES[tone],
      )}
    >
      <span aria-hidden="true" className="stg:size-1.5 stg:rounded-full stg:bg-current" />
      {label}
    </span>
  );
}
