/**
 * Playback smoke tests for all demo scenarios.
 *
 * Reads the auto-generated demo-manifest.json (produced by
 * validate-demos.ts) and runs a single-pass test per demo:
 *
 * 1. Navigate to the docs page with ?__test_speed=4 for acceleration.
 * 2. Verify the demo player renders and the play button is visible.
 * 3. Start playback, confirm poster disappears.
 * 4. Verify playback reaches the final step without uncaught JS errors.
 *
 * Static detail views (no ScenarioPlayer) are tested with a simpler
 * render-only check.
 *
 * This spec makes NO geometry assertions. Whether a step actually
 * shows its content to the viewer is the job of demo-visibility.spec.ts,
 * which checks the per-step contracts auto-derived from each scenario's
 * scroll/cursor interactions. Asserting geometry here (as an earlier
 * revision did, for every target at every step) is unsound: content
 * taller than the scroll container can never show its top and bottom
 * targets simultaneously, and background targets are legitimately
 * off-screen during dialog steps.
 */

import * as fs from "fs";
import * as path from "path";
import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Manifest loading
// ---------------------------------------------------------------------------

interface ManifestEntry {
  scenarioId: string;
  pagePath: string;
  demoIndex: number;
}

const MANIFEST_PATH = path.join(__dirname, "demo-manifest.json");

function loadManifest(): ManifestEntry[] {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(
      "demo-manifest.json not found. Run `yarn validate-demos` first.",
    );
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
}

const manifest = loadManifest();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Playback speed multiplier passed via URL param. */
const TEST_SPEED = 4;

/**
 * Maximum wall-clock time for a full accelerated demo playback.
 * Long tours (12+ steps) with narration need most of this at 4x.
 * 90s covers the worst case.
 */
const PLAYBACK_TIMEOUT_MS = 90_000;

/** Interval between playback-progress polls. */
const POLL_INTERVAL_MS = 300;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

for (const entry of manifest) {
  // demoIndex disambiguates pages that embed the same scenario twice
  // (e.g. review-payload-gate renders two demos on review-payloads).
  test(`${entry.scenarioId} #${entry.demoIndex} on ${entry.pagePath}`, async ({ page }) => {
    test.setTimeout(PLAYBACK_TIMEOUT_MS + 30_000);

    const pageErrors = collectPageErrors(page);
    const pageUrl = `${entry.pagePath}?__test_speed=${TEST_SPEED}`;
    await page.goto(pageUrl, { waitUntil: "networkidle" });

    // Find the Nth play button on the page. The poster label depends on
    // narration: "Play demo" for silent demos, "Play walkthrough with
    // narration" for narrated ones — match both.
    const playButtons = page.getByRole("button", { name: /^Play / });
    const buttonCount = await playButtons.count();

    if (buttonCount <= entry.demoIndex) {
      // Static detail view (no ScenarioPlayer) — just verify no errors
      const criticalErrors = pageErrors.filter(
        (e) => !e.includes("ResizeObserver"),
      );
      expect(
        criticalErrors,
        `JS errors on page load:\n${criticalErrors.join("\n")}`,
      ).toHaveLength(0);
      return;
    }

    // Wait for the Nth play button, then start playback via JS.
    // We use page.evaluate for both scroll and click because
    // Playwright's locator actions hang on some pages where CSS
    // zoom + fumadocs Steps layout cause actionability check issues.
    await page.waitForFunction(
      (idx) => {
        const buttons = document.querySelectorAll(
          '[role="button"][aria-label^="Play "]',
        );
        return buttons.length > idx;
      },
      entry.demoIndex,
      { timeout: 15_000 },
    );

    for (let attempt = 0; attempt < 5; attempt++) {
      const clicked = await page.evaluate((idx) => {
        const buttons = document.querySelectorAll(
          '[role="button"][aria-label^="Play "]',
        );
        const btn = buttons[idx] as HTMLElement | undefined;
        if (!btn) return false;
        btn.scrollIntoView({ block: "center", behavior: "instant" });
        btn.click();
        return true;
      }, entry.demoIndex);

      if (!clicked) break;

      // Check if poster disappeared (playback started)
      await page.waitForTimeout(1_000);
      const stillVisible = await page.evaluate((idx) => {
        const buttons = document.querySelectorAll(
          '[role="button"][aria-label^="Play "]',
        );
        return buttons.length > idx &&
          (buttons[idx] as HTMLElement).offsetParent !== null;
      }, entry.demoIndex);

      if (!stillVisible) break;
    }

    // Locate the demo container via data attributes
    const demoContainers = page.locator("[data-demo-step]");
    const containerCount = await demoContainers.count();
    const demoContainer = containerCount > entry.demoIndex
      ? demoContainers.nth(entry.demoIndex)
      : demoContainers.first();

    await expect(demoContainer).toBeVisible();

    const totalSteps = Number(
      await demoContainer.getAttribute("data-demo-total-steps") ?? "1",
    );

    // Let the demo play through; done when it pauses on the last step.
    let completed = false;
    let lastObservedStep = -1;
    const startTime = Date.now();

    while (Date.now() - startTime < PLAYBACK_TIMEOUT_MS) {
      const currentStep = Number(
        await demoContainer.getAttribute("data-demo-step") ?? "0",
      );
      const state = await demoContainer.getAttribute("data-demo-state");
      lastObservedStep = currentStep;

      if (state === "paused" && currentStep >= totalSteps - 1) {
        completed = true;
        break;
      }

      await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    expect(
      completed,
      `Playback did not reach the final step within ` +
        `${PLAYBACK_TIMEOUT_MS}ms (stopped at step ${lastObservedStep} ` +
        `of ${totalSteps})`,
    ).toBe(true);

    // Assert no JS errors during playback
    const criticalErrors = pageErrors.filter(
      (e) => !e.includes("ResizeObserver"),
    );
    expect(
      criticalErrors,
      `JS errors during playback:\n${criticalErrors.join("\n")}`,
    ).toHaveLength(0);
  });
}
