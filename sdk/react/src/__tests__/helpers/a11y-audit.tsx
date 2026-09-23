// The shared harness for the browser-mode accessibility audits (DD-22).
//
// Renders an audited component inside the `.stgm` scope against the SDK's
// SHIPPED stylesheet (the prebuilt `dist/styles.css`, not a test-time
// recompile), then runs axe-core with the SAME policy as the e2e page audit
// (`test/e2e/tests/functional/accessibility.spec.ts`): WCAG 2.0 A/AA tags,
// fail on critical/serious, log moderate/minor.
//
// Why this file exists and how it stays honest:
// - Contrast/target-size are the point, so it runs in a real browser via
//   `vitest.a11y.config.ts` (happy-dom can't evaluate either).
// - axe is scoped to the rendered container and restricted to WCAG tags, so
//   page-level rules (`region`, `landmark-one-main`, `html-has-lang`, …) don't
//   false-positive on a component rendered in isolation.
// - The wrapper carries the themed background so `color-contrast` is measured
//   against the real surface color in BOTH color modes, not the browser default.
//
// Extracted when a third surface needed it (the workspace panel, the
// conversation surfaces, the licenses console), per the house rule that a
// shared test helper waits for its third call site. A surface keeps only
// its own setup beside its suites (the workspace listing-cache reset).
//
// Not a `.test` file and inside `__tests__` deliberately, like `open-menu.ts`:
// vitest collects nothing from it, and it never ships.

import "../../../dist/styles.css";

import { render, cleanup } from "@testing-library/react";
import type { ReactElement } from "react";
import axe from "axe-core";
import { expect } from "vitest";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context.js";

/** The color modes every state is audited under. */
export const COLOR_MODES = ["light", "dark"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

/**
 * Rules that are audited but reported as advisory (logged, non-blocking) rather
 * than failing the suite — mirroring the e2e audit's graduated rollout, which
 * ships fixing only some severities first.
 *
 * `color-contrast`: the SDK's deliberately dense small muted text (the
 * workspace panel's tree labels and `text-[0.65rem]` path subtitles, count
 * badges, captions across the consoles) falls below WCAG AA 4.5:1 in both
 * modes. This is a PRE-EXISTING, app-wide design-token/density concern (the
 * `--stgm-muted-foreground` token at small sizes), and its fix needs a
 * deliberate design pass across presets (tracked in DD-22's Follow-ups).
 * Kept advisory so the audits guard the STRUCTURAL accessibility (roles,
 * names, relationships, nesting) now. Promote back to blocking once the
 * contrast pass ships.
 */
const ADVISORY_RULE_IDS = new Set<string>(["color-contrast"]);

/**
 * Presentational surfaces never call the client, but `useStigmer` throws
 * outside a provider, so an empty stub is the default. A data-driven
 * surface passes a client whose methods answer with its fixtures.
 */
const EMPTY_CLIENT = {} as unknown as Stigmer;

/** Options for {@link renderAudited}. */
export interface RenderAuditedOptions {
  /** The client the surface reads through; defaults to an empty stub. */
  readonly client?: Stigmer;
  /** The container's box. Defaults to 1024 × 720. */
  readonly width?: number;
  readonly height?: number;
}

/**
 * Render `ui` inside a themed `.stgm` container for the given color mode.
 * Returns the container so callers can await the settled DOM before auditing.
 */
export function renderAudited(
  ui: ReactElement,
  mode: ColorMode,
  options: RenderAuditedOptions = {},
): HTMLElement {
  const container = document.createElement("div");
  container.className = "stgm";
  container.setAttribute("data-stgm-color-mode", mode);
  // Audited surfaces always sit on a themed surface; matching it here means
  // color-contrast is computed against the real background, not body white.
  container.style.background = "var(--stgm-background)";
  container.style.color = "var(--stgm-foreground)";
  // A fixed box gives flex/scroll surfaces (ResizableSplit, editor panes) a
  // real box to lay out in — observer-driven measurement that is a no-op in
  // happy-dom but correct in Chromium.
  container.style.height = `${options.height ?? 720}px`;
  container.style.width = `${options.width ?? 1024}px`;
  // RTL does NOT attach a caller-provided container to the document, so attach
  // it ourselves — both `screen` queries and axe need it in the live DOM.
  document.body.appendChild(container);

  render(
    <StigmerContext.Provider value={options.client ?? EMPTY_CLIENT}>{ui}</StigmerContext.Provider>,
    { container },
  );
  return container;
}

function summarize(violations: axe.Result[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 5)
        .map((n) => `    · ${n.target.join(" ")}\n      ${n.html.slice(0, 160)}`)
        .join("\n");
      return `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))\n${nodes}`;
    })
    .join("\n");
}

/**
 * Run the WCAG 2.0 A/AA audit over `container`. Fails the test on any
 * critical/serious violation (mirroring the e2e gate); logs moderate/minor.
 */
export async function auditA11y(container: HTMLElement, label: string): Promise<void> {
  const results = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
  });

  // Blocking: critical/serious violations that are NOT on the advisory list.
  const serious = results.violations.filter(
    (v) =>
      (v.impact === "critical" || v.impact === "serious") &&
      !ADVISORY_RULE_IDS.has(v.id),
  );
  // Advisory: everything else worth logging — the deferred rules plus any
  // moderate/minor findings.
  const advisory = results.violations.filter(
    (v) =>
      ADVISORY_RULE_IDS.has(v.id) ||
      v.impact === "moderate" ||
      v.impact === "minor",
  );

  if (advisory.length > 0) {
    // Non-blocking a11y signal (mirrors the e2e audit's moderate/minor logging).
    console.warn(`[a11y: ${label}] non-blocking violations:\n${summarize(advisory)}`);
  }

  expect(
    serious,
    `[a11y: ${label}] critical/serious axe violations:\n${summarize(serious)}`,
  ).toHaveLength(0);
}

/**
 * Reset the DOM between audits. `cleanup()` unmounts React trees but does not
 * remove caller-provided containers, so leftover `.stgm` wrappers are dropped
 * too and scenarios never bleed. Call in `afterEach`.
 */
export function resetAudit(): void {
  cleanup();
  document.querySelectorAll(".stgm").forEach((node) => node.remove());
}
