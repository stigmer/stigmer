import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import type { Overlay } from "../../../films/intro/manifest";
import { FPS, SCENES } from "../../../films/intro/manifest";
import type { NarrationManifest } from "./durations";
import { sceneDurations } from "./durations";
import { GRAPHICS } from "./graphics";
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
 * rendered data panels + registered graphics, missing assets degrade to
 * slates), and the structured Placeholder otherwise — so a rough cut of the
 * full film is available at every stage of production. Manifest `overlays`
 * composite above the base visual (the S1b logo reveal over the presenter,
 * the S6b end card holding after her close).
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
            {scene.overlays?.map((overlay) => (
              <OverlaySlot key={overlay.graphic} overlay={overlay} sceneFrames={duration} />
            ))}
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

/**
 * One timed overlay. An unregistered graphic renders nothing rather than
 * a slate — an overlay must never blank the base visual it decorates.
 */
const OverlaySlot = ({ overlay, sceneFrames }: { overlay: Overlay; sceneFrames: number }) => {
  const Graphic = GRAPHICS[overlay.graphic];
  if (Graphic === undefined) return null;
  const from = Math.round(overlay.atSec * FPS);
  const frames =
    overlay.durationSec !== undefined ? Math.round(overlay.durationSec * FPS) : sceneFrames - from;
  if (frames <= 0) return null;
  return (
    <Sequence from={from} durationInFrames={frames} name={overlay.graphic}>
      <Graphic durationInFrames={frames} />
    </Sequence>
  );
};
