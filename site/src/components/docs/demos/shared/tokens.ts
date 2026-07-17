/**
 * Zoom applied to SDK components rendered in the AppShell main
 * content area. Chosen to fit full-featured components (MessageThread,
 * SessionComposer, ApiKeyListPanel, etc.) inside the demo container
 * without distorting typography ratios.
 *
 * At the 16:10 shell height the content area has enough vertical room
 * to render SDK components close to their natural size. Raising this
 * value further shrinks the virtual horizontal width available to
 * dense components (tables, list panels) — tune against those first.
 */
export const DEMO_CONTENT_ZOOM = 0.9;

/**
 * Zoom applied to SDK widgets in the right sidebar (ExecutionProgress,
 * UsageWidget, ArtifactsWidget). Slightly higher than DEMO_CONTENT_ZOOM
 * because the sidebar is narrower and widgets are already compact.
 */
export const DEMO_SIDEBAR_ZOOM = 0.92;

/**
 * Zoom applied to BrowserView shells (login pages, auth dashboards,
 * external service UIs). Slightly below 1 so the browser mockup sits
 * comfortably within the docs page without dominating the prose.
 * Kept above DEMO_CONTENT_ZOOM so hand-built browser page content
 * reads proportionally consistent with SDK components in adjacent
 * steps (visual-consistency checklist rule 4).
 */
export const DEMO_BROWSER_ZOOM = 0.95;

/**
 * Zoom applied to MobileView device frames (phone-side steps, e.g. the
 * WhatsApp conversation closing the connect-whatsapp demo). The frame
 * already derives its size from `--scenar-shell-height` and the iPhone
 * aspect ratio, so 1 renders it at full shell height; the token exists
 * so phone steps stay tunable in one place like every other shell.
 */
export const DEMO_MOBILE_ZOOM = 1;

/**
 * Fixed height of the demo player container in pixels.
 *
 * 560px at the 896px canonical width is exactly 16:10 — the aspect
 * ratio of a real application window. The earlier 380px strip
 * (~2.36:1) read as a letterboxed banner rather than a screen
 * recording; 16:10 is what makes demos feel like the real product.
 *
 * `StigmerDemoViewport` passes this into Scenar's `DemoViewport`,
 * which broadcasts it as the `--scenar-shell-height` CSS variable
 * that every shell (ManagementShell, TerminalView, CodeEditorView,
 * BrowserView, APIExchangeView, AppShell) consumes.
 */
export const DEMO_SHELL_HEIGHT = 560;

/**
 * Minimum shell height for very short viewports (e.g. iPad in split
 * view). Below this threshold the sidebar content clips. Used as the
 * floor in the `clamp(DEMO_SHELL_HEIGHT_MIN, 55vh, DEMO_SHELL_HEIGHT)`
 * fallback that shells apply when `--scenar-shell-height` is unset.
 *
 * That fallback path is live only in the Scenar preview authoring
 * host (views registered in `site/.scenar/views.custom.tsx`): on the
 * docs site `StigmerDemoViewport` always sets the CSS variable, so
 * demos render at the fixed DEMO_SHELL_HEIGHT and responsiveness
 * comes from `DemoViewport`'s width-based CSS zoom instead.
 */
export const DEMO_SHELL_HEIGHT_MIN = 320;

/**
 * Canonical width of the demo viewport in pixels.
 *
 * Matches Tailwind's `max-w-4xl` (56rem at 16px base = 896px).
 * Interactive demos always render at this width internally;
 * `DemoViewport` applies CSS `zoom` to scale the canonical layout
 * into the available page width. This guarantees that cursor and
 * scroll interactions compute against stable dimensions regardless
 * of the browser viewport size.
 *
 * `StigmerDemoViewport` passes this to `DemoViewport` explicitly —
 * this token is the source of truth, not Scenar's internal default.
 */
export const DEMO_CANONICAL_WIDTH = 896;

/**
 * Minimum zoom factor for the docs-site viewport.
 *
 * Prevents the demo from shrinking below ~448×280px on very narrow
 * screens. The real narrow-container responsive strategy (poster
 * fallback, tap-to-expand, breakpoint system) is deferred to
 * DemoScope product design.
 *
 * `StigmerDemoViewport` passes this to `DemoViewport` explicitly —
 * this token is the source of truth, not Scenar's internal default.
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
