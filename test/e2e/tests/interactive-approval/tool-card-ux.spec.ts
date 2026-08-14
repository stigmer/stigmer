// Tool-card & approval UX, end-to-end against the real stack (deterministic
// via the mock LLM proxy). This is the maintained guardrail for the gate card:
//
//  - Visual regression (element-scoped `toHaveScreenshot`) of the approval gate
//    card (proposed-content body) and the post-execution diff preview, in light
//    AND dark, so a future change to the card's structure, spacing, or content
//    rendering is caught.
//  - Accessibility (axe-core) of the page while a gate is shown, plus keyboard
//    operability of the disclosure row and the approve action.
//
// The functional `accessibility.spec.ts` cannot cover these because tool cards
// only exist once a real execution has produced tool calls; this project has the
// full backend, so the cards render for real.
//
// STACK SHAPE: this file runs as the `interactive-approval-gate` project
// against the FILE-GATE stack (STIGMER_E2E_FILE_GATES: runner boots with
// ARTIFACT_STORAGE_TYPE=none). File-write GATES exist only there — on the
// capture-substrate stack the other approval specs use, writes follow
// apply-then-review (phase-7) and never pause. The specs skip against the
// wrong stack shape rather than fail confusingly.
import { test, expect } from "../../fixtures";
import AxeBuilder from "@axe-core/playwright";
import {
  MockControl,
  getMockControlUrl,
  seedGatedSession,
  writeFileBlock,
  toolCallRow,
  approveButton,
  rejectButton,
  type SeededGatedExecution,
} from "../../helpers/approval";
import { isFileGateStack } from "../../helpers/mock-llm-control";

const mockUrl = getMockControlUrl();
const fileGates = isFileGateStack();
const COLOR_SCHEMES = ["light", "dark"] as const;

import type { Locator } from "@playwright/test";

/**
 * Resolve an element's computed `background-color` to numeric RGBA channels
 * (`a` in 0..1), IN the page, via a 1x1 canvas round-trip. Canvas `fillStyle`
 * parses every CSS color form the engine can compute — the Tailwind v4 theme
 * emits `oklch(...)`, which a text `rgb(...)` regex (this helper's previous
 * form) silently fails on. A fully transparent background resolves to a=0.
 */
function resolvedBackgroundRgba(
  locator: Locator,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return locator.evaluate((el) => {
    const color = getComputedStyle(el).backgroundColor;
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  });
}

