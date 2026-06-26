// Tool-call disclosure end-to-end, made deterministic by the mock LLM proxy
// (STIGMER_E2E_MOCK_LLM). What this layer proves that the jsdom suite cannot:
// against the REAL stack (stigmer-server + Temporal + runner) rendering the real
// web console, a turn's *completed* tool calls stay visible in the timeline
// after the run settles — they are NOT hidden behind a single "Ran N tools"
// collapse. That regression (the whole motivation for the persistent-row
// rework) can only be observed end-to-end, where the runner emits real
// COMPLETED tool calls into a real SessionViewer.
//
// Determinism: the execution is created with `auto_approve_all`, so the seeded
// tool turns run straight through to EXECUTION_COMPLETED with no approval
// interrupt. Tool choice is the native deep-agent built-ins (write_file /
// read_file); `shell`/MCP are not directly-callable native tools (shell is a
// sub-agent type), and the shell/MCP *bounded-preview* rendering is covered
// exhaustively at the jsdom layer where the result shape is controllable.
//
// Serial + a shared single-FIFO mock queue: the project runs `--workers=1` and
// resets the queue per test.
import { test, expect } from "../../fixtures";
import {
  MockControl,
  getMockControlUrl,
  seedToolRunSession,
  writeFileBlock,
  readFileBlock,
  awaitExecutionPhase,
  toolCallRow,
  toolRunGroup,
  fileDiff,
  type SeededGatedExecution,
} from "../../helpers/approval";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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
    // The run settles on its own (auto-approved) — no browser interaction needed
    // to reach the terminal state the timeline must render.
    await awaitExecutionPhase(
      stigmerClient,
      seeded.executionId,
      ExecutionPhase.EXECUTION_COMPLETED,
    );

    await page.goto(`/sessions/${seeded.sessionId}`);

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
    await awaitExecutionPhase(
      stigmerClient,
      seeded.executionId,
      ExecutionPhase.EXECUTION_COMPLETED,
    );

    await page.goto(`/sessions/${seeded.sessionId}`);

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
    await awaitExecutionPhase(
      stigmerClient,
      seeded.executionId,
      ExecutionPhase.EXECUTION_COMPLETED,
    );

    await page.goto(`/sessions/${seeded.sessionId}`);

    const row = toolCallRow(page).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    // The diff renders inline (no expansion needed) and shows the written lines.
    await expect(fileDiff(page).first()).toBeVisible();
    await expect(page.getByText("line one")).toBeVisible();
    await expect(page.getByText("line two")).toBeVisible();
  });
});
