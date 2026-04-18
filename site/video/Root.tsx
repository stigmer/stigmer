import { Composition } from "remotion";
import { HelloWorld } from "./compositions/HelloWorld";
import { DemoVideo } from "./compositions/DemoVideo";
import { computeTimeline } from "./lib/timeline";
import type { NarrationManifest } from "@scenar/react";

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

// ---------------------------------------------------------------------------
// Auto-discover scenarios via webpack require.context so new scenarios
// are picked up automatically — no manual registration required.
//
// Convention: a directory under scenarios/ is a renderable scenario if it
// contains a steps.ts file. The matching narration manifest lives at
// public/demos/<id>/manifest.json (produced by `make generate-narration`).
// ---------------------------------------------------------------------------

interface RequireContext {
  keys(): string[];
  (id: string): Record<string, unknown>;
}

const requireWithContext = require as unknown as {
  context(dir: string, deep: boolean, filter: RegExp): RequireContext;
};

const stepsCtx = requireWithContext.context(
  "../src/components/docs/demos/scenarios",
  true,
  /^\.\/[^/]+\/steps\.ts$/,
);

const manifestCtx = requireWithContext.context(
  "../public/demos",
  true,
  /^\.\/[^/]+\/manifest\.json$/,
);

const manifestKeys = new Set<string>(manifestCtx.keys());

/**
 * Find the ScenarioStep[] export in a steps module.
 *
 * Every steps.ts exports exactly one array whose elements carry a
 * `delayMs` property (the ScenarioStep shape). Other exports are
 * types (erased), helper functions, string constants, etc.
 */
function extractSteps(
  mod: Record<string, unknown>,
): readonly { delayMs: number }[] {
  for (const val of Object.values(mod)) {
    if (
      Array.isArray(val) &&
      val.length > 0 &&
      typeof (val[0] as Record<string, unknown>)?.delayMs === "number"
    ) {
      return val as readonly { delayMs: number }[];
    }
  }
  throw new Error("No ScenarioStep[] export found in steps module");
}

const scenarios = (stepsCtx.keys() as string[])
  .map((key: string) => {
    const id = key.replace(/^\.\//, "").replace(/\/steps\.ts$/, "");
    const steps = extractSteps(stepsCtx(key));
    const manifestKey = `./${id}/manifest.json`;
    const manifest: NarrationManifest | null = manifestKeys.has(manifestKey)
      ? (manifestCtx(manifestKey) as NarrationManifest)
      : null;
    return { id, timeline: computeTimeline(steps, manifest, FPS) };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HelloWorld"
        component={HelloWorld}
        durationInFrames={90}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      {scenarios.map(({ id, timeline }) => (
        <Composition
          key={id}
          id={id}
          component={DemoVideo}
          durationInFrames={timeline.totalFrames}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
          defaultProps={{ scenarioId: id, timeline }}
        />
      ))}
    </>
  );
};
