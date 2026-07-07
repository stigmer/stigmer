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
 * Zoom applied to BrowserView shells (login pages, auth dashboards,
 * external service UIs). Slightly below 1 so the browser mockup sits
 * comfortably within the docs page without dominating the prose.
 */
export const DEMO_BROWSER_ZOOM = 0.9;

/**
 * Fixed height of the AppShell demo container in pixels.
 */
export const DEMO_SHELL_HEIGHT = 380;

/**
 * Minimum shell height for very short viewports (e.g. iPad in split
 * view). Below this threshold the sidebar content clips. Used as
 * the floor in `clamp(DEMO_SHELL_HEIGHT_MIN, 55vh, DEMO_SHELL_HEIGHT)`.
 *
 * On desktop, `55vh` exceeds DEMO_SHELL_HEIGHT so the clamp resolves
 * to the canonical 380px. On shorter viewports, it shrinks gracefully
 * down to this floor.
 */
export const DEMO_SHELL_HEIGHT_MIN = 320;

/**
 * Default height for BrowserView shells.
 *
 * Taller than DEMO_SHELL_HEIGHT because browser mockups display
 * centered cards (login, signup) that need visible top/bottom
 * margins to look like a real web page. At 420px with
 * DEMO_BROWSER_ZOOM (0.9) the rendered height is ~378px — nearly
 * identical to the original 380px shell — but the internal content
 * area grows from ~314px to ~354px, giving cards comfortable margins.
 */
export const DEMO_BROWSER_SHELL_HEIGHT = 420;

/**
 * Canonical width of the demo viewport in pixels.
 *
 * Matches Tailwind's `max-w-4xl` (56rem at 16px base = 896px).
 * Interactive demos always render at this width internally;
 * `DemoViewport` applies CSS `zoom` to scale the canonical layout
 * into the available page width. This guarantees that cursor and
 * scroll interactions compute against stable dimensions regardless
 * of the browser viewport size.
 */
export const DEMO_CANONICAL_WIDTH = 896;

/**
 * Minimum zoom factor for the docs-site viewport.
 *
 * Prevents the demo from shrinking below ~448×190px on very narrow
 * screens. The real narrow-container responsive strategy (poster
 * fallback, tap-to-expand, breakpoint system) is deferred to
 * DemoScope product design.
 */
export const DEMO_MIN_VIEWPORT_ZOOM = 0.5;

/**
 * Container classes for ScenarioPlayer-based demos (playback + tour).
 * Includes not-prose to prevent MDX prose styling from leaking in,
 * and relative positioning for cursor overlays.
 */
export const DEMO_PLAYER_CLASSES = "not-prose relative mx-auto max-w-4xl";

/**
 * Container classes for standalone SDK component demos (detail views).
 * Includes stgm scope for theme token resolution. Consumed by
 * `DemoDetailShell`, which pairs the scope with the docs reader's
 * color mode (`data-stgm-color-mode`) — use that component rather
 * than these classes directly.
 */
export const DEMO_DETAIL_CLASSES =
  "stgm not-prose overflow-hidden rounded-lg border border-border";
