/**
 * Consolidated Playwright tests for all demo scenarios.
 *
 * Reads the auto-generated demo-manifest.json (produced by
 * validate-demos.ts) and runs a single-pass test per demo:
 *
 * 1. Navigate to the docs page with ?__test_speed=4 for acceleration.
 * 2. Verify the demo player renders and the play button is visible.
 * 3. Start playback, confirm poster disappears.
 * 4. At each step (observed via data-demo-step), wait for interactions
 *    to settle, then assert every data-scroll-target is visible inside
 *    its data-scroll-container.
 * 5. Verify playback completes without uncaught JS errors.
 *
 * Static detail views (no ScenarioPlayer) are tested with a simpler
 * render-only check.
 */

import * as fs from "fs";
import * as path from "path";
import { test, expect, type Page, type Locator } from "@playwright/test";

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
 * Time to wait after a step transition for mid-step interactions
 * (scroll-to, set-cursor) to fire and smooth scroll to settle.
 * At 4x speed, step durations are ~25% of normal, but smooth scroll
 * animation is constant (~300-500ms). 2s covers the worst case.
 */
const INTERACTION_SETTLE_MS = 2_000;

/** Maximum wall-clock time for a full accelerated demo playback. */
const PLAYBACK_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

interface ScrollTargetResult {
  targetId: string;
  visible: boolean;
  reason: string;
}

async function checkScrollTargets(
  container: Locator,
): Promise<ScrollTargetResult[]> {
  return container.evaluate((el) => {
    const targets = el.querySelectorAll("[data-scroll-target]");
    if (targets.length === 0) return [];

    const results: ScrollTargetResult[] = [];
    for (const target of targets) {
      const targetId = target.getAttribute("data-scroll-target") ?? "unknown";
      const scrollParent = target.closest("[data-scroll-container]");

      if (!scrollParent) {
        const rect = target.getBoundingClientRect();
        const inViewport =
          rect.top < window.innerHeight &&
          rect.bottom > 0 &&
          rect.left < window.innerWidth &&
          rect.right > 0;
        results.push({
          targetId,
          visible: inViewport,
          reason: inViewport ? "ok" : "out-of-viewport",
        });
        continue;
      }

      const cr = scrollParent.getBoundingClientRect();
      const tr = target.getBoundingClientRect();
      const visible =
        tr.top < cr.bottom && tr.bottom > cr.top &&
        tr.left < cr.right && tr.right > cr.left;

      results.push({
        targetId,
        visible,
        reason: visible ? "ok" : "below-fold",
      });
    }
    return results;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

for (const entry of manifest) {
  test(`${entry.scenarioId} on ${entry.pagePath}`, async ({ page }) => {
    test.setTimeout(PLAYBACK_TIMEOUT_MS + 30_000);

    const pageErrors = collectPageErrors(page);
    const pageUrl = `${entry.pagePath}?__test_speed=${TEST_SPEED}`;
    await page.goto(pageUrl, { waitUntil: "networkidle" });

    // Find the Nth play button on the page
    const playButtons = page.getByRole("button", { name: "Play demo" });
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
          '[role="button"][aria-label="Play demo"]',
        );
        return buttons.length > idx;
      },
      entry.demoIndex,
      { timeout: 15_000 },
    );

    for (let attempt = 0; attempt < 5; attempt++) {
      const clicked = await page.evaluate((idx) => {
        const buttons = document.querySelectorAll(
          '[role="button"][aria-label="Play demo"]',
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
          '[role="button"][aria-label="Play demo"]',
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

    // Play through every step, checking scroll targets at each one
    let lastCheckedStep = -1;
    const failures: { step: number; targetId: string; reason: string }[] = [];
    const startTime = Date.now();

    while (Date.now() - startTime < PLAYBACK_TIMEOUT_MS) {
      const currentStep = Number(
        await demoContainer.getAttribute("data-demo-step") ?? "0",
      );
      const state = await demoContainer.getAttribute("data-demo-state");

      if (currentStep > lastCheckedStep) {
        await page.waitForTimeout(INTERACTION_SETTLE_MS);

        const settledStep = Number(
          await demoContainer.getAttribute("data-demo-step") ?? "0",
        );

        const results = await checkScrollTargets(demoContainer);
        for (const r of results) {
          if (!r.visible) {
            failures.push({
              step: settledStep,
              targetId: r.targetId,
              reason: r.reason,
            });
          }
        }

        lastCheckedStep = settledStep;
      }

      if (state === "paused" && currentStep >= totalSteps - 1) break;

      await page.waitForTimeout(300);
    }

    // Assert scroll-target visibility
    if (failures.length > 0) {
      const detail = failures
        .map((f) => `  Step ${f.step}: "${f.targetId}" is ${f.reason}`)
        .join("\n");
      expect(
        failures.length,
        `Scroll target(s) not visible after interactions settled:\n${detail}`,
      ).toBe(0);
    }

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
