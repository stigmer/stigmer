import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../../../theme";
import { GRID, TYPE, enter, fadeUp } from "./motion";
import { StigmerMark } from "./StigmerMark";
import type { GraphicProps } from "./types";

/**
 * S6b — the end card the music resolves on: mark + wordmark, the site,
 * and the one command that makes "get started" concrete. No exit fade —
 * this is the film's final frame.
 */
export const EndCard = (_: GraphicProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mark = enter(frame, fps);
  const word = enter(frame, fps, 5);
  const site = enter(frame, fps, 14);
  const install = enter(frame, fps, 20);
  return (
    <AbsoluteFill
      style={{
        background: theme.colors.ink,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: theme.fonts.sans,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 3 * GRID }}>
        <div style={{ opacity: mark, transform: `scale(${0.8 + 0.2 * mark})` }}>
          <StigmerMark size={14 * GRID} reveal={(i) => enter(frame, fps, i * 2)} />
        </div>
        <div
          style={{
            ...fadeUp(word),
            fontSize: TYPE.display,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: theme.colors.paper,
          }}
        >
          Stigmer
        </div>
      </div>
      <div
        style={{
          ...fadeUp(site),
          marginTop: 6 * GRID,
          fontSize: TYPE.headline,
          fontWeight: 600,
          color: theme.colors.accent,
        }}
      >
        stigmer.ai
      </div>
      <div
        style={{
          ...fadeUp(install),
          marginTop: 5 * GRID,
          padding: `${2 * GRID}px ${4 * GRID}px`,
          borderRadius: 12,
          border: `1px solid ${theme.colors.muted}44`,
          background: "#ffffff0a",
          fontFamily: theme.fonts.mono,
          fontSize: TYPE.body,
          color: theme.colors.muted,
        }}
      >
        brew install stigmer/tap/stigmer
      </div>
    </AbsoluteFill>
  );
};
