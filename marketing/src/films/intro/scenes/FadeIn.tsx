import type * as React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

/**
 * Opacity ramp over the first `fadeInFrames` of a sequence — the film's
 * one dissolve primitive. Cuts use it for cross-dissolves inside a scene
 * (RecordedScene); scenes use it for entrance dissolves at scene
 * boundaries (IntroFilm), where the previous scene keeps playing beneath.
 * Opacity is CSS-only, so wrapped Audio is unaffected.
 */
export const FadeIn = ({
  fadeInFrames,
  children,
}: {
  fadeInFrames: number;
  children: React.ReactNode;
}) => {
  const frame = useCurrentFrame();
  if (fadeInFrames <= 0) return <>{children}</>;
  const opacity = interpolate(frame, [0, fadeInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};
