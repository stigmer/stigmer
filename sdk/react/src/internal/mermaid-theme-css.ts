/**
 * Token-driven `themeCSS` for Mermaid diagram interiors.
 *
 * Mermaid's built-in `default`/`dark` themes color a diagram's SVG interior
 * with a fixed palette that ignores the host's `--stgm-*` preset (Corporate,
 * Fintech, ...). The obvious fix — feeding resolved tokens into Mermaid's
 * `themeVariables` — is blocked: our tokens are authored in `oklch()`, and
 * Mermaid's color engine (`khroma`) parses only hex/rgb/hsl/keyword, so it
 * throws or NaNs on `oklch(...)`. (Mermaid also gates every `themeVariables`
 * value through the allowlist `^[\d "#%(),.;A-Za-z]+$`, which excludes `-` and
 * would blank any `var(--...)`.)
 *
 * Instead we hand Mermaid this CSS via `initialize({ themeCSS })`. Mermaid
 * injects it into the diagram's own `<style>` block, scoped under the render
 * id (`#stgm-mermaid-N`), *after* the theme palette it computes. Because every
 * selector in that block is id-prefixed, our rules and the palette's rules sit
 * at equal specificity, so ours win by source order — and `!important` makes
 * that bulletproof against the few palette rules that are themselves important
 * or inlined. Crucially, `themeCSS` never passes through khroma, so the
 * `oklch()`-backed `var(--stgm-*)` references flow straight to the browser,
 * which resolves them against the `.stgm` scope the SVG lives in. That is why
 * interiors track the active preset *and* color mode live, with no JS color
 * reading and no re-render on theme change.
 *
 * `initialize({ theme })` still selects the built-in `default`/`dark` theme as
 * the base, so any element or diagram type we do not target here degrades to
 * Mermaid's stock palette — never a blank or mis-colored diagram.
 *
 * Palette intent (subtle surfaces + brand accents — legibility over brand
 * saturation): node/actor bodies sit on a muted surface with quiet
 * token-colored borders and edges; labels use the standard foreground; the
 * brand `--stgm-primary` is reserved for structural headers (subgraph/cluster
 * titles, sequence loop/section titles, the sequence-number badge).
 *
 * Coverage is the two families agents emit overwhelmingly — flowchart and
 * sequence — plus the shared marker/edge-label chrome. Both label render paths
 * are handled: SVG `text`/`tspan` (via `fill`) and HTML labels inside
 * `foreignObject` (via `color`).
 */
export const MERMAID_THEME_CSS = `
  /* Shared: edge arrowheads / markers */
  .marker {
    fill: var(--stgm-border) !important;
    stroke: var(--stgm-border) !important;
  }
  .marker.cross {
    stroke: var(--stgm-border) !important;
  }

  /* Flowchart: node bodies */
  .node rect,
  .node circle,
  .node ellipse,
  .node polygon,
  .node path {
    fill: var(--stgm-muted) !important;
    stroke: var(--stgm-border) !important;
  }
  .node .neo-node {
    stroke: var(--stgm-border) !important;
  }
  .node .katex path {
    fill: var(--stgm-foreground) !important;
    stroke: var(--stgm-foreground) !important;
  }

  /* Flowchart: node labels (SVG text and HTML spans) */
  .label {
    color: var(--stgm-foreground) !important;
  }
  .label text,
  .label span {
    fill: var(--stgm-foreground) !important;
    color: var(--stgm-foreground) !important;
  }

  /* Flowchart: edges */
  .edgePath .path,
  .flowchart-link {
    stroke: var(--stgm-border) !important;
  }
  .arrowheadPath,
  .root .anchor path {
    fill: var(--stgm-border) !important;
    stroke: var(--stgm-border) !important;
  }

  /* Flowchart: edge labels sit on the diagram surface for legibility */
  .edgeLabel,
  .edgeLabel p,
  .edgeLabel rect,
  .labelBkg {
    background-color: var(--stgm-card) !important;
    fill: var(--stgm-card) !important;
  }

  /* Flowchart: subgraph clusters — muted surface, brand-accent title */
  .cluster rect {
    fill: var(--stgm-muted-subtle) !important;
    stroke: var(--stgm-border) !important;
  }
  .cluster-label text,
  .cluster text {
    fill: var(--stgm-primary) !important;
  }
  .cluster-label span,
  .cluster span {
    color: var(--stgm-primary) !important;
  }

  /* Sequence: actors and lifelines */
  .actor {
    fill: var(--stgm-muted) !important;
    stroke: var(--stgm-border) !important;
  }
  text.actor > tspan {
    fill: var(--stgm-foreground) !important;
  }
  .actor-line {
    stroke: var(--stgm-border) !important;
  }

  /* Sequence: messages */
  .messageLine0,
  .messageLine1 {
    stroke: var(--stgm-border) !important;
  }
  [id$="-arrowhead"] path,
  [id$="-crosshead"] path {
    fill: var(--stgm-border) !important;
    stroke: var(--stgm-border) !important;
  }
  .messageText {
    fill: var(--stgm-foreground) !important;
  }

  /* Sequence: number badge — brand accent with its paired foreground */
  [id$="-sequencenumber"] {
    fill: var(--stgm-primary) !important;
  }
  .sequenceNumber {
    fill: var(--stgm-primary-foreground) !important;
  }

  /* Sequence: alt/opt/loop boxes and labels */
  .labelBox {
    fill: var(--stgm-muted-subtle) !important;
    stroke: var(--stgm-border) !important;
  }
  .labelText,
  .labelText > tspan {
    fill: var(--stgm-foreground) !important;
  }
  .loopText,
  .loopText > tspan,
  .sectionTitle,
  .sectionTitle > tspan {
    fill: var(--stgm-primary) !important;
  }
  .loopLine {
    stroke: var(--stgm-border) !important;
  }

  /* Sequence: notes and activations */
  .note {
    fill: var(--stgm-muted-subtle) !important;
    stroke: var(--stgm-border) !important;
  }
  .noteText,
  .noteText > tspan {
    fill: var(--stgm-foreground) !important;
  }
  .activation0,
  .activation1 {
    fill: var(--stgm-muted) !important;
    stroke: var(--stgm-border) !important;
  }
`;
