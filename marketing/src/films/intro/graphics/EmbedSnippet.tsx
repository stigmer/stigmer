import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../scenes/FramedShot";
import { theme } from "../../../theme";
import { CodeWindow } from "./CodeWindow";
import { GRID, TYPE, enter, exitFade, fadeUp } from "./motion";
import type { GraphicProps } from "./types";

/**
 * S4d (mid beat) — "add one component": the @stigmer/react integration a
 * platform builder actually writes, staggering in line by line between
 * the bare Meridian page and the live assistant. Mirrors the real demo
 * app (demo/app/src/App.tsx) — the exact code the S4d take runs.
 */
const LINES: { text: string; indent: number; accent?: boolean }[] = [
  { text: 'import { StigmerProvider, NewSessionViewer } from "@stigmer/react";', indent: 0 },
  { text: "", indent: 0 },
  { text: "<StigmerProvider client={stigmer}>", indent: 0 },
  { text: "<NewSessionViewer", indent: 1, accent: true },
  { text: 'org="meridian-travel"', indent: 2 },
  { text: 'initialAgentRef={{ org: "meridian-travel", slug: "traveler-assist" }}', indent: 2 },
  { text: 'audience="endUser"', indent: 2 },
  { text: "/>", indent: 1, accent: true },
  { text: "</StigmerProvider>", indent: 0 },
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
        <CodeWindow title="meridian — TripPage.tsx" width={1280} height={520}>
          <div style={{ padding: "30px 40px", fontFamily: theme.fonts.mono, fontSize: 28, lineHeight: 1.65 }}>
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
