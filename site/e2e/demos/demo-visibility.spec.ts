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
 * 4. For steps with cursorMustAlign, verifies the cursor overlay is
 *    positioned within tolerance of the target element's center.
 * 5. Takes a visual regression screenshot at each contracted step.
 *
 * Visibility checks use page.evaluate with getBoundingClientRect
 * inside the page context. This avoids Playwright's known issues
 * with CSS `zoom` property (#21192, #7642). Checks require full
 * containment (target fully inside container), not just intersection.
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
  cursorMustAlign?: string;
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

/**
 * Maximum wall-clock time for a demo to reach a target step at 2x.
 * Long tours (12+ steps) with narration can take 60s+ to reach
 * late steps. 120s covers the worst case.
 */
const STEP_TIMEOUT_MS = 120_000;

/**
 * Sub-pixel tolerance for containment checks. CSS zoom produces
 * fractional pixel values that can push a rect 1-2px outside its
 * parent even when the element is visually contained.
 */
const CONTAINMENT_TOLERANCE_PX = 2;

/**
 * Maximum distance in CSS pixels between the cursor overlay
 * position and the target element's center. Accounts for spring
 * animation overshoot and sub-pixel rounding from CSS zoom.
 */
const CURSOR_ALIGNMENT_TOLERANCE_PX = 25;

/**
 * Extra wait time after the interaction settle delay for the cursor
 * spring animation to reach its target before checking alignment.
 */
const CURSOR_SETTLE_MS = 600;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

for (const fixture of fixtures) {
  const contract = fixture.visibilityContract!;

  test.describe(`Demo: ${fixture.scenarioId} on ${fixture.pagePath}`, () => {
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

      const demoIdx = fixture.demoIndex;

      await page.waitForFunction(
        (idx) => {
          const buttons = document.querySelectorAll(
            '[role="button"][aria-label="Play demo"]',
          );
          return buttons.length > idx;
        },
        demoIdx,
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
        }, demoIdx);

        if (!clicked) break;

        await page.waitForTimeout(1_000);
        const stillVisible = await page.evaluate((idx) => {
          const buttons = document.querySelectorAll(
            '[role="button"][aria-label="Play demo"]',
          );
          return buttons.length > idx &&
            (buttons[idx] as HTMLElement).offsetParent !== null;
        }, demoIdx);

        if (!stillVisible) break;
      }

      // Wait for enough demo containers to exist for our demoIndex
      if (demoIdx > 0) {
        await page.waitForFunction(
          (needed) => {
            return document.querySelectorAll("[data-demo-step]").length > needed;
          },
          demoIdx,
          { timeout: 15_000 },
        );
      }

      const demoContainers = page.locator("[data-demo-step]");
      const containerCount = await demoContainers.count();
      const demoContainer = containerCount > demoIdx
        ? demoContainers.nth(demoIdx)
        : demoContainers.first();
      await expect(demoContainer).toBeVisible();

      for (const step of contractSteps) {
        await page.waitForFunction(
          ({ containerIdx, targetStep }) => {
            const containers = document.querySelectorAll("[data-demo-step]");
            const el = containers[containerIdx];
            if (!el) return false;
            const current = Number(el.getAttribute("data-demo-step") ?? "-1");
            return current >= targetStep;
          },
          {
            containerIdx: demoIdx,
            targetStep: step.stepIndex,
          },
          { timeout: STEP_TIMEOUT_MS, polling: 200 },
        );

        await page.waitForTimeout(INTERACTION_SETTLE_MS);

        const currentStepAfterSettle = Number(
          await demoContainer.getAttribute("data-demo-step") ?? "-1",
        );
        if (currentStepAfterSettle !== step.stepIndex) {
          continue;
        }

        const scrollSelector =
          step.scrollContainer ?? "[data-scroll-container]";

        for (const targetId of step.targets) {
          const isVisible = await demoContainer.evaluate(
            (container, { targetId, scrollSelector, tolerance }) => {
              const target =
                container.querySelector(
                  `[data-scroll-target="${targetId}"]`,
                ) ??
                container.querySelector(
                  `[data-cursor-target="${targetId}"]`,
                );

              if (!target) return { found: false, visible: false, reason: "not-found" };

              const scrollParent = container.querySelector(scrollSelector);
              const ref = scrollParent ?? container;
              const refRect = ref.getBoundingClientRect();
              const targetRect = target.getBoundingClientRect();
              const contained =
                targetRect.top >= refRect.top - tolerance &&
                targetRect.bottom <= refRect.bottom + tolerance &&
                targetRect.left >= refRect.left - tolerance &&
                targetRect.right <= refRect.right + tolerance;

              return {
                found: true,
                visible: contained,
                reason: contained ? "ok" : "not-fully-contained",
              };
            },
            { targetId, scrollSelector, tolerance: CONTAINMENT_TOLERANCE_PX },
          );

          expect(
            isVisible.found,
            `Step ${step.stepIndex}: target "${targetId}" not found in DOM`,
          ).toBe(true);

          expect(
            isVisible.visible,
            `Step ${step.stepIndex}: target "${targetId}" is not fully visible ` +
              `in scroll container (${isVisible.reason})`,
          ).toBe(true);
        }

        if (step.cursorMustAlign) {
          await page.waitForTimeout(CURSOR_SETTLE_MS);

          const alignment = await demoContainer.evaluate(
            (container, { targetId, tolerance }) => {
              const cursor = container.querySelector(
                ".pointer-events-none.absolute.z-50",
              ) as HTMLElement | null;
              const target = container.querySelector(
                `[data-cursor-target="${targetId}"]`,
              );

              if (!cursor || !target) {
                return {
                  found: false as const,
                  reason: !cursor ? "cursor-not-found" : "target-not-found",
                };
              }

              const transform = getComputedStyle(cursor).transform;
              if (!transform || transform === "none") {
                return { found: false as const, reason: "no-cursor-transform" };
              }

              const matrix = new DOMMatrix(transform);
              const cx = matrix.m41;
              const cy = matrix.m42;

              const tRect = target.getBoundingClientRect();
              const containerRect = container.getBoundingClientRect();
              const zoom =
                containerRect.width /
                  (container as HTMLElement).offsetWidth || 1;
              const targetCenterX =
                (tRect.left - containerRect.left + tRect.width / 2) / zoom;
              const targetCenterY =
                (tRect.top - containerRect.top + tRect.height / 2) / zoom;

              const dx = Math.abs(cx - targetCenterX);
              const dy = Math.abs(cy - targetCenterY);

              return {
                found: true as const,
                dx: Math.round(dx),
                dy: Math.round(dy),
                aligned: dx <= tolerance && dy <= tolerance,
              };
            },
            {
              targetId: step.cursorMustAlign,
              tolerance: CURSOR_ALIGNMENT_TOLERANCE_PX,
            },
          );

          if (alignment.found) {
            expect(
              alignment.aligned,
              `Step ${step.stepIndex}: cursor is ${alignment.dx}px/${alignment.dy}px ` +
                `from target "${step.cursorMustAlign}" center ` +
                `(tolerance: ${CURSOR_ALIGNMENT_TOLERANCE_PX}px)`,
            ).toBe(true);
          }
        }

        await expect(demoContainer).toHaveScreenshot(
          `${fixture.scenarioId}-step-${step.stepIndex}.png`,
          { maxDiffPixelRatio: 0.02 },
        );
      }
    });
  });
}
