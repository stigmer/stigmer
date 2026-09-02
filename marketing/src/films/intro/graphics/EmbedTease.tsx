import { OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../../../theme";
import { GRID, enter, exitFade } from "./motion";
import type { GraphicProps } from "./types";

/**
 * S1c — the flash-forward: while the presenter says "inside your own
 * product", the finished Meridian page with the live widget rises in as a
 * card, so the viewer sees the film's destination in the first fifteen
 * seconds (owner note at the rough-cut gate: the embed is the payoff —
 * show it early). Plays the real s4d take; without the take the overlay
 * renders nothing (an overlay never blanks its base visual).
 */

/** Where in the s4d take the assistant is live and answering (editorial trim). */
const TEASE_SRC_START_SEC = 30;

/**
 * Card footprint: big enough to read as "a real product page", not a
 * thumbnail — but never over the presenter's face (she stands center-left).
 */
const CARD_WIDTH = 800;
const CARD_HEIGHT = Math.round((CARD_WIDTH * 9) / 16);

export const EmbedTease = ({ durationInFrames, data }: GraphicProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!data?.recordedShots.includes("s4d-embed")) return null;

  const on = enter(frame, fps);
  const opacity = on * exitFade(frame, durationInFrames, 10);
  return (
    <div
      style={{
        position: "absolute",
        right: 8 * GRID,
        top: "56%",
        transform: `translateY(-50%) translateY(${(1 - on) * 6 * GRID}px)`,
        opacity,
      }}
    >
      <div
        style={{
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          borderRadius: 20,
          overflow: "hidden",
          boxShadow: `0 32px 100px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.12)`,
          background: "#fff",
        }}
      >
        <OffthreadVideo
          src={staticFile("recordings/s4d-embed.webm")}
          startFrom={Math.round(TEASE_SRC_START_SEC * fps)}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
      <div
        style={{
          marginTop: 2 * GRID,
          textAlign: "center",
          fontFamily: theme.fonts.sans,
          fontSize: 24,
          fontWeight: 600,
          color: "#fff",
          textShadow: "0 2px 12px rgba(0,0,0,0.6)",
          letterSpacing: "0.01em",
        }}
      >
        Your product — with a live agent inside
      </div>
    </div>
  );
};
