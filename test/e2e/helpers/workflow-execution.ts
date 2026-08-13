import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export type WorkflowPhase =
  | "Pending"
  | "Running"
  | "Completed"
  | "Failed"
  | "Cancelled"
  | "Terminated"
  | "Paused";

/** The two center-column views of the redesigned execution page. */
export type CenterView = "thread" | "graph";

/**
 * Navigates to an execution's detail page and waits for the page shell.
 *
 * The center-view switcher is the readiness anchor: it renders only once
 * the execution snapshot resolved, and it is unique to this page —
 * `getByRole("status")` is NOT (the phase badge, the thread empty state,
 * and panel notices all carry that role).
 */
export async function navigateToExecution(
  page: Page,
  executionId: string,
): Promise<void> {
  await page.goto(`/executions/${executionId}`);
  // 30s: a cold Next dev server compiles the route on first hit, and
  // parallel workers can queue behind that compile.
  await getCenterViewSwitcher(page).waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

export async function waitForPhaseBadge(
  page: Page,
  phase: WorkflowPhase,
  opts?: { timeout?: number },
): Promise<void> {
  await expect(page.getByRole("status", { name: phase })).toBeVisible({
    timeout: opts?.timeout ?? 60_000,
  });
}

/**
 * Wait for the execution phase badge to show a specific phase.
 * Uses Playwright's auto-retry mechanism via expect().toBeVisible().
 */
export async function waitForPhaseTransition(
  page: Page,
  targetPhase: WorkflowPhase,
  opts?: { timeout?: number },
): Promise<void> {
  await expect(page.getByRole("status", { name: targetPhase })).toBeVisible({
    timeout: opts?.timeout ?? 15_000,
  });
}

export async function clickPause(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Pause" }).click();
}

export async function clickResume(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Resume" }).click();
}

export async function clickCancel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Cancel" }).click();
}

// ---------------------------------------------------------------------------
// Center-column views (Thread | Graph)
// ---------------------------------------------------------------------------

/**
 * The Thread|Graph switcher — a radiogroup, not a tablist (the product
 * models the two views as mutually exclusive lenses on one execution).
 */
export function getCenterViewSwitcher(page: Page): Locator {
  return page.getByRole("radiogroup", { name: "Center view" });
}

/**
 * Switches the center column to the given view. Thread is the product
 * default; the graph is mounted but CSS-hidden until selected — so every
 * graph assertion must switch first, and `toBeVisible()` (not
 * `toBeAttached()`) is the honest visibility check afterwards.
 */
export async function switchCenterView(
  page: Page,
  view: CenterView,
): Promise<void> {
  const label = view === "thread" ? "Thread" : "Graph";
  await getCenterViewSwitcher(page).getByRole("radio", { name: label }).click();
  await expect(getCenterViewWrapper(page, view)).toBeVisible();
}

/**
 * The stable wrapper of one center view (`data-center-view` is a
 * product-sanctioned hook; both wrappers stay mounted, the inactive one
 * CSS-hidden). Scope view-specific locators through this — page-wide
 * graph/thread selectors either strict-mode-collide or silently match
 * the hidden sibling.
 */
export function getCenterViewWrapper(page: Page, view: CenterView): Locator {
  return page.locator(`[data-center-view="${view}"]`);
}

/** The execution graph's React Flow canvas (visible only in Graph view). */
export function getExecutionGraph(page: Page): Locator {
  return getCenterViewWrapper(page, "graph").locator(".react-flow");
}

/** The task thread container (visible only in Thread view — the default). */
export function getExecutionThread(page: Page): Locator {
  return getCenterViewWrapper(page, "thread");
}

// ---------------------------------------------------------------------------
// Thread cards
// ---------------------------------------------------------------------------

/**
 * All task cards in the thread, in execution order. One card per STARTED
 * task — pending tasks render no card (D-T02-5).
 */
export function getThreadTaskCards(page: Page): Locator {
  return getExecutionThread(page).locator(
    '[data-cursor-target="workflow-task-row"]',
  );
}

/** The thread card of one task, matched on the task name in its header. */
export function getThreadTaskCard(page: Page, taskName: string): Locator {
  return getThreadTaskCards(page).filter({ hasText: taskName });
}

// ---------------------------------------------------------------------------
// Execution workspace panel (Artifacts / Changes / Usage)
// ---------------------------------------------------------------------------

/**
 * The header chip that toggles the execution workspace panel. Collapsed
 * is the default, so `aria-expanded` starts false.
 */
export function getPanelToggle(page: Page): Locator {
  return page.getByRole("button", { name: /Show panel|Hide panel/ });
}

/** Opens the workspace panel if it is not already open. */
export async function openExecutionPanel(page: Page): Promise<void> {
  const toggle = getPanelToggle(page);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
}

/**
 * The panel split's accessible resize handle. Only rendered interactive
 * while the panel is open (`aria-hidden` while collapsed).
 */
export function getPanelResizeHandle(page: Page): Locator {
  return page.getByRole("separator", { name: "Resize execution panel" });
}
