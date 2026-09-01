import { Composition, getStaticFiles, staticFile } from "remotion";
import { FPS, HEIGHT, WIDTH } from "../films/intro/manifest";
import { IntroFilm } from "./films/intro/IntroFilm";
import type { NarrationManifest } from "./films/intro/durations";
import { totalDuration } from "./films/intro/durations";

/**
 * Narration manifest is a generated file (gitignored), so it is loaded at
 * composition-metadata time rather than imported: a fresh clone renders the
 * placeholder cut with planned durations, and `npm run narrate` upgrades the
 * same composition to exact audio timing with no code change.
 */
const loadNarration = async (): Promise<NarrationManifest | null> => {
  const exists = getStaticFiles().some((f) => f.name === "narration/manifest.json");
  if (!exists) {
    return null;
  }
  const res = await fetch(staticFile("narration/manifest.json"));
  return (await res.json()) as NarrationManifest;
};

export const Root = () => (
  <Composition
    id="IntroToStigmer"
    component={IntroFilm}
    width={WIDTH}
    height={HEIGHT}
    fps={FPS}
    defaultProps={{ narration: null }}
    calculateMetadata={async () => {
      const narration = await loadNarration();
      return {
        durationInFrames: totalDuration(narration),
        props: { narration },
      };
    }}
  />
);
