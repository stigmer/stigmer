import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * Minimal composition that validates the Remotion + Tailwind v4
 * pipeline. Renders the Stigmer dark palette with the project's
 * typography, proving that the bundle boundary, CSS tokens, and
 * font loading all work correctly.
 */
export const HelloWorld: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  const subtitleOpacity = interpolate(frame, [15, 35], [0, 1], {
    extrapolateRight: "clamp",
  });

  const metaOpacity = interpolate(frame, [30, 50], [0, 1], {
    extrapolateRight: "clamp",
  });

  const seconds = (frame / fps).toFixed(1);
  const totalSeconds = (durationInFrames / fps).toFixed(1);

  return (
    <AbsoluteFill className="dark bg-background font-sans">
      <div className="flex h-full flex-col items-center justify-center gap-6">
        <h1
          className="text-6xl font-semibold tracking-tight text-foreground"
          style={{ opacity: titleOpacity }}
        >
          Stigmer Video Export
        </h1>

        <p
          className="text-2xl text-muted-foreground"
          style={{ opacity: subtitleOpacity }}
        >
          Remotion + Tailwind v4 pipeline validation
        </p>

        <div
          className="mt-8 flex items-center gap-4 font-mono text-sm text-subtle"
          style={{ opacity: metaOpacity }}
        >
          <span>
            Frame {frame}/{durationInFrames}
          </span>
          <span className="text-border">|</span>
          <span>
            {seconds}s / {totalSeconds}s
          </span>
          <span className="text-border">|</span>
          <span>{fps} fps</span>
          <span className="text-border">|</span>
          <span>1920 x 1080</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
