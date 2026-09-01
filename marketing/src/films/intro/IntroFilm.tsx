import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { SCENES } from "../../../films/intro/manifest";
import type { NarrationManifest } from "./durations";
import { sceneDurations } from "./durations";
import { Placeholder } from "./scenes/Placeholder";
import { PresenterScene } from "./scenes/PresenterScene";
import type { FilmData } from "./scenes/RecordedScene";
import { RecordedScene } from "./scenes/RecordedScene";

export type IntroFilmProps = {
  narration: NarrationManifest | null;
  /** Scene ids whose HeyGen presenter clip exists in assets/presenter/. */
  presenterScenes: string[];
  /** Captured footage + staged film data (see RecordedScene). */
  filmData: FilmData;
};

/**
 * The Intro to Stigmer film: scenes laid out back to back, each carrying its
 * own narration audio when generated (assets/narration/<scene-id>.mp3).
 *
 * Scene visuals resolve in order: a presenter clip when one exists, the
 * manifest's editorial cuts when the scene declares them (real recordings +
 * rendered data panels, missing assets degrade to slates), and the
 * structured Placeholder otherwise — so a rough cut of the full film is
 * available at every stage of production.
 */
export const IntroFilm = ({ narration, presenterScenes, filmData }: IntroFilmProps) => {
  const durations = sceneDurations(narration);
  let cursor = 0;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {SCENES.map((scene) => {
        const from = cursor;
        const duration = durations[scene.id];
        cursor += duration;
        const hasPresenterClip = presenterScenes.includes(scene.id);
        return (
          <Sequence key={scene.id} from={from} durationInFrames={duration} name={scene.id}>
            {hasPresenterClip ? (
              <PresenterScene sceneId={scene.id} />
            ) : scene.cuts !== undefined ? (
              <RecordedScene cuts={scene.cuts} durationInFrames={duration} data={filmData} />
            ) : (
              <Placeholder scene={scene} />
            )}
            {/* Presenter clips carry their own (lip-synced) narration audio. */}
            {!hasPresenterClip && narration?.[scene.id] ? (
              <Audio src={staticFile(`narration/${scene.id}.mp3`)} />
            ) : null}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
