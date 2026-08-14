// File-review card UX, end-to-end against the CAPTURE-substrate stack
// (deterministic via the mock LLM proxy). Apply-then-review is where the
// file DIFF surface lives now: a flowed write is captured, the run pauses at
// the review boundary, and the review card presents the before/after diff
// with the Keep-all / Reject decisions. These are the visual pins for that
// card — the successor of the pre-capture "gate renders the diff" screenshots
// (tool-card-ux.spec.ts pins the gate's proposed-content card on the
// file-gate stack; the review flow's FUNCTIONAL coverage rides
// tool-call-disclosure.spec.ts, which resolves reviews to settle its runs).
//
// Serial + a shared single-FIFO mock queue: the project runs `--workers=1`
// and resets the queue per test.
import { test, expect } from "../../fixtures";
import {
  MockControl,
  getMockControlUrl,
  seedToolRunSession,
  settleThroughFileReview,
  writeFileBlock,
  awaitExecutionPhase,
  fileReviewApproveButton,
  toolCallRow,
  fileDiff,
  type SeededGatedExecution,
} from "../../helpers/approval";
import { isFileGateStack } from "../../helpers/mock-llm-control";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

const mockUrl = getMockControlUrl();
const fileGates = isFileGateStack();
const COLOR_SCHEMES = ["light", "dark"] as const;

test.describe("file-review card (deterministic mock LLM)", () => {
  test.skip(
    mockUrl === null,
    "Requires the mock-LLM stack — run via `make test-e2e-approval` (STIGMER_E2E_MOCK_LLM=1)",
  );
  test.skip(
    fileGates,
    "Requires the CAPTURE-substrate stack — on the file-gate stack writes gate " +
      "pre-execution and no review set is ever authored.",
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

  for (const scheme of COLOR_SCHEMES) {
    test(`review card presents the captured diff with its decisions (${scheme})`, async ({
      page,
      stigmerClient,
    }) => {
      seeded = await seedToolRunSession(stigmerClient, control, {
        toolTurns: [
          [writeFileBlock("call_review_1", "/tmp/e2e-review.txt", "alpha\nbeta\n")],
        ],
      });
      // The write flows (apply-then-review) and the run pauses at the review
      // boundary — the surface under test.
      await awaitExecutionPhase(
        stigmerClient,
        seeded.executionId,
        ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      );

      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/sessions/${seeded.sessionId}`);

      // The review card is up with its bulk decision; the captured change's
      // added lines render as the reviewable diff.
      await expect(fileReviewApproveButton(page)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("alpha")).toBeVisible();

      // Main-region screenshot: the review card has no single root target yet,
      // and the timeline above it is deterministic (one seeded write, one
      // review set), so the region pin is stable run to run.
      await expect(page.locator("main")).toHaveScreenshot(
        `file-review-card-${scheme}.png`,
        { maxDiffPixelRatio: 0.02 },
      );
    });
  }

  // --- Visual regression: the settled (kept) write's inline additive diff ---
  // Moved here from tool-card-ux.spec.ts: the settled row's diff is
  // capture-fed, so it exists only on this stack shape. The run settles
  // through the real review ("Keep all"), then the kept row must present the
  // additive diff with de-duplicated stats and the neutral card border.
  for (const scheme of COLOR_SCHEMES) {
    test(`completed write shows an inline additive diff (${scheme})`, async ({
      page,
      stigmerClient,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      seeded = await seedToolRunSession(stigmerClient, control, {
        toolTurns: [[writeFileBlock("call_done", "/tmp/e2e-done.txt", "one\ntwo\nthree\n")]],
      });
      await settleThroughFileReview(page, stigmerClient, seeded);

      // Scoped to the settled tool ROW: the page also renders the
      // file-changes summary section, whose diff legitimately carries its own
      // stats — the dedup contract under test is the row's inline preview.
      const settledRow = toolCallRow(page).first();
      const diff = fileDiff(settledRow).first();
      await expect(diff).toBeVisible({ timeout: 30_000 });

      // De-duplicated: the row states the "+3 -0" summary exactly ONCE. (The
      // pre-capture arrangement put it in the row header and suppressed the
      // body's copy; the capture-fed diff carries it in the body instead —
      // the invariant under test is "once per row", wherever it lives.)
      await expect(settledRow.getByText("+3 -0")).toHaveCount(1);

      // A settled (non-gate) tool card carries the same neutral border with no
      // accent — guard its computed width so the layer fix covers plain cards
      // too, in both color schemes (a screenshot cannot see a 1px line).
      const neutralBorder = await settledRow.evaluate((el) => {
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
});
