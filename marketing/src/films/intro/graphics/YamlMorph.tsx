import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../../../theme";
import { CodeWindow, yamlColor } from "./CodeWindow";
import { EASE_GRAND, GRID, TYPE, enter, exitFade, fadeUp } from "./motion";
import type { GraphicProps } from "./types";

/**
 * S2b — "defined in YAML, versioned, and portable": the real staged
 * agent manifest (the same text S3b drifts through) becoming a console
 * library card. Editor on the left, the card materializing on the
 * right, an accent thread carrying the definition across.
 */
export const YamlMorph = ({ durationInFrames, data }: GraphicProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const editor = enter(frame, fps);
  const thread = enter(frame, fps, 12, EASE_GRAND);
  const card = enter(frame, fps, 22);
  const lines = (data?.agentYaml ?? "# traveler-assist.yaml\n# run capture:transcript to stage the manifest")
    .replace(/\t/g, "  ")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .slice(0, 15);
  return (
    <AbsoluteFill
      style={{
        background: theme.colors.ink,
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        gap: 0,
        opacity: exitFade(frame, durationInFrames),
      }}
    >
      <div style={fadeUp(editor)}>
        <CodeWindow title="traveler-assist.yaml" width={760} height={620}>
          <div style={{ padding: `${3 * GRID}px 0`, fontFamily: theme.fonts.mono }}>
            {lines.map((line, i) => (
              <div key={i} style={{ display: "flex", fontSize: 22, lineHeight: 1.6 }}>
                <span style={{ width: 60, textAlign: "right", paddingRight: 22, color: "#3d4854" }}>
                  {i + 1}
                </span>
                <span style={{ color: yamlColor(line), whiteSpace: "pre" }}>{line}</span>
              </div>
            ))}
          </div>
        </CodeWindow>
      </div>

      {/* The definition traveling from file to platform. */}
      <div style={{ width: 22 * GRID, display: "flex", alignItems: "center" }}>
        <div
          style={{
            height: 3,
            width: `${thread * 22 * GRID}px`,
            background: `linear-gradient(90deg, ${theme.colors.accent}00, ${theme.colors.accent})`,
            borderRadius: 2,
          }}
        />
      </div>

      <div
        style={{
          ...fadeUp(card, 5 * GRID),
          width: 520,
          borderRadius: 16,
          background: "#ffffff",
          boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
          padding: `${4 * GRID}px ${4 * GRID}px`,
          fontFamily: theme.fonts.sans,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 2 * GRID }}>
          <div
            style={{
              width: 7 * GRID,
              height: 7 * GRID,
              borderRadius: "50%",
              background: "#2563eb",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: TYPE.body,
              fontWeight: 600,
            }}
          >
            T
          </div>
          <div>
            <div style={{ fontSize: TYPE.title - 8, fontWeight: 600, color: "#111827" }}>
              traveler-assist
            </div>
            <div style={{ fontSize: TYPE.caption, color: "#6b7280" }}>meridian-travel</div>
          </div>
        </div>
        <div style={{ marginTop: 3 * GRID, fontSize: TYPE.body - 4, lineHeight: 1.5, color: "#374151" }}>
          Helps Meridian Travel customers rebook flights and manage their trips
        </div>
        <div
          style={{
            display: "inline-block",
            marginTop: 3 * GRID,
            padding: `${GRID}px ${2 * GRID}px`,
            borderRadius: 999,
            background: `${theme.colors.accent}1a`,
            color: theme.colors.accent,
            fontSize: TYPE.caption,
            fontWeight: 600,
          }}
        >
          versioned · portable
        </div>
      </div>
    </AbsoluteFill>
  );
};
