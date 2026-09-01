import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../../../theme";
import { GRID, TYPE, enter, exitFade, fadeUp } from "./motion";
import { StigmerMark } from "./StigmerMark";
import type { GraphicProps } from "./types";

/**
 * S1b — the logo beat on the word "Stigmer" in the cold open: a
 * lower-third lockup over the presenter, petals staggering in, gone
 * before her next sentence. An overlay, so it decorates the clip
 * rather than replacing it.
 */
export const LogoReveal = ({ durationInFrames }: GraphicProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pill = enter(frame, fps);
  const word = enter(frame, fps, 4);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-start" }}>
      <div
        style={{
          ...fadeUp(pill, 3 * GRID),
          opacity: pill * exitFade(frame, durationInFrames, 12),
          display: "flex",
          alignItems: "center",
          gap: 2.5 * GRID,
          margin: `0 0 ${14 * GRID}px ${15 * GRID}px`,
          padding: `${2 * GRID}px ${4 * GRID}px ${2 * GRID}px ${3 * GRID}px`,
          borderRadius: 18,
          background: `${theme.colors.ink}d9`,
          border: "1px solid rgba(255,255,255,0.10)",
          backdropFilter: "blur(6px)",
        }}
      >
        <StigmerMark size={9 * GRID} reveal={(i) => enter(frame, fps, 2 + i * 2)} />
        <div
          style={{
            ...fadeUp(word, 2 * GRID),
            fontFamily: theme.fonts.sans,
            fontSize: TYPE.headline,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: theme.colors.paper,
          }}
        >
          Stigmer
        </div>
      </div>
    </AbsoluteFill>
  );
};
