import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { SCENES } from "../../../films/intro/manifest";
import type { NarrationManifest } from "./durations";
import { sceneDurations } from "./durations";
import { Placeholder } from "./scenes/Placeholder";

/**
 * The Intro to Stigmer film: scenes laid out back to back, each carrying its
 * own narration audio when generated (assets/narration/<scene-id>.mp3).
 *
 * Scene visuals are Placeholder until their assets land; the assembly and the
 * audio timing are already final, so a rough cut renders at any moment of the
 * production — the film is always in a watchable state.
 */
export const IntroFilm = ({ narration }: { narration: NarrationManifest | null }) => {
  const durations = sceneDurations(narration);
  let cursor = 0;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {SCENES.map((scene) => {
        const from = cursor;
        const duration = durations[scene.id];
        cursor += duration;
        return (
          <Sequence key={scene.id} from={from} durationInFrames={duration} name={scene.id}>
            <Placeholder scene={scene} />
            {narration?.[scene.id] ? (
              <Audio src={staticFile(`narration/${scene.id}.mp3`)} />
            ) : null}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
