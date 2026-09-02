import type * as React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CameraMove, Spotlight } from "../../../../films/intro/manifest";
import { HEIGHT, WIDTH } from "../../../../films/intro/manifest";
import { theme } from "../../../theme";
import { EASE_GRAND, enter, exitFade } from "../graphics/motion";

/**
 * The film's product-shot treatment (rough-cut gate, 2026-09-02): product
 * beats sit as a rounded window on a soft brand backdrop instead of
 * full-bleed — the Linear register the owner asked for. FramedShot also
 * hosts the camera rig (manifest `camera` keyframes) and spotlights
 * (manifest `spotlights`), so every "look here" gesture is editorial data
 * composited in one place.
 */

/** How much of the frame the product window occupies. */
const FRAME_SCALE = 0.88;

/** Camera ease default: a calm ~1.4s settle (see manifest CameraMove). */
const DEFAULT_EASE_SEC = 1.4;

/**
 * The shared stage behind every product beat: the brand ink with two
 * barely-there glows (accent + a cool counterpoint). Deliberately static —
 * the calmness lives in what does NOT move.
 */
export const Backdrop = ({ children }: { children?: React.ReactNode }) => (
  <AbsoluteFill
    style={{
      background: `
        radial-gradient(1200px 800px at 22% 12%, rgba(108, 92, 231, 0.14), transparent 65%),
        radial-gradient(1000px 700px at 82% 88%, rgba(20, 184, 166, 0.08), transparent 65%),
        ${theme.colors.ink}
      `,
    }}
  >
    {children}
  </AbsoluteFill>
);

/** Camera state at one instant: scale + normalized point of interest. */
interface CameraState {
  zoom: number;
  cx: number;
  cy: number;
}

const REST: CameraState = { zoom: 1, cx: 0.5, cy: 0.5 };

/**
 * Resolves the chained camera keyframes to the current state. Each move
 * eases from wherever the camera currently is, so overlapping or densely
 * packed keyframes blend instead of jumping.
 */
const cameraAt = (frame: number, fps: number, moves: CameraMove[]): CameraState => {
  let state = REST;
  for (const move of moves) {
    const easeFrames = Math.max(1, Math.round((move.easeSec ?? DEFAULT_EASE_SEC) * fps));
    const progress = spring({
      frame: frame - Math.round(move.atSec * fps),
      fps,
      config: EASE_GRAND,
      durationInFrames: easeFrames,
    });
    state = {
      zoom: state.zoom + (move.zoom - state.zoom) * progress,
      cx: state.cx + (move.cx - state.cx) * progress,
      cy: state.cy + (move.cy - state.cy) * progress,
    };
  }
  return state;
};

/**
 * A product beat in the film's window: rounded corners, soft shadow, the
 * brand backdrop behind, camera keyframes and spotlights composited over
 * the media. Children render at the full native frame (WIDTH x HEIGHT);
 * the window scales as one unit so takes stay pixel-faithful.
 */
export const FramedShot = ({
  children,
  camera,
  spotlights,
}: {
  children: React.ReactNode;
  camera?: CameraMove[];
  spotlights?: Spotlight[];
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cam = camera && camera.length > 0 ? cameraAt(frame, fps, camera) : REST;
  // Push-in around the point of interest: P stays fixed while the frame
  // grows around it (translate(P*(1-s)) scale(s) — the matrix form, so
  // keyframes interpolate numerically without transform-origin jumps).
  const px = cam.cx * WIDTH;
  const py = cam.cy * HEIGHT;
  return (
    <Backdrop>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            width: WIDTH,
            height: HEIGHT,
            transform: `scale(${FRAME_SCALE})`,
            borderRadius: 24,
            overflow: "hidden",
            boxShadow: "0 40px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)",
            position: "relative",
            background: "#fff",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              transform: `translate(${px * (1 - cam.zoom)}px, ${py * (1 - cam.zoom)}px) scale(${cam.zoom})`,
              transformOrigin: "0 0",
            }}
          >
            {children}
            {spotlights?.map((s, i) => (
              <SpotlightView key={i} spotlight={s} />
            ))}
          </div>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

/**
 * One timed spotlight: an accent ring around the target whose oversized
 * shadow dims everything else in the window (clipped by the window's
 * overflow), plus the optional label. Lives INSIDE the camera transform
 * so it tracks any concurrent push-in exactly.
 */
const SpotlightView = ({ spotlight }: { spotlight: Spotlight }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = Math.round(spotlight.atSec * fps);
  const frames = Math.round(spotlight.durationSec * fps);
  const local = frame - start;
  if (local < 0 || local >= frames) return null;

  const on = enter(local, fps);
  const opacity = on * exitFade(local, frames, 10);
  const r = spotlight.region;
  const x = r.x * WIDTH;
  const y = r.y * HEIGHT;
  const w = r.w * WIDTH;
  const h = r.h * HEIGHT;
  // The label sits under the target unless the target hugs the bottom edge.
  const labelBelow = y + h < HEIGHT - 120;
  return (
    <div style={{ position: "absolute", inset: 0, opacity, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: w,
          height: h,
          borderRadius: 14,
          border: `3px solid ${theme.colors.accent}`,
          boxShadow: `0 0 0 100000px rgba(5, 7, 11, 0.52), 0 0 32px rgba(108, 92, 231, 0.45)`,
        }}
      />
      {spotlight.label ? (
        <div
          style={{
            position: "absolute",
            left: x,
            top: labelBelow ? y + h + 18 : undefined,
            bottom: labelBelow ? undefined : HEIGHT - y + 18,
            padding: "8px 16px",
            borderRadius: 10,
            background: theme.colors.accent,
            color: "#fff",
            fontFamily: theme.fonts.sans,
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "0.01em",
          }}
        >
          {spotlight.label}
        </div>
      ) : null}
    </div>
  );
};
