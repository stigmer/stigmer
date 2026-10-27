// Every scene's drawing, by the catalogue's id. The map is typed by
// `SceneId`, so a scene the catalogue lists without a drawing here, or a
// drawing for an id it does not list, fails the typecheck.
import { PRESETS, THREAD_STATES, type Preset, type SceneId, type ThreadState } from "../catalog.ts";
import { inheritedOpenAiKey, ownAnthropicKey } from "../fixtures.ts";
import { composerScene, fileReviewDockScene } from "./conversation.tsx";
import { dashboardScene } from "./dashboard.tsx";
import type { Drawing } from "./drawing.ts";
import { modelSelectorScene, providerKeysLocalScene, providerKeysScene } from "./settings.tsx";
import { threadScene } from "./thread.tsx";

const threads = Object.fromEntries(THREAD_STATES.map((state) => [`thread-${state}`, () => threadScene(state)])) as Record<
  `thread-${ThreadState}`,
  () => Drawing
>;

const presets = Object.fromEntries(PRESETS.map((preset) => [`preset-${preset}`, () => threadScene("completed", preset)])) as Record<
  `preset-${Preset}`,
  () => Drawing
>;

/** Every scene's drawing, built when the page draws it. */
export const DRAWINGS: Readonly<Record<SceneId, () => Drawing>> = {
  ...threads,
  "file-review-dock": fileReviewDockScene,
  "composer-idle": () => composerScene("idle"),
  "composer-submitting": () => composerScene("submitting"),
  "composer-disabled": () => composerScene("disabled"),
  "provider-keys-none": () => providerKeysScene([]),
  "provider-keys-two": () => providerKeysScene([ownAnthropicKey(), inheritedOpenAiKey()]),
  "provider-keys-local": providerKeysLocalScene,
  "model-selector-open": modelSelectorScene,
  "dashboard-kpis": dashboardScene,
  ...presets,
};
