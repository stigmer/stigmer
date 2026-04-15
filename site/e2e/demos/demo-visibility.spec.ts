/**
 * Targeted visibility contract tests for demo scenarios.
 *
 * Reads the auto-generated demo-manifest.json and filters for entries
 * with a visibilityContract (originating from co-located visibility.json
 * files in each scenario directory). For each:
 *
 * 1. Navigates to the docs page with accelerated playback.
 * 2. Starts playback by clicking the poster play button.
 * 3. At each contracted step (detected via data-demo-step), waits for
 *    mid-step interactions to settle, then asserts that declared target
 *    elements are visible inside the demo's scroll container.
 * 4. Takes a visual regression screenshot at each contracted step.
 *
 * Visibility checks use page.evaluate with getBoundingClientRect
 * inside the page context. This avoids Playwright's known issues
 * with CSS `zoom` property (#21192, #7642).
 *
 * This suite complements demo.spec.ts (which auto-checks all scroll
 * targets) by additionally verifying specific cursor targets and
 * capturing screenshot baselines for visual regression.
 */

import * as fs from "fs";
import * as path from "path";
import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Manifest loading
// ---------------------------------------------------------------------------

interface StepAssertion {
  targets: string[];
  scrollContainer?: string;
}

interface ManifestEntry {
  scenarioId: string;
  pagePath: string;
  demoIndex: number;
  visibilityContract?: Record<string, StepAssertion>;
}

const MANIFEST_PATH = path.join(__dirname, "demo-manifest.json");

function loadFixtures(): ManifestEntry[] {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(
      "demo-manifest.json not found. Run `yarn validate-demos` first.",
    );
  }
  const all: ManifestEntry[] = JSON.parse(
    fs.readFileSync(MANIFEST_PATH, "utf-8"),
  );
  return all.filter((e) => e.visibilityContract);
}

const fixtures = loadFixtures();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Playback speed — lower than demo.spec.ts because visibility
 * contracts need to check mid-step interaction results (scroll-to,
 * set-cursor) which fire partway through a step. At 4x, short steps
 * can complete before the settle check, unmounting the target content.
 */
const TEST_SPEED = 2;

/**
 * Time to wait after a step transition for mid-step interactions
 * to fire and smooth scroll to settle. At 2x speed, most interactions
 * fire within the first 50-55% of step duration (~1-2s) and scroll
 * animations are constant (~300-500ms).
 */
const INTERACTION_SETTLE_MS = 1_500;

/** Maximum wall-clock time for a demo to reach a target step at 2x. */
const STEP_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

for (const fixture of fixtures) {
  const contract = fixture.visibilityContract!;

  test.describe(`Demo: ${fixture.scenarioId}`, () => {
    const contractSteps = Object.entries(contract).map(
      ([stepStr, assertion]) => ({
        stepIndex: Number(stepStr),
        ...assertion,
      }),
    );

    if (contractSteps.length === 0) return;

    test(`visibility contract holds for all contracted steps`, async ({
      page,
    }) => {
      test.setTimeout(STEP_TIMEOUT_MS * contractSteps.length + 30_000);

      const pageUrl = `${fixture.pagePath}?__test_speed=${TEST_SPEED}`;
      await page.goto(pageUrl, { waitUntil: "networkidle" });

      // Wait for the play button to appear
      await page.waitForFunction(() => {
        const buttons = document.querySelectorAll(
          '[role="button"][aria-label="Play demo"]',
        );
        return buttons.length > 0;
      }, undefined, { timeout: 15_000 });

      // Click via JS to avoid actionability issues on some pages
      for (let attempt = 0; attempt < 5; attempt++) {
        await page.evaluate(() => {
          const btn = document.querySelector(
            '[role="button"][aria-label="Play demo"]',
          ) as HTMLElement | null;
          if (btn) {
            btn.scrollIntoView({ block: "center", behavior: "instant" });
            btn.click();
          }
        });
        await page.waitForTimeout(1_000);
        const gone = await page.evaluate(() => {
          const btn = document.querySelector(
            '[role="button"][aria-label="Play demo"]',
          );
          return !btn || (btn as HTMLElement).offsetParent === null;
        });
        if (gone) break;
      }

      const demoContainer = page.locator("[data-demo-step]").first();
      await expect(demoContainer).toBeVisible();

      for (const step of contractSteps) {
        await page.waitForFunction(
          ({ containerSelector, targetStep }) => {
            const el = document.querySelector(containerSelector);
            if (!el) return false;
            const current = Number(el.getAttribute("data-demo-step") ?? "-1");
            return current >= targetStep;
          },
          {
            containerSelector: "[data-demo-step]",
            targetStep: step.stepIndex,
          },
          { timeout: STEP_TIMEOUT_MS, polling: 200 },
        );

        await page.waitForTimeout(INTERACTION_SETTLE_MS);

        const scrollSelector =
          step.scrollContainer ?? "[data-scroll-container]";

        for (const targetId of step.targets) {
          const isVisible = await demoContainer.evaluate(
            (container, { targetId, scrollSelector }) => {
              const target =
                container.querySelector(
                  `[data-scroll-target="${targetId}"]`,
                ) ??
                container.querySelector(
                  `[data-cursor-target="${targetId}"]`,
                );

              if (!target) return { found: false, visible: false, reason: "not-found" };

              const scrollParent = container.querySelector(scrollSelector);
              if (!scrollParent) {
                const rect = target.getBoundingClientRect();
                const inViewport =
                  rect.top < window.innerHeight &&
                  rect.bottom > 0 &&
                  rect.left < window.innerWidth &&
                  rect.right > 0;
                return { found: true, visible: inViewport, reason: inViewport ? "ok" : "out-of-viewport" };
              }

              const containerRect = scrollParent.getBoundingClientRect();
              const targetRect = target.getBoundingClientRect();
              const visible =
                targetRect.top < containerRect.bottom &&
                targetRect.bottom > containerRect.top &&
                targetRect.left < containerRect.right &&
                targetRect.right > containerRect.left;

              return { found: true, visible, reason: visible ? "ok" : "out-of-scroll-container" };
            },
            { targetId, scrollSelector },
          );

          expect(
            isVisible.found,
            `Step ${step.stepIndex}: target "${targetId}" not found in DOM`,
          ).toBe(true);

          expect(
            isVisible.visible,
            `Step ${step.stepIndex}: target "${targetId}" is not visible ` +
              `in scroll container (${isVisible.reason})`,
          ).toBe(true);
        }

        await expect(demoContainer).toHaveScreenshot(
          `${fixture.scenarioId}-step-${step.stepIndex}.png`,
          { maxDiffPixelRatio: 0.02 },
        );
      }
    });
  });
}
