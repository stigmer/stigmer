// Shared harness for the conversation surface's browser-mode a11y audits.
//
// The audit policy (WCAG 2.0 A/AA via axe-core, fail on critical/serious,
// log the rest, `color-contrast` advisory pending the app-wide token
// contrast pass) is the workspace suite's — see
// `src/workspace/__tests__/a11y/harness.tsx`, the canonical statement of
// the policy and its rationale. This is the SECOND a11y suite; per the
// house third-call-site rule the shared extraction happens when a third
// surface needs it, not speculatively here.

import "../../../../dist/styles.css";

import { render, cleanup } from "@testing-library/react";
import type { ReactElement } from "react";
import axe from "axe-core";
import { expect } from "vitest";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../../context.js";

/** The color modes every state is audited under. */
export const COLOR_MODES = ["light", "dark"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

/** See the workspace harness for why contrast stays advisory for now. */
const ADVISORY_RULE_IDS = new Set<string>(["color-contrast"]);

// The audited components are presentational (data arrives as props), so no
// client method is ever invoked — but `useStigmer` throws outside a
// provider, so a stub context is still required.
const stubClient = {} as unknown as Stigmer;

/**
 * Render `ui` inside a themed `.stgm` container for the given color mode,
 * attached to the live DOM so both `screen` queries and axe can see it.
 */
export function renderAudited(ui: ReactElement, mode: ColorMode): HTMLElement {
  const container = document.createElement("div");
  container.className = "stgm";
  container.setAttribute("data-stgm-color-mode", mode);
  container.style.background = "var(--stgm-background)";
  container.style.color = "var(--stgm-foreground)";
  // A real box for the flex/scroll panes to lay out in.
  container.style.height = "720px";
  container.style.width = "1024px";
  document.body.appendChild(container);

  render(<StigmerContext.Provider value={stubClient}>{ui}</StigmerContext.Provider>, {
    container,
  });
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
 * critical/serious violation; logs moderate/minor and advisory rules.
 */
export async function auditA11y(container: HTMLElement, label: string): Promise<void> {
  const results = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
  });

  const serious = results.violations.filter(
    (v) =>
      (v.impact === "critical" || v.impact === "serious") &&
      !ADVISORY_RULE_IDS.has(v.id),
  );
  const advisory = results.violations.filter(
    (v) =>
      ADVISORY_RULE_IDS.has(v.id) ||
      v.impact === "moderate" ||
      v.impact === "minor",
  );

  if (advisory.length > 0) {
    console.warn(`[a11y: ${label}] non-blocking violations:\n${summarize(advisory)}`);
  }

  expect(
    serious,
    `[a11y: ${label}] critical/serious axe violations:\n${summarize(serious)}`,
  ).toHaveLength(0);
}

/** Reset cross-test state; call in `afterEach`. */
export function resetConversationAudit(): void {
  cleanup();
  document.querySelectorAll(".stgm").forEach((node) => node.remove());
}
