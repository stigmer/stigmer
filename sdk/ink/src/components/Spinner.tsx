// The kit's spinner: braille dots on Ink's own animation timer, so every
// spinner on the screen and the working line's clock tick together in one
// render instead of each running its own interval.
import React from "react";
import { Text, useAnimation } from "ink";
import type { RoleStyle } from "../theme.js";

/** The frames, drawn eighty milliseconds apart. */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** Props for {@link Spinner}. */
export interface SpinnerProps {
  /** The role the spinner draws in; the accent by default. */
  readonly style?: RoleStyle;
}

/** A spinner on Ink's shared animation timer (module header). */
export function Spinner({ style }: SpinnerProps) {
  const { frame } = useAnimation({ interval: 80 });
  return <Text {...style}>{SPINNER_FRAMES[frame % SPINNER_FRAMES.length]}</Text>;
}
