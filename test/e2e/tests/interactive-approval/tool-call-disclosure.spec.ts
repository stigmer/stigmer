// Tool-call disclosure end-to-end, made deterministic by the mock LLM proxy
// (STIGMER_E2E_MOCK_LLM). What this layer proves that the jsdom suite cannot:
// against the REAL stack (stigmer-server + Temporal + runner) rendering the real
// web console, a finished turn leads with its answer and keeps its completed
// tool calls one click away under "How it got there": each a one-line step,
// closed until clicked, opening in place to what it did. Never hidden behind
// an opaque "Ran N tools" count. Only observable end-to-end, where the runner
// emits real COMPLETED tool calls into a real SessionViewer.
//
// Determinism: the run is created with `auto_approve_all`, so no
// pre-execution GATE interrupts the seeded turns. On this capture-substrate
// stack the flowed writes are captured for review (apply-then-review; capture
// is deliberately gate-independent, so review opens even under the bypass),
// and the turn still ends: the specs open the settled session once its
// finished turn lists its Changed files, making this file the e2e coverage of
// the apply-then-review flow as well as of row persistence. Tool choice is the
// Stigmer harness's built-ins (write_file / read_file); the shell and MCP
// bodies are covered exhaustively at the jsdom layer where the result shape is
// controllable.
//
// Serial + a shared single-FIFO mock queue: the project runs `--workers=1` and
// resets the queue per test.
import { test, expect } from "../../fixtures";
import {
  MockControl,
  getMockControlUrl,
  seedToolRunSession,
  settleThroughFileReview,
  writeFileBlock,
  readFileBlock,
  toolCallRow,
  toolRunGroup,
  fileDiff,
  fileDiffExpand,
  openHowItGotThere,
  type SeededGatedRun,
} from "../../helpers/approval";

const mockUrl = getMockControlUrl();

