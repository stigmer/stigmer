import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../../../theme";
import { Backdrop } from "./FramedShot";

export interface ApplyTranscript {
  command: string;
  output: string;
}

/**
 * S3e — "one command, and our agent is live": a styled terminal replaying
 * the REAL `stigmer apply` transcript captured by capture/transcript.mjs
 * (owner decision: rendered terminal, real command and output — a screen
 * recording of a terminal app is neither reproducible nor crisper).
 */
export const TerminalScene = ({ transcript }: { transcript: ApplyTranscript }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Type the command over ~1.6s, then reveal output lines in a beat.
  const typeFrames = fps * 1.6;
  const typedChars = Math.round(
    interpolate(frame, [fps * 0.4, fps * 0.4 + typeFrames], [0, transcript.command.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const outputLines = transcript.output.split("\n");
  const revealStart = fps * 0.4 + typeFrames + fps * 0.35;
  const revealed = Math.round(
    interpolate(frame, [revealStart, revealStart + fps * 0.5], [0, outputLines.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const cursorOn = Math.floor(frame / (fps / 2)) % 2 === 0 && frame < revealStart;

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
            width: 1240,
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
            <div style={{ marginLeft: 14, color: "#8b98a5", fontSize: 20 }}>meridian-travel — zsh</div>
          </div>
          <div style={{ padding: "30px 36px 38px", fontSize: 26, lineHeight: 1.6 }}>
            <div>
              <span style={{ color: theme.colors.accent }}>$ </span>
              <span style={{ color: "#e8edf2" }}>{transcript.command.slice(0, typedChars)}</span>
              {cursorOn ? <span style={{ color: "#e8edf2" }}>▊</span> : null}
            </div>
            {outputLines.slice(0, revealed).map((line, i) => (
              <div key={i} style={{ color: line.startsWith("✓") ? "#28c840" : "#aeb8c2", whiteSpace: "pre" }}>
                {line || " "}
              </div>
            ))}
          </div>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
