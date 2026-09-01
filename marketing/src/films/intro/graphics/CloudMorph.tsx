import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../../../theme";
import { CloudGlyph, LaptopGlyph } from "./glyphs";
import { EASE_GRAND, GRID, TYPE, enter, exitFade, fadeUp } from "./motion";
import type { GraphicProps } from "./types";

/**
 * S5d — "the same definitions move to Stigmer Cloud": the laptop hands
 * off to the cloud panel, whose org/access/billing rows stagger in.
 * Directional where S2c is symmetric — this beat is about graduating,
 * not equivalence.
 */
const ROWS = ["Organizations", "Access control", "Billing"] as const;

export const CloudMorph = ({ durationInFrames }: GraphicProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const laptop = enter(frame, fps);
  const thread = enter(frame, fps, 8, EASE_GRAND);
  const cloud = enter(frame, fps, 16);
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
      <div
        style={{
          ...fadeUp(laptop, 4 * GRID),
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2.5 * GRID,
        }}
      >
        <LaptopGlyph size={11 * GRID} color={theme.colors.paper} />
        <div style={{ fontSize: TYPE.title - 8, fontWeight: 600, color: theme.colors.paper }}>
          Your laptop
        </div>
        <div style={{ fontFamily: theme.fonts.mono, fontSize: TYPE.caption, color: theme.colors.muted }}>
          open source · same definitions
        </div>
      </div>

      {/* The handoff: a thread with a head, traveling laptop → cloud. */}
      <div style={{ width: 24 * GRID, display: "flex", alignItems: "center", margin: `0 ${3 * GRID}px` }}>
        <div
          style={{
            height: 3,
            width: `${thread * 24 * GRID}px`,
            background: `linear-gradient(90deg, ${theme.colors.accent}33, ${theme.colors.accent})`,
            borderRadius: 2,
          }}
        />
        <div
          style={{
            width: 2 * GRID,
            height: 2 * GRID,
            marginLeft: -GRID,
            borderRadius: "50%",
            background: theme.colors.accent,
            opacity: thread,
          }}
        />
      </div>

      <div
        style={{
          ...fadeUp(cloud, 5 * GRID),
          width: 480,
          borderRadius: 16,
          border: `1px solid ${theme.colors.accent}55`,
          background: "#ffffff08",
          padding: `${4 * GRID}px ${4 * GRID}px`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 2 * GRID }}>
          <CloudGlyph size={7 * GRID} color={theme.colors.paper} />
          <div style={{ fontSize: TYPE.title, fontWeight: 600, color: theme.colors.paper }}>
            Stigmer Cloud
          </div>
        </div>
        <div style={{ marginTop: 3 * GRID, display: "flex", flexDirection: "column", gap: 1.5 * GRID }}>
          {ROWS.map((row, i) => {
            const rowIn = enter(frame, fps, 24 + i * 5);
            return (
              <div
                key={row}
                style={{
                  ...fadeUp(rowIn, 2 * GRID),
                  display: "flex",
                  alignItems: "center",
                  gap: 2 * GRID,
                  padding: `${1.5 * GRID}px ${2 * GRID}px`,
                  borderRadius: 10,
                  background: "#ffffff0a",
                  fontSize: TYPE.body - 4,
                  color: theme.colors.paper,
                }}
              >
                <div
                  style={{
                    width: GRID,
                    height: GRID,
                    borderRadius: "50%",
                    background: theme.colors.accent,
                  }}
                />
                {row}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
