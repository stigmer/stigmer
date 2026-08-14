// Tool-call disclosure end-to-end, made deterministic by the mock LLM proxy
// (STIGMER_E2E_MOCK_LLM). What this layer proves that the jsdom suite cannot:
// against the REAL stack (stigmer-server + Temporal + runner) rendering the real
// web console, a turn's *completed* tool calls stay visible in the timeline
// after the run settles — they are NOT hidden behind a single "Ran N tools"
// collapse. That regression (the whole motivation for the persistent-row
// rework) can only be observed end-to-end, where the runner emits real
// COMPLETED tool calls into a real SessionViewer.
//
// Determinism: the execution is created with `auto_approve_all`, so no
// pre-execution GATE interrupts the seeded turns. On this capture-substrate
// stack the flowed writes still pause the run at the REVIEW boundary
// (apply-then-review; capture is deliberately gate-independent, so file review
// opens even under the bypass), which the specs resolve through the real
// file-review card ("Keep all") — making this file the e2e coverage of the
// apply-then-review flow as well as of row persistence. Tool choice is the
// native deep-agent built-ins (write_file / read_file); the shell/MCP
// *bounded-preview* rendering is covered exhaustively at the jsdom layer where
// the result shape is controllable.
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
  type SeededGatedExecution,
} from "../../helpers/approval";

const mockUrl = getMockControlUrl();

test.describe("tool-call disclosure timeline (deterministic mock LLM)", () => {
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

    // The completed tool call persists as a visible row…
    await expect(toolCallRow(page).first()).toBeVisible({ timeout: 30_000 });
    // …and its target file is shown right there (FilePathLink strips the leading
    // slash, so match the stable basename).
    await expect(page.getByText("e2e-disclosure.txt", { exact: false })).toBeVisible();
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

    // Both completed rows persist; neither is folded into a run chip.
    await expect(toolCallRow(page)).toHaveCount(2, { timeout: 30_000 });
    await expect(toolRunGroup(page)).toHaveCount(0);
  });

  test("a completed write shows its content inline as an additive diff", async ({
    page,
    stigmerClient,
  }) => {
    // The write is a `preview` category: its content surfaces as a bounded
    // additive diff right in the timeline (filename-first), not hidden behind a
    // click. This is the post-execution half of the gate's before/after diff.
    seeded = await seedToolRunSession(stigmerClient, control, {
      toolTurns: [[writeFileBlock("call_diff", "/tmp/e2e-additive.txt", "line one\nline two\n")]],
    });
    await settleThroughFileReview(page, stigmerClient, seeded);

    const row = toolCallRow(page).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    // The diff renders inline (no expansion needed) and shows the written lines.
    await expect(fileDiff(page).first()).toBeVisible();
    await expect(page.getByText("line one")).toBeVisible();
    await expect(page.getByText("line two")).toBeVisible();
  });

  test("a large completed write is bounded to the shared budget and reveals in place", async ({
    page,
    stigmerClient,
  }) => {
    // The settled-card counterpart to the gate's bounded diff: a large write must
    // not render the whole file inline. The diff is always visible (no header
    // chevron) but clamped to the same shared budget (max-h-48) as the gate, with
    // a single in-place "Show more" that grows the clamp toward full height — it
    // does NOT promote to a separate detail panel. The clamp is layout-driven, so
    // it is only provable in a real browser — here.
    const big = Array.from({ length: 30 }, (_, i) => `row ${i + 1}`).join("\n") + "\n";
    seeded = await seedToolRunSession(stigmerClient, control, {
      toolTurns: [[writeFileBlock("call_big_settled", "/tmp/e2e-big-settled.txt", big)]],
    });
    await settleThroughFileReview(page, stigmerClient, seeded);

    const row = toolCallRow(page).first();
    await expect(row).toBeVisible({ timeout: 30_000 });

    // A settled preview card has NO competing header chevron — the diff body is
    // always visible, so the row carries no aria-expanded disclosure toggle
    // (RevealToggle is a native <button> with no explicit role attribute, so it
    // deliberately does not match this pin).
    await expect(row.locator('[role="button"][aria-expanded]')).toHaveCount(0);

    // Collapsed: the diff body is clipped to the budget — the shared
    // BoundedContent clamp (`stg:overflow-hidden` + the standard max height),
    // the same primitive the approval gate uses, so the two surfaces are
    // visually consistent by construction. (With capture restored, the row's
    // diff renders through the file-diff family, not the legacy tool-preview
    // wrapper — the selectors target the diff's own clamp.)
    const diff = fileDiff(row).first();
    await expect(diff).toBeVisible();
    const clamp = diff.locator('[class*="overflow-hidden"]').first();
    const collapsed = await clamp.evaluate((el) => el.clientHeight);
    const full = await clamp.evaluate((el) => el.scrollHeight);
    expect(collapsed).toBeGreaterThan(0);
    expect(collapsed).toBeLessThan(full); // actually clipped, not the whole file
    expect(collapsed).toBeLessThanOrEqual(220); // ~max-h-48 (192px) + table chrome

    // "Show more" reveals the rest IN PLACE — the clamp grows past its collapsed
    // height, rather than swapping in a separate detail panel.
    const expand = fileDiffExpand(row);
    await expect(expand).toBeVisible();
    await expand.click();
    const expanded = await clamp.evaluate((el) => el.clientHeight);
    expect(expanded).toBeGreaterThan(collapsed);
  });
});
