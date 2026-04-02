/**
 * Zoom applied to SDK components rendered in the AppShell main
 * content area. Chosen to fit full-featured components (MessageThread,
 * SessionComposer, ApiKeyListPanel, etc.) inside the demo container
 * without distorting typography ratios.
 */
export const DEMO_CONTENT_ZOOM = 0.82;

/**
 * Zoom applied to SDK widgets in the right sidebar (ExecutionProgress,
 * UsageWidget, ArtifactsWidget). Slightly higher because the sidebar
 * is narrower and widgets are already compact.
 */
export const DEMO_SIDEBAR_ZOOM = 0.85;

/**
 * Fixed height of the AppShell demo container in pixels.
 */
export const DEMO_SHELL_HEIGHT = 380;

/**
 * Container classes for ScenarioPlayer-based demos (playback + tour).
 * Includes not-prose to prevent MDX prose styling from leaking in,
 * and relative positioning for cursor overlays.
 */
export const DEMO_PLAYER_CLASSES = "not-prose relative mx-auto max-w-4xl";

/**
 * Container classes for standalone SDK component demos (detail views).
 * Includes stgm scope for theme token resolution.
 */
export const DEMO_DETAIL_CLASSES =
  "stgm not-prose overflow-hidden rounded-lg border border-border";
