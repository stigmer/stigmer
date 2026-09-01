import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../../../theme";
import { CloudGlyph, LaptopGlyph } from "./glyphs";
import { EASE_GRAND, GRID, TYPE, enter, exitFade, fadeUp } from "./motion";
import type { GraphicProps } from "./types";

/**
 * S2c — "the exact same definition runs on your laptop and in the
 * cloud": one YAML chip in the center, identical threads reaching both
 * environments. The symmetry IS the message, so the two panels are
 * deliberately equal weight.
 */
export const LaptopToCloud = ({ durationInFrames }: GraphicProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chip = enter(frame, fps);
  const threads = enter(frame, fps, 10, EASE_GRAND);
  const panels = enter(frame, fps, 18);
  return (
    <AbsoluteFill
      style={{
        background: theme.colors.ink,
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: theme.fonts.sans,
        opacity: exitFade(frame, durationInFrames),
      }}
    >
      <EnvPanel
        progress={panels}
        glyph={<LaptopGlyph size={9 * GRID} color={theme.colors.paper} />}
        name="Your laptop"
        detail="brew install · stigmer up"
      />
      <Thread progress={threads} direction="left" />
      <div
        style={{
          ...fadeUp(chip, 3 * GRID),
          padding: `${2 * GRID}px ${3 * GRID}px`,
          borderRadius: 12,
          border: `1px solid ${theme.colors.accent}66`,
          background: `${theme.colors.accent}14`,
          fontFamily: theme.fonts.mono,
          fontSize: TYPE.body - 4,
          color: theme.colors.paper,
          whiteSpace: "nowrap",
        }}
      >
        traveler-assist.yaml
      </div>
      <Thread progress={threads} direction="right" />
      <EnvPanel
        progress={panels}
        glyph={<CloudGlyph size={9 * GRID} color={theme.colors.paper} />}
        name="Stigmer Cloud"
        detail="orgs · access · billing"
      />
    </AbsoluteFill>
  );
};

/** A thread growing outward from the chip toward an environment. */
const Thread = ({ progress, direction }: { progress: number; direction: "left" | "right" }) => (
  <div
    style={{
      width: 16 * GRID,
      display: "flex",
      justifyContent: direction === "left" ? "flex-end" : "flex-start",
      alignItems: "center",
    }}
  >
    <div
      style={{
        height: 3,
        width: `${progress * 16 * GRID}px`,
        background: theme.colors.accent,
        borderRadius: 2,
      }}
    />
  </div>
);

const EnvPanel = ({
  progress,
  glyph,
  name,
  detail,
}: {
  progress: number;
  glyph: React.ReactNode;
  name: string;
  detail: string;
}) => (
  <div
    style={{
      ...fadeUp(progress, 5 * GRID),
      width: 400,
      borderRadius: 16,
      border: "1px solid rgba(255,255,255,0.12)",
      background: "#ffffff08",
      padding: `${5 * GRID}px ${4 * GRID}px`,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 2.5 * GRID,
    }}
  >
    {glyph}
    <div style={{ fontSize: TYPE.title, fontWeight: 600, color: theme.colors.paper }}>{name}</div>
    <div style={{ fontFamily: theme.fonts.mono, fontSize: TYPE.caption, color: theme.colors.muted }}>
      {detail}
    </div>
  </div>
);
