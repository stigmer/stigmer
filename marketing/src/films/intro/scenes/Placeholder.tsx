import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { theme } from "../../../theme";
import type { Scene } from "../../../../films/intro/manifest";

/**
 * Stand-in scene rendered until the real asset (recording / presenter clip /
 * motion graphic) exists for a manifest entry. Shows enough context that a
 * rough cut is watchable end to end: scene id, mode, shot plan, narration.
 */
export const Placeholder = ({ scene }: { scene: Scene }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const isPresenter = scene.mode === "presenter";
  return (
    <AbsoluteFill
      style={{
        background: isPresenter ? theme.colors.ink : theme.colors.paper,
        color: isPresenter ? theme.colors.paper : theme.colors.ink,
        fontFamily: theme.fonts.sans,
        justifyContent: "center",
        padding: 120,
        opacity,
      }}
    >
      <div style={{ fontSize: 28, color: theme.colors.accent, fontFamily: theme.fonts.mono }}>
        {scene.id} · {scene.mode}
      </div>
      <div style={{ fontSize: 24, marginTop: 16, color: theme.colors.muted }}>{scene.shots}</div>
      <div style={{ fontSize: 40, lineHeight: 1.4, marginTop: 48, maxWidth: 1400 }}>
        {scene.narration}
      </div>
    </AbsoluteFill>
  );
};
