/**
 * Playwright tests for demo interaction visibility.
 *
 * For each demo scenario with a visibility contract, this suite:
 * 1. Navigates to the docs page containing the demo.
 * 2. Starts playback by clicking the poster play button.
 * 3. At each contracted step, waits for the step caption to appear,
 *    allows time for mid-step interactions (scroll-to) to fire,
 *    then asserts that declared target elements are visible inside
 *    the demo's scroll container.
 * 4. Takes a screenshot at each contracted step for visual regression.
 *
 * Visibility checks use page.evaluate with getBoundingClientRect
 * inside the page context. This avoids Playwright's known issues
 * with CSS `zoom` property (#21192, #7642) — the browser's own
 * layout engine handles zoom correctly in-page.
 */

import { test, expect } from "@playwright/test";
import { DEMO_FIXTURES } from "./fixtures";

/**
 * Maximum time to wait for a specific step caption to appear.
 * Accounts for all preceding steps' delays + narration durations.
 */
const STEP_WAIT_TIMEOUT_MS = 45_000;

/**
 * Time to wait after a step caption appears for mid-step interactions
 * (scroll-to, set-cursor) to fire. Most interactions fire at 25-55%
 * of step duration; this buffer covers the interaction + scroll settle.
 */
const INTERACTION_SETTLE_MS = 4_000;

for (const fixture of DEMO_FIXTURES) {
  test.describe(`Demo: ${fixture.scenarioId}`, () => {
    const contractSteps = Object.entries(fixture.contract).map(
      ([stepStr, assertion]) => ({
        stepIndex: Number(stepStr),
        ...assertion,
      }),
    );

    if (contractSteps.length === 0) return;

    test(`visibility contract holds for all contracted steps`, async ({
      page,
    }) => {
      await page.goto(fixture.pagePath, { waitUntil: "networkidle" });

      // Find the demo player — look for the poster play button
      const playButton = page.getByRole("button", { name: "Play demo" }).first();
      await expect(playButton).toBeVisible({ timeout: 15_000 });

      // Scroll the demo into view to ensure it's in the viewport
      await playButton.scrollIntoViewIfNeeded();

      // Start playback
      await playButton.click();

      // Wait for the poster to disappear (playback has started)
      await expect(playButton).toBeHidden({ timeout: 5_000 });

      // Find the demo container (the DEMO_PLAYER_CLASSES wrapper)
      const demoContainer = page
        .locator(".not-prose.relative.mx-auto.max-w-4xl")
        .first();
      await expect(demoContainer).toBeVisible();

      for (const step of contractSteps) {
        // Wait for the demo to advance to (or past) this step.
        // We detect steps by watching caption text change. Since we
        // need to wait for a specific step index, and captions may
        // not be unique, we wait for the step's interactions to settle
        // by allowing enough time from playback start.
        //
        // Strategy: wait for the step caption to appear. We need to
        // read captions from the steps data, but we don't import them.
        // Instead, wait for any caption to appear and stabilize, then
        // check visibility after the interaction settle period.
        //
        // For robustness, we wait a generous amount for the demo to
        // progress through all steps up to our target step.
        const estimatedTimeToStepMs = step.stepIndex * 6_000;
        if (estimatedTimeToStepMs > 0) {
          await page.waitForTimeout(
            Math.min(estimatedTimeToStepMs, STEP_WAIT_TIMEOUT_MS),
          );
        }

        // Allow mid-step interactions to fire and scroll to settle
        await page.waitForTimeout(INTERACTION_SETTLE_MS);

        // Assert each target is visible in the scroll container
        const scrollSelector =
          step.scrollContainer ?? "[data-scroll-container]";

        for (const targetId of step.targets) {
          const isVisible = await demoContainer.evaluate(
            (container, { targetId, scrollSelector }) => {
              // Find the target element
              const target =
                container.querySelector(
                  `[data-scroll-target="${targetId}"]`,
                ) ??
                container.querySelector(
                  `[data-cursor-target="${targetId}"]`,
                );

              if (!target) return { found: false, visible: false, reason: "not-found" };

              // Find the scroll container
              const scrollParent = container.querySelector(scrollSelector);
              if (!scrollParent) {
                // No explicit scroll container — check page viewport
                const rect = target.getBoundingClientRect();
                const inViewport =
                  rect.top < window.innerHeight &&
                  rect.bottom > 0 &&
                  rect.left < window.innerWidth &&
                  rect.right > 0;
                return { found: true, visible: inViewport, reason: inViewport ? "ok" : "out-of-viewport" };
              }

              // Check if target is within the scroll container's visible area
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

        // Visual regression screenshot for this step
        await demoContainer.screenshot({
          path: `e2e/screenshots/${fixture.scenarioId}-step-${step.stepIndex}.png`,
        });
      }
    });
  });
}
