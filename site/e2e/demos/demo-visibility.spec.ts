/**
 * Targeted visibility contract tests for demo scenarios.
 *
 * Reads the auto-generated demo-manifest.json and filters for entries
 * with a visibilityContract (auto-derived from scenario scroll/cursor
 * interactions by validate-demos.ts, merged with co-located
 * visibility.json overrides). For each:
 *
 * 1. Navigates to the docs page with accelerated playback.
 * 2. Starts playback by clicking the poster play button.
 * 3. At each contracted step (detected via data-demo-step), polls the
 *    contract's requirements until each is observed satisfied, or the
 *    step ends. A contract means "this step shows the viewer this
 *    content at some point" — NOT "at a fixed instant". Scenarios
 *    deliberately schedule scrolls partway through a step (narrate the
 *    top, then scroll), so requirements become true at different
 *    moments within the step; each only has to be observed once.
 * 4. For steps with cursorMustAlign, the same polling verifies the
 *    cursor overlay reaches the target element's center. Auto-derived
 *    cursor requirements (cursorTarget) are presence-tolerant: skipped
 *    when the target never mounts during the step, strict when it does.
 * 5. Once the contract is satisfied, takes a visual regression
 *    screenshot after the scroll geometry stabilizes.
 *
 * Visibility checks use page.evaluate with getBoundingClientRect
 * inside the page context. This avoids Playwright's known issues
 * with CSS `zoom` property (#21192, #7642). Checks require full
 * containment (target fully inside container), not just intersection.
 *
 * This suite is the single home for demo visibility assertions;
 * demo.spec.ts is pure playback smoke (every demo plays to completion
 * without JS errors).
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
  mustBeCentered?: string;
  /**
   * Auto-derived cursor requirement — presence-tolerant. Cursor
   * targets mount through async fixture round-trips and can
   * legitimately miss a short step at accelerated playback (the
   * Cursor component itself retries briefly, then gives up). If the
   * target never mounts during the step the requirement is skipped;
   * if it mounts, containment and cursor alignment are asserted.
   */
  cursorTarget?: string;
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
 * Interval between requirement polls within a contracted step.
 * Scroll animations run ~300-500ms and steps last seconds, so 150ms
 * sampling cannot miss a satisfied state.
 */
const POLL_INTERVAL_MS = 150;

/**
 * Maximum wall-clock time for a demo to reach a target step at 2x.
 * Long tours (12+ steps) with narration can take 60s+ to reach
 * late steps. 120s covers the worst case.
 */
const STEP_TIMEOUT_MS = 120_000;

/**
 * Hard cap on polling within a single step. Steps normally end (and
 * end the poll loop) on their own; this cap only matters for the
 * final step of a scenario, which never transitions away.
 */
const CONTRACT_SATISFY_TIMEOUT_MS = 30_000;

/**
 * Wait after a cursorMustAlign requirement is satisfied before taking
 * the step screenshot. Alignment can be observed the moment the
 * cursor lands, but the click ripple fires CLICK_DELAY_MS (450ms)
 * after arrival and animates for another 450ms — capturing mid-ripple
 * is nondeterministic. This covers the full ripple with margin.
 */
const CURSOR_RIPPLE_SETTLE_MS = 1_200;

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
 * For mustBeCentered checks: the target's vertical center must
 * be within this fraction of the container's height from the
 * container's vertical center. 0.2 = within 20%.
 */
const CENTERING_THRESHOLD = 0.2;

// ---------------------------------------------------------------------------
// In-page requirement evaluation
// ---------------------------------------------------------------------------

/**
 * One poll's verdict for a single contract requirement, produced
 * inside the page. `detail` carries the last-observed geometry so a
 * never-satisfied requirement fails with actionable numbers.
 * `present` reports whether the requirement's element was in the DOM
 * this poll — presence-tolerant requirements are skipped (not failed)
 * when their element was never present during the whole step.
 */
interface RequirementVerdict {
  satisfied: boolean;
  detail: string;
  present?: boolean;
}

