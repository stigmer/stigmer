// Tool-card & approval UX, end-to-end against the real stack (deterministic
// via the mock LLM proxy). This is the maintained guardrail for the gate card:
//
//  - What the approval gate card shows (the proposed content, the file named
//    once) and its rendered chrome, read by computed style. How it LOOKS, in
//    light and dark, is the kit's gallery's (test/visual, the
//    `thread-approval` scene), compared with no tolerance in one pinned
//    browser; this suite's pictures were taken on macOS and never compared in
//    CI.
//  - Accessibility (axe-core) of the page while a gate is shown, plus keyboard
//    operability of the disclosure row and the approve action.
//
// The functional `accessibility.spec.ts` cannot cover these because tool cards
// only exist once a real run has produced tool calls; this project has the
// full backend, so the cards render for real.
//
// STACK SHAPE: this file runs as the `interactive-approval-gate` project
// against the FILE-GATE stack (STIGMER_E2E_FILE_GATES: runner boots with
// ARTIFACT_STORAGE_TYPE=none). File-write GATES exist only there — on the
// capture-substrate stack the other approval specs use, writes follow
// apply-then-review and never pause. The specs skip against the
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
  denyButton,
  type SeededGatedRun,
} from "../../helpers/approval";
import { isFileGateStack } from "../../helpers/mock-llm-control";

const mockUrl = getMockControlUrl();
const fileGates = isFileGateStack();

import type { Locator } from "@playwright/test";