test.describe("tool-call disclosure timeline (deterministic mock LLM)", () => {
  test.skip(
    mockUrl === null,
    "Requires the mock-LLM stack — run via `make test-e2e-approval` (STIGMER_E2E_MOCK_LLM=1)",
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

  test("completed tool work stays visible after the run settles (no per-turn collapse)", async ({
    page,
    stigmerClient,
  }) => {
    seeded = await seedToolRunSession(stigmerClient, control, {
      toolTurns: [[writeFileBlock("call_run_1", "/tmp/e2e-disclosure.txt", "hello from e2e")]],
    });
    // The write applies during the turn and the run pauses at the review
    // boundary; resolving it through the real card settles the run.
    await settleThroughFileReview(page, stigmerClient, seeded);

    // The finished turn says how it got there in one line, naming the work…
    await expect(page.getByRole("button", { name: /^How it got there: wrote 1 file/ })).toBeVisible({ timeout: 30_000 });
    // …which opens to the completed tool call as its own row…
    await openHowItGotThere(page);
    await expect(toolCallRow(page).first()).toBeVisible({ timeout: 30_000 });
    // …and its target file is shown right there, on the row (FilePathLink
    // strips the leading slash, so match the stable basename; the turn's
    // outcome below names the changed file too).
    await expect(toolCallRow(page).first().getByText("e2e-disclosure.txt", { exact: false })).toBeVisible();
    // …and there is NO aggregate "Ran N tools" pill hiding the work.
    await expect(page.getByText(/Ran \d+ tool/)).toHaveCount(0);
  });

  test("renders multiple completed tools as their own persistent rows", async ({
    page,
    stigmerClient,
  }) => {
    // A write then a read of distinct files: two different categories, so two
    // standalone rows (no run-grouping). Both must remain visible after settle.
    seeded = await seedToolRunSession(stigmerClient, control, {
      toolTurns: [
        [writeFileBlock("call_w", "/tmp/e2e-row-a.txt", "alpha")],
        [readFileBlock("call_r", "/tmp/e2e-row-a.txt")],
      ],
    });
    await settleThroughFileReview(page, stigmerClient, seeded);

    // Both completed rows are there once the turn's steps open; neither is
    // folded into a run chip.
    await openHowItGotThere(page);
    await expect(toolCallRow(page)).toHaveCount(2, { timeout: 30_000 });
    await expect(toolRunGroup(page)).toHaveCount(0);
  });

  test("a completed write shows its content inline as an additive diff", async ({
    page,
    stigmerClient,
  }) => {
    // A settled write is one closed line; one click opens it in place to the
    // additive diff of what it wrote (filename-first). This is the
    // post-execution half of the gate's before/after diff.
    seeded = await seedToolRunSession(stigmerClient, control, {
      toolTurns: [[writeFileBlock("call_diff", "/tmp/e2e-additive.txt", "line one\nline two\n")]],
    });
    await settleThroughFileReview(page, stigmerClient, seeded);
    await openHowItGotThere(page);

    const row = toolCallRow(page).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    // Closed until clicked: the row's own toggle, and no diff yet.
    const toggle = row.locator('[data-cursor-target="thread-card-toggle"]');
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(fileDiff(row)).toHaveCount(0);
    // Opened in place, it shows the written lines.
    await toggle.click();
    await expect(fileDiff(row).first()).toBeVisible();
    await expect(row.getByText("line one")).toBeVisible();
    await expect(row.getByText("line two")).toBeVisible();
  });

  test("a large completed write is bounded to the shared budget and reveals in place", async ({
    page,
    stigmerClient,
  }) => {
    // The settled-card counterpart to the gate's bounded diff: a large write must
    // not render the whole file inline. Opened, the diff is clamped to the same
    // shared budget (max-h-48) as the gate, with a single in-place "Show more"
    // that grows the clamp toward full height — it does NOT promote to a
    // separate detail panel. The clamp is layout-driven, so it is only provable
    // in a real browser — here.
    const big = Array.from({ length: 30 }, (_, i) => `row ${i + 1}`).join("\n") + "\n";
    seeded = await seedToolRunSession(stigmerClient, control, {
      toolTurns: [[writeFileBlock("call_big_settled", "/tmp/e2e-big-settled.txt", big)]],
    });
    await settleThroughFileReview(page, stigmerClient, seeded);
    await openHowItGotThere(page);

    const row = toolCallRow(page).first();
    await expect(row).toBeVisible({ timeout: 30_000 });

    // A settled step is closed until clicked: the row carries exactly one
    // header toggle (the card's `thread-card-toggle`; RevealToggle, the diff's
    // own in-place reveal, is another button and deliberately does not match
    // this pin), and opening it shows the diff in place.
    const toggle = row.locator('[data-cursor-target="thread-card-toggle"]');
    await expect(toggle).toHaveCount(1);
    await toggle.click();

    // Collapsed: the diff body is clipped to the budget — the shared
    // BoundedContent clamp (`stg:overflow-hidden` + the standard max height),
    // the same primitive the approval gate uses, so the two surfaces are
    // visually consistent by construction. (With capture on, the row's diff
    // renders through the file-diff family, not the tool-preview wrapper —
    // the selectors target the diff's own clamp.)
    const diff = fileDiff(row).first();
    await expect(diff).toBeVisible();
    const clamp = diff.locator('[class*="overflow-hidden"]').first();
    // Visible is not laid out, and the diff can re-render after it appears: a
    // node read mid re-render reports 0 for one height and not the other
    // (#2260). So both heights come from one read of one element, polled until
    // the clamp is laid out and clipping: actually clipped, not the whole file.
    // A clamp that never clips still fails, at the poll's timeout.
    let measured = { collapsed: 0, full: 0 };
    await expect
      .poll(async () => {
        measured = await clamp.evaluate((el) => ({ collapsed: el.clientHeight, full: el.scrollHeight }));
        return measured.collapsed > 0 && measured.collapsed < measured.full;
      })
      .toBe(true);
    const { collapsed } = measured;
    expect(collapsed).toBeLessThanOrEqual(220); // ~max-h-48 (192px) + table chrome

    // "Show more" reveals the rest IN PLACE — the clamp grows past its collapsed
    // height, rather than swapping in a separate detail panel.
    const expand = fileDiffExpand(row);
    await expect(expand).toBeVisible();
    await expand.click();
    await expect.poll(() => clamp.evaluate((el) => el.clientHeight)).toBeGreaterThan(collapsed);
  });
});
