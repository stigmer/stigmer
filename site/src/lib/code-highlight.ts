/**
 * How the site's code examples look and behave, in one place for both
 * places that draw them: the Markdown code blocks (highlighted at build time
 * by `source.config.ts`) and the theme playground's blocks (highlighted in
 * the browser by fumadocs' `DynamicCodeBlock`).
 *
 * One accessibility fix lives here (stigmer#2902): github-dark draws
 * comments in `#6a737d`, which is 3.89:1 on the site's card ground and fails
 * WCAG AA's 4.5:1. Shiki's `colorReplacements` swaps it for `#8b949e`,
 * GitHub's own current dark comment colour, and leaves every other token as
 * the theme draws it. A replacement rather than a custom theme object,
 * because the playground's block accepts bundled theme names only. The
 * replacement is keyed by theme name, so both themes are named here rather
 * than left to fumadocs' defaults. `code-highlight.test.ts` holds every
 * foreground of the dark theme to 4.5:1 on both code grounds in
 * `globals.css`.
 *
 * A code block's scroll area is made a Tab stop by `scroll-region.ts`.
 */
import type { HighlightOptionsCommon, HighlightOptionsThemes } from "fumadocs-core/highlight";

/** The Shiki options every code block on the site is highlighted with. */
export const CODE_HIGHLIGHT = {
  themes: { light: "github-light", dark: "github-dark" },
  colorReplacements: { "github-dark": { "#6a737d": "#8b949e" } },
} satisfies Omit<HighlightOptionsCommon, "lang"> & HighlightOptionsThemes;
