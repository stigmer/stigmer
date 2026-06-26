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
  fileDiff,
  type SeededGatedExecution,
} from "../../helpers/approval";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

const mockUrl = getMockControlUrl();
const COLOR_SCHEMES = ["light", "dark"] as const;

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
