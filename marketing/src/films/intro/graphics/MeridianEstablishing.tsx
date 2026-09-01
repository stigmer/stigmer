import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../../../theme";
import { GRID, TYPE, enter, exitFade, fadeUp } from "./motion";
import type { GraphicProps } from "./types";

/**
 * S3a — "say we run a travel company": the story company's identity
 * card, in Meridian's own palette (the teal/sand brand the embed page
 * establishes) so scene 3's world reads as the customer's, not ours.
 */
const MERIDIAN = {
  ink: "#0b2239",
  teal: "#0f766e",
  tealBright: "#14b8a6",
  sand: "#f7f4ee",
} as const;

export const MeridianEstablishing = ({ durationInFrames }: GraphicProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mark = enter(frame, fps);
  const name = enter(frame, fps, 6);
  const line = enter(frame, fps, 12);
  return (
    <AbsoluteFill
      style={{
        background: MERIDIAN.sand,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: theme.fonts.sans,
        opacity: exitFade(frame, durationInFrames),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4 * GRID }}>
        <div
          style={{
            width: 15 * GRID,
            height: 15 * GRID,
            borderRadius: "50%",
            background: `conic-gradient(from 210deg, ${MERIDIAN.teal}, ${MERIDIAN.tealBright} 55%, ${MERIDIAN.ink})`,
            opacity: mark,
            transform: `scale(${mark})`,
          }}
        />
        <div
          style={{
            ...fadeUp(name),
            fontSize: TYPE.display,
            fontWeight: 600,
            letterSpacing: "0.01em",
            color: MERIDIAN.ink,
          }}
        >
          Meridian Travel
        </div>
      </div>
      <div
        style={{
          ...fadeUp(line),
          marginTop: 5 * GRID,
          fontSize: TYPE.title,
          color: MERIDIAN.teal,
          fontWeight: 500,
        }}
      >
        Flights, bookings, and travelers who need help — fast.
      </div>
    </AbsoluteFill>
  );
};
