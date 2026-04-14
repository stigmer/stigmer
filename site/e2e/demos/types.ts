/**
 * Visibility contract for a demo scenario.
 *
 * Declares which elements must be visible inside the demo's scroll
 * container at specific step indices. Steps without an entry are
 * skipped — no false positives from steps where everything is
 * already above the fold.
 */

export interface StepVisibilityAssertion {
  /**
   * `data-scroll-target` or `data-cursor-target` IDs that must be
   * visible inside the scroll container when this step is active.
   */
  targets: string[];
  /**
   * CSS selector for the scroll container to check visibility
   * against. Defaults to `[data-scroll-container]`.
   */
  scrollContainer?: string;
}

export type VisibilityContract = Record<number, StepVisibilityAssertion>;

export interface DemoFixture {
  /** Scenario ID matching the registry key. */
  scenarioId: string;
  /** URL path where the demo is embedded (e.g. "/docs/guides/..."). */
  pagePath: string;
  /** Per-step visibility assertions. Only steps with contracts are checked. */
  contract: VisibilityContract;
}
