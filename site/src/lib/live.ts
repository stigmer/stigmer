/**
 * The demos the docs embed live, by name, and the one place each demo's
 * address is made.
 *
 * The list is the visual suite's (test/visual/src/live.ts): a demo is a
 * gallery scene drawn by the code the screenshot check approves, built by
 * the site's build into `public/gallery` (scripts/generate-gallery.ts) and
 * framed in its docs mode. `<Live>` and `<ThemePlayground>` frame them, and
 * the markdown exports link them in the tag's place (`cleanContent` in
 * ./llms-pages.ts); all three name the addresses through this module, so
 * they cannot disagree on one.
 */
export {
  DEFAULT_LIVE_THEME,
  LIVE,
  LIVE_BASE,
  LIVE_MODES,
  LIVE_PRESETS,
  LIVE_READY_MESSAGE,
  LIVE_THEME_MESSAGE,
  isLiveReadyMessage,
  liveDemo,
  liveUrl,
  type LiveDemo,
  type LiveMode,
  type LivePreset,
  type LiveTheme,
  type LiveThemeMessage,
} from "../../../test/visual/src/live";

/** What every live demo says under it: no reader mistakes it for an agent at work. */
export const LIVE_CAPTION = "A scripted replay; no agent is running.";
