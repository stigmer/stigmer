import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../../../theme";
import { Backdrop } from "./FramedShot";

/**
 * S3b — "defined in YAML": a styled code window drifting slowly down the
 * real committed agent manifest (staged by capture/transcript.mjs). The
 * console has no YAML surface for agents, so this is the same treatment
 * as the S3e terminal (owner decision at the footage gate): rendered
 * chrome, real content.
 */
export const YamlPanel = ({ yaml, durationInFrames }: { yaml: string; durationInFrames: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Ease the vertical drift across the whole cut; hold briefly at start.
  const holdFrames = fps * 0.8;
  const driftPx = interpolate(frame, [holdFrames, durationInFrames], [0, 520], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const lines = yaml.replace(/\t/g, "  ").split("\n");
  return (
    <Backdrop>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          fontFamily: theme.fonts.mono,
        }}
      >
        <div
          style={{
            width: 1360,
            height: 860,
            borderRadius: 16,
            overflow: "hidden",
            background: "#101418",
            boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "14px 20px",
              background: "#161b21",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
              <div key={c} style={{ width: 13, height: 13, borderRadius: "50%", background: c }} />
            ))}
            <div style={{ marginLeft: 14, color: "#8b98a5", fontSize: 20 }}>traveler-assist.yaml</div>
          </div>
          {/* Own clipping region: the drifting code must never slide over the title bar. */}
          <div style={{ height: 810, overflow: "hidden" }}>
            <div style={{ padding: "28px 0", transform: `translateY(${-driftPx}px)` }}>
              {lines.map((line, i) => (
                <div key={i} style={{ display: "flex", fontSize: 24, lineHeight: 1.55 }}>
                  <span
                    style={{ width: 72, textAlign: "right", paddingRight: 26, color: "#3d4854", userSelect: "none" }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ color: yamlColor(line), whiteSpace: "pre" }}>{line}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

/** Just enough syntax color for a YAML file to read as an editor. */
function yamlColor(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#")) return "#5f6b76";
  if (/^[\w.-]+:/.test(trimmed)) return "#7dd3a8";
  if (trimmed.startsWith("-")) return "#d3dae1";
  return "#aeb8c2";
}
