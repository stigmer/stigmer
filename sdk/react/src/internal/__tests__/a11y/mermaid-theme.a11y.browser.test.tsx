// Browser-mode regression guard (runs under vitest.a11y.config.ts in real
// Chromium) for token-driven Mermaid interior theming.
//
// This is not an axe audit — it lives here because the claim can only be
// verified against real layout + a real CSS engine: that Mermaid's injected
// `themeCSS` (authored with `var(--stgm-*)`) survives `securityLevel: "strict"`
// (mermaid's `sanitizeCss` + DOMPurify) and is resolved by the browser cascade
// against the `.stgm` scope. Source analysis already proves survivability; this
// test locks it against future mermaid/DOMPurify upgrades and proves, end to
// end, that interiors track the active color mode and preset live — with no
// component re-render (we mutate the scope in the DOM, never React state).

import "../../../../dist/styles.css";
import "@stigmer/theme/presets/fintech.css";

import { describe, it, afterEach, expect } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { ColorModeContext, type ResolvedColorMode } from "../../../color-mode.js";
import { MermaidDiagram } from "../../MermaidDiagram.js";

const CHART = "flowchart LR\n  A[Hello] --> B[World]";

const NODE_SHAPE_SELECTOR =
  "svg .node rect, svg .node polygon, svg .node circle, svg .node ellipse, svg .node path";

interface Mounted {
  readonly container: HTMLElement;
  /** The painted node shape whose `fill` our `themeCSS` drives from a token. */
  readonly nodeShape: SVGElement;
  /** Probe resolving `var(--stgm-muted)` (node fill) in the same scope. */
  readonly mutedProbe: HTMLElement;
  /** Probe resolving `var(--stgm-primary)` in the same scope. */
  readonly primaryProbe: HTMLElement;
}

/**
 * Render a diagram inside a `.stgm` scope carrying `scopeClass` (e.g. a preset)
 * and `mode`, alongside two probe spans that resolve the same tokens. Resolves
 * once the SVG interior has painted.
 */
async function mount(
  scopeClass: string,
  mode: ResolvedColorMode,
): Promise<Mounted> {
  const container = document.createElement("div");
  container.className = `stgm ${scopeClass}`.trim();
  container.setAttribute("data-stgm-color-mode", mode);
  document.body.appendChild(container);

  render(
    <ColorModeContext.Provider value={mode}>
      <span data-probe="muted" style={{ color: "var(--stgm-muted)" }} />
      <span data-probe="primary" style={{ color: "var(--stgm-primary)" }} />
      <MermaidDiagram chart={CHART} />
    </ColorModeContext.Provider>,
    { container },
  );

  await waitFor(() => {
    const shape = container.querySelector(NODE_SHAPE_SELECTOR);
    if (!shape) throw new Error("diagram node not rendered yet");
  });

  return {
    container,
    nodeShape: container.querySelector(NODE_SHAPE_SELECTOR) as SVGElement,
    mutedProbe: container.querySelector('[data-probe="muted"]') as HTMLElement,
    primaryProbe: container.querySelector('[data-probe="primary"]') as HTMLElement,
  };
}

afterEach(() => {
  cleanup();
  document.querySelectorAll(".stgm").forEach((node) => node.remove());
});

describe("Mermaid interior theming — token-driven, cascade-resolved", () => {
  it("paints node interiors from --stgm-* tokens, not mermaid's stock palette", async () => {
    const { nodeShape, mutedProbe } = await mount("", "light");
    // If our themeCSS lost the specificity/order battle, the fill would be
    // mermaid's default (#ECECFF-ish) and this exact-match would fail.
    expect(getComputedStyle(nodeShape).fill).toBe(
      getComputedStyle(mutedProbe).color,
    );
  });

  it("tracks a color-mode switch live, with no re-render", async () => {
    const { container, nodeShape, mutedProbe } = await mount("", "light");
    const fillLight = getComputedStyle(nodeShape).fill;
    expect(fillLight).toBe(getComputedStyle(mutedProbe).color);

    // Flip the scope attribute directly — no React update. Pure cascade.
    container.setAttribute("data-stgm-color-mode", "dark");

    const fillDark = getComputedStyle(nodeShape).fill;
    expect(fillDark).toBe(getComputedStyle(mutedProbe).color);
    expect(fillDark).not.toBe(fillLight);
  });

  it("tracks the active preset", async () => {
    const { nodeShape, mutedProbe, primaryProbe } = await mount(
      "stgm-theme-fintech",
      "light",
    );
    // The diagram is painted from the ACTIVE preset's resolved token.
    expect(getComputedStyle(nodeShape).fill).toBe(
      getComputedStyle(mutedProbe).color,
    );

    // Guard against a false pass where the preset CSS never loaded: fintech's
    // primary (indigo) must differ from the default palette's primary (teal).
    const defaultScope = document.createElement("div");
    defaultScope.className = "stgm";
    defaultScope.setAttribute("data-stgm-color-mode", "light");
    defaultScope.innerHTML = '<span style="color: var(--stgm-primary)"></span>';
    document.body.appendChild(defaultScope);

    expect(getComputedStyle(primaryProbe).color).not.toBe(
      getComputedStyle(defaultScope.firstElementChild as HTMLElement).color,
    );
  });
});