test.describe("tool-card & approval-diff UX (deterministic mock LLM)", () => {
  test.skip(
    mockUrl === null,
    "Requires the mock-LLM stack — run via `make test-e2e-approval` (STIGMER_E2E_MOCK_LLM=1)",
  );
  test.skip(
    !fileGates,
    "Requires the FILE-GATE stack (STIGMER_E2E_FILE_GATES=1) — on a capture-substrate " +
      "stack file writes apply-then-review and never gate. Run via `make test-e2e-approval`.",
  );
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  const control = new MockControl(mockUrl ?? "");
  let seeded: SeededGatedExecution | null = null;

  test.afterEach(async () => {
    if (seeded) {
      await seeded.cleanup();
      seeded = null;
    }
    await control.reset();
  });

  // --- Visual regression: the approval gate card ---------------------------
  // The gate is PRE-execution: the change has not been captured (the tool is
  // denied, awaiting the decision), so there is no FileChangeSet and no
  // before/after diff — the card shows the PROPOSED content from the tool
  // args. (The diff surface lives on the apply-then-review path's file-review
  // card, pinned by file-review.spec.ts on the capture stack.)
  for (const scheme of COLOR_SCHEMES) {
    test(`approval gate card renders the proposed content (${scheme})`, async ({
      page,
      stigmerClient,
    }) => {
      seeded = await seedGatedSession(stigmerClient, control, {
        gateBlocks: [writeFileBlock("call_write_1", "/tmp/e2e-gate.txt", "alpha\nbeta\n")],
      });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/sessions/${seeded.sessionId}`);

      // Wait for the gate to render with its decision actions.
      const gateRow = toolCallRow(page).filter({ has: approveButton(page) }).first();
      await expect(gateRow).toBeVisible({ timeout: 30_000 });
      // The proposed content is the body of the gate: shown, not hidden.
      await expect(gateRow.getByText("alpha")).toBeVisible();
      await expect(gateRow.getByText("beta")).toBeVisible();
      // The file name appears exactly once — in the card's header subtitle
      // (the body deliberately suppresses it; the old design repeated the
      // absolute path three times).
      await expect(gateRow.getByText("e2e-gate.txt", { exact: true })).toHaveCount(1);

      await expect(gateRow).toHaveScreenshot(`approval-gate-card-${scheme}.png`, {
        maxDiffPixelRatio: 0.02,
      });
    });
  }

  // --- Empty-file create: honest representation, no redundant filename ------
  test("an empty-file create gate shows the create notice and names the file once", async ({
    page,
    stigmerClient,
  }) => {
    // An empty-content write carries no renderable content, so the card renders
    // the honest create notice instead of a blank body — and must not restate
    // the filename the header already shows. NOTE: the pre-capture gate proved
    // emptiness from its captured change and said "New empty file"; the current
    // args-derived gate cannot distinguish "empty" from "content unavailable",
    // so it uses the non-committal create copy. (Flagged in oss#754's PR as a
    // possible refinement: args carrying content === "" ARE proof of emptiness.)
    seeded = await seedGatedSession(stigmerClient, control, {
      gateBlocks: [writeFileBlock("call_empty", "/tmp/e2e-empty.txt", "")],
    });
    await page.goto(`/sessions/${seeded.sessionId}`);

    const gateRow = toolCallRow(page).filter({ has: approveButton(page) }).first();
    await expect(gateRow).toBeVisible({ timeout: 30_000 });

    await expect(
      gateRow.getByText("New file — preview unavailable", { exact: true }),
    ).toBeVisible();

    // The filename appears exactly once — in the header, never restated by the
    // body.
    await expect(gateRow.getByText("e2e-empty.txt", { exact: true })).toHaveCount(1);
  });

  // --- Rendered border: computed-style guard (not a screenshot) ------------
  // The card chrome lives on Tailwind `border-*` utilities that only render if
  // the SDK's scoped preflight reset stays BELOW the `utilities` cascade layer
  // when a host app recompiles the stylesheet. Three prior fixes shipped with the
  // reset above `utilities` — every border inside `.stgm` silently zeroed — and
  // it went unnoticed because `toHaveScreenshot({ maxDiffPixelRatio: 0.02 })`
  // cannot see a 1px outline (well under 2% of the card's pixels) and the jsdom
  // unit tests assert only the class *string*, never the rendered width. This
  // reads the real computed style in Chromium, so a layer regression fails loudly.
  test("the approval gate card renders a visible neutral border + accent", async ({
    page,
    stigmerClient,
  }) => {
    seeded = await seedGatedSession(stigmerClient, control, {
      gateBlocks: [writeFileBlock("call_write_1", "/tmp/e2e-border.txt", "alpha\nbeta\n")],
    });
    await page.goto(`/sessions/${seeded.sessionId}`);

    const gateRow = toolCallRow(page).filter({ has: approveButton(page) }).first();
    await expect(gateRow).toBeVisible({ timeout: 30_000 });

    const border = await gateRow.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        top: s.borderTopWidth,
        left: s.borderLeftWidth,
        color: s.borderTopColor,
      };
    });
    // The neutral outline is a real ~1px line on every side...
    expect(parseFloat(border.top)).toBeGreaterThanOrEqual(1);
    // ...with a visible (non-transparent) color, not the zeroed fallback.
    expect(border.color).not.toBe("transparent");
    expect(border.color).not.toMatch(/,\s*0\)\s*$/); // no rgba(...,0)
    // The pending gate carries its "needs you" cue as a 2px left accent.
    expect(parseFloat(border.left)).toBeGreaterThanOrEqual(2);
  });

  // --- Quiet decision buttons: computed-style guard (not a screenshot) ------
  // The buttons share the quiet, Cursor-grade `DecisionButton`: Approve is a
  // filled NEUTRAL chip (a low-chroma grey, never the success green), and Reject
  // is a ghost with NO resting fill. A screenshot's 2% threshold can miss a hue
  // swap on a small button, so assert the real computed colors — the same
  // "rendered, not class-string" philosophy as the border guard above.
  test("decision buttons are quiet: Approve is a neutral chip, Reject has no resting fill", async ({
    page,
    stigmerClient,
  }) => {
    seeded = await seedGatedSession(stigmerClient, control, {
      gateBlocks: [writeFileBlock("call_write_1", "/tmp/e2e-quiet.txt", "alpha\nbeta\n")],
    });
    await page.goto(`/sessions/${seeded.sessionId}`);

    const gateRow = toolCallRow(page).filter({ has: approveButton(page) }).first();
    await expect(gateRow).toBeVisible({ timeout: 30_000 });

    // Approve: opaque fill, but neutral grey (R≈G≈B) — not the success green
    // (whose green channel dominates).
    const approveBg = await resolvedBackgroundRgba(approveButton(gateRow));
    expect(approveBg.a, "Approve is a filled chip").toBeGreaterThan(0);
    const spread =
      Math.max(approveBg.r, approveBg.g, approveBg.b) -
      Math.min(approveBg.r, approveBg.g, approveBg.b);
    expect(spread, "Approve fill is neutral grey, not green").toBeLessThanOrEqual(12);

    // Reject: a quiet ghost — transparent at rest (no fill).
    const rejectBg = await resolvedBackgroundRgba(rejectButton(gateRow));
    expect(rejectBg.a, "Reject has no resting background fill").toBe(0);
  });

  // --- Bounded preview: a large gate's content truncates and reveals in place
  // The motivating bug: a gated edit rendered the WHOLE file, pushing the
  // decision buttons off-screen. The current args-derived content preview
  // (CollapsibleCode) bounds by LINES: content past the truncation limit is
  // cut with an in-place "Show all N lines" reveal — decision buttons stay
  // reachable throughout. Only provable in a real browser — here.
  test("a large gate content preview is bounded and reveals in place", async ({
    page,
    stigmerClient,
  }) => {
    const big = Array.from({ length: 30 }, (_, i) => `gate line ${i + 1}`).join("\n") + "\n";
    seeded = await seedGatedSession(stigmerClient, control, {
      gateBlocks: [writeFileBlock("call_big_gate", "/tmp/e2e-big-gate.txt", big)],
    });
    await page.goto(`/sessions/${seeded.sessionId}`);

    const gateRow = toolCallRow(page).filter({ has: approveButton(page) }).first();
    await expect(gateRow).toBeVisible({ timeout: 30_000 });

    // Truncated: the head renders, the tail does not (the content is one code
    // block, so substring containment is the right probe).
    await expect(gateRow).toContainText("gate line 1");
    await expect(gateRow).not.toContainText("gate line 30");

    // The decision action is reachable WHILE the content is bounded (the bug).
    await expect(approveButton(gateRow)).toBeVisible();

    // "Show all N lines" reveals the rest in place.
    const reveal = gateRow.getByRole("button", { name: /Show all \d+ lines/ });
    await expect(reveal).toBeVisible();
    await reveal.click();
    await expect(gateRow).toContainText("gate line 30");
  });

  // NOTE: the "completed write shows an inline additive diff" visual pins
  // moved to file-review.spec.ts (the capture stack): the settled row's diff
  // is capture-fed, so on THIS no-substrate stack a completed write honestly
  // renders its content, not a diff.

  // --- Accessibility: axe + keyboard operability ---------------------------
  test("approval gate card is accessible and keyboard-operable", async ({
    page,
    stigmerClient,
  }) => {
    seeded = await seedGatedSession(stigmerClient, control, {
      gateBlocks: [writeFileBlock("call_write_1", "/tmp/e2e-a11y.txt", "alpha\nbeta\n")],
    });
    await page.goto(`/sessions/${seeded.sessionId}`);

    const gateRow = toolCallRow(page).filter({ has: approveButton(page) }).first();
    await expect(gateRow).toBeVisible({ timeout: 30_000 });

    // No critical/serious axe violations on the page while the gate is shown.
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .exclude('[role="form"][aria-label="Send message"] textarea')
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(
      serious,
      `axe violations:\n${serious.map((v) => `[${v.impact}] ${v.id}`).join("\n")}`,
    ).toHaveLength(0);

    // The approve action is reachable and operable by keyboard.
    const approve = approveButton(gateRow);
    await approve.focus();
    await expect(approve).toBeFocused();
  });
});