/** Serializable inputs for the in-page requirement evaluation. */
interface RequirementProbe {
  targets: string[];
  scrollSelector: string;
  mustBeCentered?: string;
  cursorMustAlign?: string;
  /** Presence-tolerant cursor requirement (see StepAssertion). */
  cursorTarget?: string;
  containmentTolerance: number;
  centeringThreshold: number;
  cursorTolerance: number;
}

/**
 * Evaluated inside the page: check every contract requirement once
 * and report per-requirement verdicts plus the scroll position (used
 * by the caller to detect when scrolling has settled).
 *
 * Keyed by requirement name: `target:<id>`, `centered:<id>`,
 * `cursor:<id>`, `cursor-opt:<id>`.
 */
function evaluateRequirements(
  container: Element,
  probe: RequirementProbe,
): {
  verdicts: Record<string, RequirementVerdict>;
  scrollTop: number;
  scrollHeight: number;
} {
  const verdicts: Record<string, RequirementVerdict> = {};

  const scrollParent = container.querySelector(probe.scrollSelector);
  const ref = scrollParent ?? container;
  const refRect = ref.getBoundingClientRect();

  const findTarget = (targetId: string): Element | null =>
    container.querySelector(`[data-scroll-target="${targetId}"]`) ??
    container.querySelector(`[data-cursor-target="${targetId}"]`);

  const containment = (
    target: Element,
  ): { contained: boolean; detail: string } => {
    const t = target.getBoundingClientRect();
    const tol = probe.containmentTolerance;
    const contained =
      t.top >= refRect.top - tol &&
      t.bottom <= refRect.bottom + tol &&
      t.left >= refRect.left - tol &&
      t.right <= refRect.right + tol;
    return {
      contained,
      detail: contained
        ? "contained"
        : `target ${Math.round(t.top)}..${Math.round(t.bottom)} vs ` +
          `container ${Math.round(refRect.top)}..${Math.round(refRect.bottom)}`,
    };
  };

  // The Cursor overlay is deliberately a SIBLING of the demo
  // container ([data-demo-step] is the ScenarioPlayer root), not a
  // descendant: both are direct children of DemoViewport's inner
  // zoomed div, which is also the cursor's positioning parent and
  // the `containerRef` its coordinates are computed against.
  const cursorAlignment = (
    target: Element,
  ): { aligned: boolean; detail: string } => {
    const viewport = container.parentElement;
    const cursor = viewport?.querySelector(
      ":scope > .pointer-events-none.absolute.z-50",
    ) as HTMLElement | null;
    if (!viewport || !cursor) {
      return { aligned: false, detail: "cursor overlay not found" };
    }

    const transform = getComputedStyle(cursor).transform;
    if (!transform || transform === "none") {
      return { aligned: false, detail: "cursor has no transform" };
    }

    // Mirror @scenar/core's computeCursorPosition: the cursor
    // transform is in the viewport's pre-zoom CSS space; rects are
    // post-zoom viewport coordinates. Divide by the effective zoom
    // to compare like with like.
    const matrix = new DOMMatrix(transform);
    const tRect = target.getBoundingClientRect();
    const vRect = viewport.getBoundingClientRect();
    const zoom = vRect.width / viewport.offsetWidth || 1;
    const targetCenterX = (tRect.left - vRect.left + tRect.width / 2) / zoom;
    const targetCenterY = (tRect.top - vRect.top + tRect.height / 2) / zoom;
    const dx = Math.abs(matrix.m41 - targetCenterX);
    const dy = Math.abs(matrix.m42 - targetCenterY);
    return {
      aligned: dx <= probe.cursorTolerance && dy <= probe.cursorTolerance,
      detail: `cursor ${Math.round(dx)}px/${Math.round(dy)}px from ` +
        `target center (tolerance ${probe.cursorTolerance}px)`,
    };
  };

  for (const targetId of probe.targets) {
    const target = findTarget(targetId);
    if (!target) {
      verdicts[`target:${targetId}`] = {
        satisfied: false,
        detail: "not found in DOM",
      };
      continue;
    }
    const { contained, detail } = containment(target);
    verdicts[`target:${targetId}`] = { satisfied: contained, detail };
  }

  if (probe.mustBeCentered) {
    const target =
      container.querySelector(
        `[data-scroll-target="${probe.mustBeCentered}"]`,
      ) ??
      container.querySelector(
        `[data-cursor-target="${probe.mustBeCentered}"]`,
      );

    if (!target) {
      verdicts[`centered:${probe.mustBeCentered}`] = {
        satisfied: false,
        detail: "not found in DOM",
      };
    } else {
      const cr = container.getBoundingClientRect();
      const tr = target.getBoundingClientRect();
      const offset = Math.abs(
        (tr.top + tr.bottom) / 2 - (cr.top + cr.bottom) / 2,
      );
      const maxOffset = cr.height * probe.centeringThreshold;
      verdicts[`centered:${probe.mustBeCentered}`] = {
        satisfied: offset <= maxOffset,
        detail: `${Math.round(offset)}px from vertical center ` +
          `(max ${Math.round(maxOffset)}px)`,
      };
    }
  }

  if (probe.cursorMustAlign) {
    const target = findTarget(probe.cursorMustAlign);
    if (!target) {
      verdicts[`cursor:${probe.cursorMustAlign}`] = {
        satisfied: false,
        detail: "target not found",
      };
    } else {
      const { aligned, detail } = cursorAlignment(target);
      verdicts[`cursor:${probe.cursorMustAlign}`] = {
        satisfied: aligned,
        detail,
      };
    }
  }

  if (probe.cursorTarget) {
    // Presence-tolerant: report `present` so the caller can skip the
    // requirement if the target never mounts during the step. When
    // present, both containment and cursor alignment must hold.
    const target = findTarget(probe.cursorTarget);
    if (!target) {
      verdicts[`cursor-opt:${probe.cursorTarget}`] = {
        satisfied: false,
        present: false,
        detail: "target never mounted during the step",
      };
    } else {
      const { contained, detail: containDetail } = containment(target);
      const { aligned, detail: alignDetail } = cursorAlignment(target);
      verdicts[`cursor-opt:${probe.cursorTarget}`] = {
        satisfied: contained && aligned,
        present: true,
        detail: contained ? alignDetail : containDetail,
      };
    }
  }

  // Exact (unrounded) values: the screenshot stability check compares
  // consecutive samples for identity, and a smooth scroll's ease-out
  // tail creeps by fractions of a pixel per interval — rounding would
  // declare it settled while it is still moving. scrollHeight changes
  // when async fixture content is still streaming into the view.
  const sc = container.querySelector(probe.scrollSelector);
  return {
    verdicts,
    scrollTop: sc ? sc.scrollTop : 0,
    scrollHeight: sc ? sc.scrollHeight : 0,
  };
}

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

      // The poster label depends on narration: "Play demo" for silent
      // demos, "Play walkthrough with narration" for narrated ones —
      // match both via the shared "Play " prefix.
      await page.waitForFunction(
        (idx) => {
          const buttons = document.querySelectorAll(
            '[role="button"][aria-label^="Play "]',
          );
          return buttons.length > idx;
        },
        demoIdx,
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
        }, demoIdx);

        if (!clicked) break;

        await page.waitForTimeout(1_000);
        const stillVisible = await page.evaluate((idx) => {
          const buttons = document.querySelectorAll(
            '[role="button"][aria-label^="Play "]',
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
          // Poll fast: arriving late eats into the window in which
          // this step's requirements can be observed.
          { timeout: STEP_TIMEOUT_MS, polling: 50 },
        );

        // The demo may already have advanced past this contracted step
        // (short steps at accelerated playback). Nothing to assert then.
        const stepOnArrival = Number(
          await demoContainer.getAttribute("data-demo-step") ?? "-1",
        );
        if (stepOnArrival !== step.stepIndex) {
          continue;
        }

        const probe: RequirementProbe = {
          targets: step.targets,
          scrollSelector: step.scrollContainer ?? "[data-scroll-container]",
          mustBeCentered: step.mustBeCentered,
          cursorMustAlign: step.cursorMustAlign,
          cursorTarget: step.cursorTarget,
          containmentTolerance: CONTAINMENT_TOLERANCE_PX,
          centeringThreshold: CENTERING_THRESHOLD,
          cursorTolerance: CURSOR_ALIGNMENT_TOLERANCE_PX,
        };

        // Poll until every requirement has been observed satisfied at
        // least once, or the step ends. Requirements become true at
        // different moments (a scroll fires mid-step, the cursor
        // spring lands late), so each is latched independently.
        const satisfied = new Set<string>();
        const everPresent = new Set<string>();
        const lastDetail = new Map<string, string>();
        let onContractedStep = true;
        const pollStart = Date.now();

        while (Date.now() - pollStart < CONTRACT_SATISFY_TIMEOUT_MS) {
          const currentStep = Number(
            await demoContainer.getAttribute("data-demo-step") ?? "-1",
          );
          if (currentStep !== step.stepIndex) {
            onContractedStep = false;
            break;
          }

          const { verdicts } = await demoContainer.evaluate(
            evaluateRequirements,
            probe,
          );

          for (const [name, verdict] of Object.entries(verdicts)) {
            if (verdict.satisfied) satisfied.add(name);
            if (verdict.present) everPresent.add(name);
            lastDetail.set(name, verdict.detail);
          }

          if (satisfied.size === Object.keys(verdicts).length) break;
          await page.waitForTimeout(POLL_INTERVAL_MS);
        }

        // Presence-tolerant requirements (`cursor-opt:`) only count
        // as failures when their element actually appeared during the
        // step; a target that never mounted is skipped, mirroring the
        // Cursor component's own retry-then-give-up behavior.
        const unsatisfied = [...lastDetail.keys()].filter(
          (name) =>
            !satisfied.has(name) &&
            (!name.startsWith("cursor-opt:") || everPresent.has(name)),
        );
        expect(
          unsatisfied,
          `Step ${step.stepIndex}: requirement(s) never satisfied while ` +
            `the step played:\n` +
            unsatisfied
              .map((name) => `  ${name}: ${lastDetail.get(name)}`)
              .join("\n"),
        ).toHaveLength(0);

        // Screenshot at the "shown" moment — but only after the scroll
        // geometry has stopped moving, so captures are stable across
        // runs. If the step ends first, there is no moment left to
        // capture; the assertions above already passed.
        if (onContractedStep) {
          const cursorLanded =
            step.cursorMustAlign != null ||
            (step.cursorTarget != null &&
              satisfied.has(`cursor-opt:${step.cursorTarget}`));
          if (cursorLanded) {
            await page.waitForTimeout(CURSOR_RIPPLE_SETTLE_MS);
          }

          // Geometry must hold perfectly still (exact scrollTop AND
          // scrollHeight) for two consecutive intervals: one interval
          // can alias the near-zero-velocity tail of a smooth scroll,
          // which ghosts the whole capture by a few pixels.
          let previousKey = "";
          let stableIntervals = 0;
          while (Date.now() - pollStart < CONTRACT_SATISFY_TIMEOUT_MS) {
            const currentStep = Number(
              await demoContainer.getAttribute("data-demo-step") ?? "-1",
            );
            if (currentStep !== step.stepIndex) {
              onContractedStep = false;
              break;
            }
            const { scrollTop, scrollHeight } = await demoContainer.evaluate(
              evaluateRequirements,
              probe,
            );
            const key = `${scrollTop}:${scrollHeight}`;
            stableIntervals = key === previousKey ? stableIntervals + 1 : 0;
            if (stableIntervals >= 2) break;
            previousKey = key;
            await page.waitForTimeout(POLL_INTERVAL_MS);
          }

          if (onContractedStep) {
            // 0.05: demo content mounts through async fixture
            // round-trips whose timing shifts a capture by a content
            // wave; the geometric contract above is the precise
            // assertion, the screenshot guards gross visual breakage
            // (blank frames, broken layout), not pixel identity.
            await expect(demoContainer).toHaveScreenshot(
              `${fixture.scenarioId}-step-${step.stepIndex}.png`,
              { maxDiffPixelRatio: 0.05 },
            );
          }
        }
      }
    });
  });
}
