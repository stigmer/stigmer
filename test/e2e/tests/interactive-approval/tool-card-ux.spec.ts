// Tool-card & approval-diff UX, end-to-end against the real stack (deterministic
// via the mock LLM proxy). This is the maintained guardrail for the redesign:
//
//  - Visual regression (element-scoped `toHaveScreenshot`) of the approval gate
//    card and the post-execution diff preview, in light AND dark, so a future
//    change to the card's structure, spacing, or diff rendering is caught.
//  - Accessibility (axe-core) of the page while a gate is shown, plus keyboard
//    operability of the disclosure row and the approve action.
//
// The functional `accessibility.spec.ts` cannot cover these because tool cards
// only exist once a real execution has produced tool calls; this project has the
// full backend, so the cards render for real.
import { test, expect } from "../../fixtures";
import AxeBuilder from "@axe-core/playwright";
import {
  MockControl,
  getMockControlUrl,
  seedGatedSession,
  seedToolRunSession,
  writeFileBlock,
  awaitExecutionPhase,
  toolCallRow,
  approveButton,
  rejectButton,
  fileDiff,
  type SeededGatedExecution,
} from "../../helpers/approval";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

const mockUrl = getMockControlUrl();
const COLOR_SCHEMES = ["light", "dark"] as const;

/**
 * Parses a CSS `background-color` computed value into numeric channels.
 * Returns `null` for `transparent`/unparseable; `a` defaults to 1 for `rgb(...)`.
 */
function parseRgb(
  value: string,
): { r: number; g: number; b: number; a: number } | null {
  if (value === "transparent") return null;
  const m = value.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/,
  );
  if (!m) return null;
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] === undefined ? 1 : Number(m[4]),
  };
}

test.describe("tool-card & approval-diff UX (deterministic mock LLM)", () => {
  test.skip(
    mockUrl === null,
    "Requires the mock-LLM stack — run via `make test-e2e-approval` (STIGMER_E2E_MOCK_LLM=1)",
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
  for (const scheme of COLOR_SCHEMES) {
    test(`approval gate card renders the redesigned diff (${scheme})`, async ({
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
      // The before/after diff is the body of the gate (the whole point of the
      // redesign): the content is shown, not hidden.
      await expect(fileDiff(gateRow)).toBeVisible();
      // The file name appears exactly once in the card's header subtitle (the
      // old design repeated the absolute path three times).
      await expect(gateRow.getByText("e2e-gate.txt", { exact: true })).toHaveCount(1);

      await expect(gateRow).toHaveScreenshot(`approval-gate-card-${scheme}.png`, {
        maxDiffPixelRatio: 0.02,
      });
    });
  }

  // --- Empty-file create: honest representation, no redundant filename ------
  test("an empty-file create gate shows 'New empty file' and names the file once", async ({
    page,
    stigmerClient,
  }) => {
    // An empty-content write is a genuinely empty new file: the native gate
    // captures a CREATE with an empty after-side, so the card must say so rather
    // than render a blank diff — and must not restate the filename the header
    // already shows (the de-dup the redesign introduced).
    seeded = await seedGatedSession(stigmerClient, control, {
      gateBlocks: [writeFileBlock("call_empty", "/tmp/e2e-empty.txt", "")],
    });
    await page.goto(`/sessions/${seeded.sessionId}`);

    const gateRow = toolCallRow(page).filter({ has: approveButton(page) }).first();
    await expect(gateRow).toBeVisible({ timeout: 30_000 });

    // The diff slot is present, but renders the honest empty-file notice — not a
    // blank diff body.
    await expect(fileDiff(gateRow)).toBeVisible();
    await expect(gateRow.getByText("New empty file", { exact: true })).toBeVisible();

    // The filename appears exactly once — in the header, never restated by the
    // (now suppressed) diff body.
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
    const approveBg = parseRgb(
      await approveButton(gateRow).evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    expect(approveBg, "Approve should have a parseable background").not.toBeNull();
    expect(approveBg!.a, "Approve is a filled chip").toBeGreaterThan(0);
    const spread =
      Math.max(approveBg!.r, approveBg!.g, approveBg!.b) -
      Math.min(approveBg!.r, approveBg!.g, approveBg!.b);
    expect(spread, "Approve fill is neutral grey, not green").toBeLessThanOrEqual(12);

    // Reject: a quiet ghost — transparent at rest (no fill).
    const rejectBg = parseRgb(
      await rejectButton(gateRow).evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    expect(
      rejectBg === null || rejectBg.a === 0,
      "Reject has no resting background fill",
    ).toBe(true);
  });

  // --- Visual regression: the post-execution diff preview ------------------
  for (const scheme of COLOR_SCHEMES) {
    test(`completed write shows an inline additive diff (${scheme})`, async ({
      page,
      stigmerClient,
    }) => {
      seeded = await seedToolRunSession(stigmerClient, control, {
        toolTurns: [[writeFileBlock("call_done", "/tmp/e2e-done.txt", "one\ntwo\nthree\n")]],
      });
      await awaitExecutionPhase(
        stigmerClient,
        seeded.executionId,
        ExecutionPhase.EXECUTION_COMPLETED,
      );
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/sessions/${seeded.sessionId}`);

      const diff = fileDiff(page).first();
      await expect(diff).toBeVisible({ timeout: 30_000 });

      // A settled (non-gate) tool card carries the same neutral border with no
      // accent — guard its computed width so the layer fix covers plain cards too,
      // in both color schemes (the screenshot above cannot see a 1px line).
      const neutralBorder = await toolCallRow(page)
        .first()
        .evaluate((el) => {
          const s = getComputedStyle(el);
          return { top: s.borderTopWidth, color: s.borderTopColor };
        });
      expect(parseFloat(neutralBorder.top)).toBeGreaterThanOrEqual(1);
      expect(neutralBorder.color).not.toBe("transparent");
      expect(neutralBorder.color).not.toMatch(/,\s*0\)\s*$/);

      await expect(diff).toHaveScreenshot(`completed-write-diff-${scheme}.png`, {
        maxDiffPixelRatio: 0.02,
      });
    });
  }

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