/**
 * Resolve an element's computed `background-color` to numeric RGBA channels
 * (`a` in 0..1), IN the page, via a 1x1 canvas round-trip. Canvas `fillStyle`
 * parses every CSS color form the engine can compute — the Tailwind v4 theme
 * emits `oklch(...)`, which a text `rgb(...)` regex (this helper's previous
 * form) silently fails on. A fully transparent background resolves to a=0.
 *
 * One read is one moment: callers poll it (`expect.poll`). A read that lands
 * on a detached element sees empty computed styles: an empty
 * `backgroundColor` leaves the canvas at its opaque black default, so a
 * detached button reads as a=1 (stigmer#1527). The gate row used to be
 * replaced just after it appeared, when the thread's enter wrapper changed
 * its root element at the animation's end; the row now stays the same
 * element (stigmer#1570, held by the keyboard test below), and the reads
 * stay polled because a style can still settle after the first frame.
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
  let seeded: SeededGatedRun | null = null;

  test.afterEach(async () => {
    if (seeded) {
      await seeded.cleanup();
      seeded = null;
    }
    await control.reset();
  });

  // --- The approval gate card's content ------------------------------------
  // The gate is PRE-execution: the change has not been captured (the tool is
  // denied, awaiting the decision), so there is no FileChangeSet and no
  // before/after diff — the card shows the PROPOSED content from the tool
  // args. (The diff surface lives on the apply-then-review path's file-review
  // card, pinned by file-review.spec.ts on the capture stack.)
  test("approval gate card renders the proposed content", async ({
    page,
    stigmerClient,
  }) => {
    seeded = await seedGatedSession(stigmerClient, control, {
      gateBlocks: [writeFileBlock("call_write_1", "/tmp/e2e-gate.txt", "alpha\nbeta\n")],
    });
    await page.goto(`/sessions/${seeded.sessionId}`);

    // Wait for the gate to render with its decision actions.
    const gateRow = toolCallRow(page).filter({ has: approveButton(page) }).first();
    await expect(gateRow).toBeVisible({ timeout: 30_000 });
    // The proposed content is the body of the gate: shown, not hidden.
    await expect(gateRow.getByText("alpha")).toBeVisible();
    await expect(gateRow.getByText("beta")).toBeVisible();
    // The file appears exactly once: its whole path on the header's own line
    // (the body deliberately suppresses it; the old design repeated the
    // absolute path three times).
    await expect(gateRow.getByText(/e2e-gate\.txt$/)).toHaveCount(1);
  });

  // --- Empty-file create: no empty box, no redundant filename ---------------
  test("an empty-file create gate shows the create notice and names the file once", async ({
    page,
    stigmerClient,
  }) => {
    // An empty-content write carries no renderable content. The card says what
    // the agent wants in its header sentence and that nothing is written until
    // the person allows it; it draws no "preview unavailable" box in place of
    // a preview it does not have, and never restates the filename the header
    // already shows.
    seeded = await seedGatedSession(stigmerClient, control, {
      gateBlocks: [writeFileBlock("call_empty", "/tmp/e2e-empty.txt", "")],
    });
    await page.goto(`/sessions/${seeded.sessionId}`);

    const gateRow = toolCallRow(page).filter({ has: approveButton(page) }).first();
    await expect(gateRow).toBeVisible({ timeout: 30_000 });

    await expect(gateRow.getByText("It waits for your answer. Nothing is written until you allow it.", { exact: true })).toBeVisible();
    await expect(gateRow.getByText("New file — preview unavailable", { exact: true })).toHaveCount(0);

    // The filename appears exactly once — in the header, never restated by the
    // body.
    await expect(gateRow.getByText(/e2e-empty\.txt$/)).toHaveCount(1);
  });

  // --- Rendered border: computed-style guard (not a screenshot) ------------
  // The card chrome lives on Tailwind `border-*` utilities that only render if
  // the SDK's scoped preflight reset stays BELOW the `utilities` cascade layer
  // when a host app recompiles the stylesheet. Three prior fixes shipped with the
  // reset above `utilities` — every border inside `.stgm` silently zeroed — and
  // it went unnoticed because `toHaveScreenshot({ maxDiffPixelRatio: 0.02 })`
  // cannot see a 1px outline (well under 2% of the card's pixels; the kit's
  // gallery, test/visual, now compares with no tolerance) and the jsdom
  // unit tests assert only the class *string*, never the rendered width. This
  // reads the real computed style in Chromium, so a layer regression fails loudly.
  // Each read is polled: a read on a detached element sees empty widths
  // (NaN) and waits instead of failing, while a real regression never
  // converges (see resolvedBackgroundRgba).
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

    // The gate is a step in its turn's list of steps: the list's card draws
    // the neutral outline, and the gate's own row its "needs you" accent.
    const card = gateRow.locator("xpath=ancestor::*[@data-cursor-target='tool-call-group'][1]");
    const border = () =>
      card.evaluate((el) => {
        const s = getComputedStyle(el);
        return { top: parseFloat(s.borderTopWidth), color: s.borderTopColor };
      });
    const accent = () => gateRow.evaluate((el) => parseFloat(getComputedStyle(el).borderLeftWidth));
    // The neutral outline is a real ~1px line...
    await expect
      .poll(async () => (await border()).top, { message: "the steps card has a top border" })
      .toBeGreaterThanOrEqual(1);
    // ...with a visible (non-transparent) color, not the zeroed fallback
    // (`transparent`, or any rgba(..., 0)).
    await expect
      .poll(async () => (await border()).color, { message: "the steps card's border has a visible color" })
      .not.toMatch(/^transparent$|,\s*0\)\s*$/);
    // The pending gate carries its "needs you" cue as a 2px left accent.
    await expect
      .poll(accent, { message: "the pending gate has a 2px left accent" })
      .toBeGreaterThanOrEqual(2);
  });

  // --- Decision buttons: computed-style guard (not a screenshot) ------------
  // The buttons share `DecisionButton`: Allow is the kit's filled button in
  // the monochrome primary (low chroma, never the success green), and Deny is
  // outlined (a border, never the destructive red). A screenshot's 2%
  // threshold can miss a hue swap on a small button, so assert the real
  // computed colors — the same "rendered, not class-string" philosophy as the
  // border guard above. Deny is read first: its border is drawn only on the
  // live, styled button.
  test("decision buttons: Allow is filled and neutral, never green; Deny is outlined, never red", async ({
    page,
    stigmerClient,
  }) => {
    seeded = await seedGatedSession(stigmerClient, control, {
      gateBlocks: [writeFileBlock("call_write_1", "/tmp/e2e-quiet.txt", "alpha\nbeta\n")],
    });
    await page.goto(`/sessions/${seeded.sessionId}`);

    const gateRow = toolCallRow(page).filter({ has: approveButton(page) }).first();
    await expect(gateRow).toBeVisible({ timeout: 30_000 });

    // Deny: outlined — a visible border, and no red fill.
    await expect
      .poll(async () => denyButton(gateRow).evaluate((el) => Number.parseFloat(getComputedStyle(el).borderTopWidth)), {
        message: "Deny has a visible border",
      })
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(
        async () => {
          const { r, g, b } = await resolvedBackgroundRgba(denyButton(gateRow));
          return r - Math.max(g, b);
        },
        { message: "Deny's fill is not red" },
      )
      .toBeLessThanOrEqual(12);

    // Approve: opaque fill, but neutral grey (R≈G≈B) — not the success green
    // (whose green channel dominates).
    const approveBg = () => resolvedBackgroundRgba(approveButton(gateRow));
    await expect
      .poll(async () => (await approveBg()).a, { message: "Approve is a filled chip" })
      .toBeGreaterThan(0);
    await expect
      .poll(
        async () => {
          const { r, g, b } = await approveBg();
          return Math.max(r, g, b) - Math.min(r, g, b);
        },
        { message: "Approve fill is neutral grey, not green" },
      )
      .toBeLessThanOrEqual(12);
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
  // Approve is focused as soon as the gate shows, as a keyboard user would,
  // and must keep the focus while the page settles: the thread's enter
  // animation ends and the page catches up with the server during the axe
  // scan. A row replaced in that time drops the focus silently, so Enter
  // does nothing (stigmer#1570).
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

    const approve = approveButton(gateRow);
    await approve.focus();
    await expect(approve).toBeFocused();
    const focused = await approve.elementHandle();
    // The gate's thread item has finished its enter animation.
    await expect(
      page.locator(".stgm-thread-item-enter").filter({ has: gateRow }),
    ).toHaveCount(0);

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

    // The approve action kept the keyboard focus, on the same element, through
    // the scan and everything the page did meanwhile.
    expect(await focused!.evaluate((el) => el.isConnected)).toBe(true);
    await expect(approve).toBeFocused();
    expect(await focused!.evaluate((el) => el === document.activeElement)).toBe(true);
  });
});
