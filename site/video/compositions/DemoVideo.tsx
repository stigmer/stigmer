import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { VideoExportProvider, TimeSourceProvider } from "@scenar/react";
import { SCENARIO_REGISTRY } from "@/components/docs/demos/scenarios/registry";
import { DEMO_VIDEO_SHELL_HEIGHT } from "@/components/docs/demos/shared/tokens";
import type { Timeline } from "../lib/timeline";

export interface DemoVideoProps {
  scenarioId: string;
  timeline: Timeline;
}

/**
 * Virtual viewport dimensions for the demo content area.
 *
 * Demo components use `max-w-4xl` (896px) and `DEMO_SHELL_HEIGHT`.
 * A 960x540 virtual viewport (16:9) at zoom 2x fills the 1920x1080
 * composition exactly. The 896px component fills ~93% of the width
 * with balanced margins that preserve the AppShell's rounded corners,
 * and ~91% of the height with subtle dark framing above and below.
 */
const VIRTUAL_WIDTH = 960;
const VIRTUAL_HEIGHT = 540;

/**
 * Remotion composition that renders a Stigmer demo scenario as a
 * pixel-perfect video.
 *
 * Wraps the scenario component in two providers:
 * - **TimeSourceProvider** — feeds `currentTimeMs` (derived from
 *   Remotion's frame counter) so ScenarioPlayer advances steps
 *   deterministically instead of using `setTimeout`.
 * - **VideoExportProvider** — hides playback controls and sets the
 *   same export flags as the Playwright pipeline.
 *
 * The content area uses a virtual viewport (960x540) scaled up via
 * CSS zoom to fill the composition dimensions. This mirrors the
 * Playwright export's viewport+DPR strategy for crisp, readable output.
 *
 * Narration audio is rendered through Remotion's `<Audio>` component
 * at the exact frame offsets computed by the timeline, bypassing
 * ScenarioPlayer's browser `<audio>` element entirely.
 */
export const DemoVideo: React.FC<DemoVideoProps> = ({
  scenarioId,
  timeline,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const currentTimeMs = (frame / fps) * 1000;
  const zoom = Math.min(width / VIRTUAL_WIDTH, height / VIRTUAL_HEIGHT);

  const Component = SCENARIO_REGISTRY[scenarioId];
  if (!Component) return null;

  return (
    <AbsoluteFill className="dark bg-neutral-950">
      <div
        style={{
          width: VIRTUAL_WIDTH,
          height: VIRTUAL_HEIGHT,
          zoom,
          "--scenar-shell-height": `${DEMO_VIDEO_SHELL_HEIGHT}px`,
        } as React.CSSProperties}
        className="flex flex-col justify-center overflow-hidden"
      >
        <TimeSourceProvider
          currentTimeMs={currentTimeMs}
          stepStartTimesMs={timeline.stepStartTimesMs}
        >
          <VideoExportProvider>
            <div className="mx-auto w-full max-w-4xl rounded-xl ring-1 ring-white/[0.06]">
              <Component />
            </div>
          </VideoExportProvider>
        </TimeSourceProvider>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-4 select-none text-xs tracking-wide text-white/25">
        stigmer.ai
      </div>

      {timeline.audioClips.map((clip) => (
        <Sequence
          key={clip.stepIndex}
          from={clip.startFrame}
          durationInFrames={clip.durationFrames}
        >
          <Audio src={staticFile(clip.src.replace(/^\//, ""))} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
