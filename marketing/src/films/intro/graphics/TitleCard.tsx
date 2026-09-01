import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../../../theme";
import { GRID, TYPE, enter, exitFade, fadeUp } from "./motion";
import type { GraphicProps } from "./types";

/**
 * Scene 2's numbered chapter cards ("01 — Agents are infrastructure").
 * The Linear-intro register: an oversized ghost numeral setting the beat,
 * the claim in display type, an accent rule drawing between them.
 */
export const TitleCard =
  ({ index, title }: { index: string; title: string }) =>
  ({ durationInFrames }: GraphicProps) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const numeral = enter(frame, fps);
    const rule = enter(frame, fps, 6);
    const headline = enter(frame, fps, 10);
    return (
      <AbsoluteFill
        style={{
          background: theme.colors.ink,
          justifyContent: "center",
          padding: `0 ${20 * GRID}px`,
          fontFamily: theme.fonts.sans,
          opacity: exitFade(frame, durationInFrames),
        }}
      >
        <div
          style={{
            ...fadeUp(numeral, 6 * GRID),
            fontSize: TYPE.index,
            fontWeight: 700,
            lineHeight: 1,
            color: "transparent",
            WebkitTextStroke: `2px ${theme.colors.muted}`,
            letterSpacing: "-0.02em",
          }}
        >
          {index}
        </div>
        <div
          style={{
            height: 4,
            width: `${rule * 14 * GRID}px`,
            background: theme.colors.accent,
            margin: `${5 * GRID}px 0`,
            borderRadius: 2,
          }}
        />
        <div
          style={{
            ...fadeUp(headline),
            fontSize: TYPE.display,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            color: theme.colors.paper,
            maxWidth: 1400,
          }}
        >
          {title}
        </div>
      </AbsoluteFill>
    );
  };
