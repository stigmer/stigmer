// ---------------------------------------------------------------------------
// Per-element UA-default resets for preflight-less hosts (#695).
// Internal — never exported from the package barrel.
//
// Why these are per-component classes and NOT stylesheet rules: the #374
// scoped form-control preflight in `styles.css` could reset every button
// under `.stgm` because UA control chrome is never wanted. Lists are
// different — "UI list" vs "content list" is a semantic distinction CSS
// scoping cannot express. The documented quickstart wraps the host's whole
// app in `StigmerProvider`, so a `.stgm ul { list-style: none }` rule would
// strip the bullets off the HOST's own content. Every SDK-rendered UI list
// therefore declares its own reset (enforced by the `stigmer/require-list-reset`
// lint rule); markdown-rendered content lists instead declare their bullets
// explicitly (`stg:list-disc stg:pl-5 ...` in markdown-components.tsx).
// ---------------------------------------------------------------------------

/**
 * UA-default reset for a UI `<ul>`/`<ol>` (no bullets, no indent, no
 * margins). Without it, a host that ships no global CSS reset renders list
 * markers and ~40px of `padding-inline-start` on every SDK list — invisible
 * on first-party surfaces (console, desktop, docs tours all ship global
 * resets), broken in exactly the third-party embeds the SDK exists for.
 * Spacing utilities (`stg:space-y-*`, `stg:p-*`) compose on top.
 */
export const UNSTYLED_LIST = "stg:m-0 stg:list-none stg:p-0";

/**
 * UA-default reset for `<fieldset>` (margin-inline, padding, and
 * `min-inline-size: min-content` — the last one silently breaks flex/grid
 * shrinking). The UA border is already cleared by the `.stgm *` border reset
 * in `styles.css`, so it is not repeated here.
 */
export const UNSTYLED_FIELDSET = "stg:m-0 stg:min-w-0 stg:p-0";
