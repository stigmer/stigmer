// File-review card UX, end-to-end against the CAPTURE-substrate stack
// (deterministic via the mock LLM proxy). Apply-then-review is where the
// file DIFF surface lives now: in a session with file review on (the console
// turns it on for every conversation it starts), a flowed write is captured,
// the turn ends, and the dock presents the before/after diff with the
// Keep-all / Undo decisions. These pin what that card shows, plus the two
// decisions working on a finished turn — the successor of the pre-capture
// "gate renders the diff" checks; how the dock LOOKS, in light and dark, is
// the kit's gallery's (test/visual, the `file-review-dock` scene)
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
  awaitRunPhase,
  fileReviewApproveButton,
  fileReviewRejectButton,
  toolCallRow,
  fileDiff,
  openHowItGotThere,
  type SeededGatedRun,
} from "../../helpers/approval";
import { isFileGateStack } from "../../helpers/mock-llm-control";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

const mockUrl = getMockControlUrl();
const fileGates = isFileGateStack();

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
  let seeded: SeededGatedRun | null = null;

  test.afterEach(async () => {
    if (seeded) {
      await seeded.cleanup();
      seeded = null;
    }
    await control.reset();
  });

  test("review card presents the captured diff with its decisions", async ({
    page,
    stigmerClient,
  }) => {
    seeded = await seedToolRunSession(stigmerClient, control, {
      toolTurns: [
        [writeFileBlock("call_review_1", "/tmp/e2e-review.txt", "alpha\nbeta\n")],
      ],
    });
    // The write flows (apply-then-review) and the turn ends; review never
    // holds it. The dock offering the finished turn's edit is the surface
    // under test.
    await awaitRunPhase(
      stigmerClient,
      seeded.runId,
      RunPhase.RUN_COMPLETED,
    );

    await page.goto(`/sessions/${seeded.sessionId}`);

    // The review card is up with its bulk decision after the turn ended;
    // the captured change's added lines render as the reviewable diff, on
    // the write's step (one of the finished turn's steps, opened).
    await expect(fileReviewApproveButton(page)).toBeVisible({ timeout: 30_000 });
    await openHowItGotThere(page);
    await toolCallRow(page).first().locator('[data-cursor-target="thread-card-toggle"]').click();
    await expect(page.getByText("alpha")).toBeVisible();
  });

  // Undo on a finished turn: the console's one other decision. The server
  // starts a turn that puts the file back; the dock leaves and the edit's row
  // reads the verdict. (That the undo's own turn never shows in the thread is
  // pinned by useSessionConversation's unit tests.)
  test("undo on a finished turn settles the review and the row reads Discarded", async ({
    page,
    stigmerClient,
  }) => {
    seeded = await seedToolRunSession(stigmerClient, control, {
      toolTurns: [[writeFileBlock("call_undo", "/tmp/e2e-undo.txt", "undo me\n")]],
    });
    await awaitRunPhase(stigmerClient, seeded.runId, RunPhase.RUN_COMPLETED);
    await page.goto(`/sessions/${seeded.sessionId}`);

    await fileReviewRejectButton(page).click({ timeout: 30_000 });
    await expect(fileReviewApproveButton(page)).toHaveCount(0, { timeout: 30_000 });
    // The write is a step of the finished turn, under "How it got there".
    await openHowItGotThere(page);
    await expect(toolCallRow(page).first().getByText("Discarded")).toBeVisible({ timeout: 30_000 });
  });

  // --- The settled (kept) write's inline additive diff ---------------------
  // Moved here from tool-card-ux.spec.ts: the settled row's diff is
  // capture-fed, so it exists only on this stack shape. The finished turn's
  // review settles through the real dock ("Keep all"), then the kept row must present the
  // additive diff with de-duplicated stats and the neutral card border.
  test("completed write shows an inline additive diff", async ({
    page,
    stigmerClient,
  }) => {
    seeded = await seedToolRunSession(stigmerClient, control, {
      toolTurns: [[writeFileBlock("call_done", "/tmp/e2e-done.txt", "one\ntwo\nthree\n")]],
    });
    await settleThroughFileReview(page, stigmerClient, seeded);

    // The kept write is a closed step of the finished turn: open the turn's
    // steps, then the step, which shows its diff in place.
    await openHowItGotThere(page);
    // Scoped to the settled tool ROW: the page also renders the
    // file-changes summary section, whose diff legitimately carries its own
    // stats — the dedup contract under test is the row's inline preview.
    const settledRow = toolCallRow(page).first();
    await settledRow.locator('[data-cursor-target="thread-card-toggle"]').click();
    const diff = fileDiff(settledRow).first();
    await expect(diff).toBeVisible({ timeout: 30_000 });

    // De-duplicated: the row states its "+3 −0" exactly ONCE, on its line;
    // the capture-fed diff below it carries no second copy.
    await expect(settledRow).toContainText("+3 \u22120");
    expect((await settledRow.innerText()).split("+3").length - 1, "the row states its counts once").toBe(1);

    // The card the finished turn's steps sit in carries the same neutral
    // border with no accent — guard its computed width so the layer fix
    // covers plain cards too (a tolerant screenshot cannot see a 1px line;
    // the kit's gallery holds the card's border in both colour modes with no
    // tolerance). Polled: the steps re-render as the kept review settles,
    // and a style read from a node detached mid-render comes back empty.
    const stepsCard = page.getByRole("button", { name: /^How it got there/ }).first().locator("..");
    const readBorder = () =>
      stepsCard.evaluate((el) => {
        const s = getComputedStyle(el);
        return { top: s.borderTopWidth, color: s.borderTopColor };
      });
    await expect
      .poll(async () => parseFloat((await readBorder()).top), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1);
    const neutralBorder = await readBorder();
    expect(neutralBorder.color).not.toBe("transparent");
    expect(neutralBorder.color).not.toMatch(/,\s*0\)\s*$/);
  });
});
