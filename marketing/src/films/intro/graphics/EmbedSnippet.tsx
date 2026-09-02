import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../scenes/FramedShot";
import { theme } from "../../../theme";
import { CodeWindow } from "./CodeWindow";
import { GRID, TYPE, enter, exitFade, fadeUp } from "./motion";
import type { GraphicProps } from "./types";

/**
 * S4d (first beat) — "add one component": the embed snippet a customer
 * actually pastes, staggering in line by line before the cut to the live
 * Meridian page. Mirrors demo/embed/index.html with the production origin
 * (exactly what the S4d cloud take runs via APP_ORIGIN).
 */
const LINES: { text: string; indent: number; accent?: boolean }[] = [
  { text: '<script src="https://app.stigmer.ai/embed.js" async></script>', indent: 0 },
  { text: "", indent: 0 },
  { text: "<stigmer-agent", indent: 0, accent: true },
  { text: 'org="meridian-travel"', indent: 1 },
  { text: 'agent="traveler-assist"', indent: 1 },
  { text: "></stigmer-agent>", indent: 0, accent: true },
];

export const EmbedSnippet = ({ durationInFrames }: GraphicProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const heading = enter(frame, fps);
  return (
    <Backdrop>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity: exitFade(frame, durationInFrames),
        }}
      >
        <div
          style={{
            ...fadeUp(heading),
            marginBottom: 5 * GRID,
            fontFamily: theme.fonts.sans,
            fontSize: TYPE.headline,
            fontWeight: 600,
            color: "#e8edf2",
          }}
        >
          One component.
        </div>
        <CodeWindow title="meridian.com — index.html" width={1180} height={430}>
          <div style={{ padding: "30px 40px", fontFamily: theme.fonts.mono, fontSize: TYPE.body, lineHeight: 1.7 }}>
            {LINES.map((line, i) => (
              <div
                key={i}
                style={{
                  ...fadeUp(enter(frame, fps, 8 + i * 4)),
                  paddingLeft: line.indent * 4 * GRID,
                  color: line.accent ? theme.colors.accent : "#d3dae1",
                  whiteSpace: "pre",
                }}
              >
                {line.text || " "}
              </div>
            ))}
          </div>
        </CodeWindow>
      </AbsoluteFill>
    </Backdrop>
  );
};
