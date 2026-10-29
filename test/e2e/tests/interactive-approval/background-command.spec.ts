// A command the agent runs in the background, end to end on the real stack
// (stigmer-server + Temporal + the runner, the Stigmer harness in its agent
// host) and the real web console. What only this layer proves: the runner's
// registry reports the command's life, the session's log carries it as the
// command's status beside the start's call, its output reaches the console
// while it runs, and the console's Stop reaches the runner, which stops that
// command alone while the turn waits for it.
//
// Determinism: the mock LLM scripts the start (an `execute` with
// `background: true`), then three texts: the reply that ends while the
// command runs, the reply after the turn's one reminder (the turn then waits
// for the command), and the answer to the command's end. The run is created
// with `auto_approve_all`, so no gate holds it. The ticking command prints a
// line every two seconds, so its row is seen running before it ends.
//
// Serial + a shared single-FIFO mock queue: the project runs `--workers=1` and
// resets the queue per test.
import { test, expect } from "../../fixtures";
import {
  MockControl,
  getMockControlUrl,
  seedGatedSession,
  seedToolRunSession,
  shellBlock,
  toolCallRow,
  type SeededGatedRun,
} from "../../helpers/approval";

const mockUrl = getMockControlUrl();

/** Four ticks, two seconds apart: a command seen running, then seen to exit. */
const TICKS = "for i in 1 2 3 4; do echo tick-$i; sleep 2; done";

test.describe("a command the agent runs in the background (deterministic mock LLM)", () => {
  test.skip(
    mockUrl === null,
    "Requires the mock-LLM stack — run via `make test-e2e-approval` (STIGMER_E2E_MOCK_LLM=1)",
  );
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  const control = new MockControl(mockUrl ?? "");
  let seeded: SeededGatedRun | null = null;

  test.afterEach(async () => {
    if (seeded) {
      await seeded.cleanup();
      seeded = null;
    }
    await control.reset();
  });

  test("its row runs with its output live, then says how it ended", async ({ page, stigmerClient }) => {
    seeded = await seedToolRunSession(stigmerClient, control, {
      toolTurns: [[shellBlock("call_bg_ticks", TICKS, { background: true })]],
      closingTexts: ["It runs in the background.", "I will wait for the ticks.", "The ticks finished."],
      message: "Run the ticks in the background.",
    });
    await page.goto(`/sessions/${seeded.sessionId}`);

    const row = toolCallRow(page).filter({ hasText: "Background" }).first();
    const status = row.locator('[data-cursor-target="background-command-status"]');
    await expect(status).toContainText("Running in the background", { timeout: 30_000 });
    // Previews are not replayed to a page that opens late, so the first tick
    // may have streamed before it connected: any early tick proves the live view.
    await expect(row.locator('[data-cursor-target="terminal-live-output"]')).toContainText(/tick-[1-3]/, { timeout: 30_000 });
    await expect(row).not.toContainText("Started in the background");

    await expect(status).toHaveText("Exited · code 0", { timeout: 60_000 });
    await expect(page.getByText("The ticks finished.")).toBeVisible({ timeout: 30_000 });
  });

  test("the row's Stop stops it while the turn waits, and the agent answers", async ({ page, stigmerClient }) => {
    seeded = await seedToolRunSession(stigmerClient, control, {
      toolTurns: [[shellBlock("call_bg_server", "sleep 300", { background: true })]],
      closingTexts: ["It runs in the background.", "I will wait for the server.", "You stopped the server."],
      message: "Start the server in the background.",
    });
    await page.goto(`/sessions/${seeded.sessionId}`);

    // The turn waits for the command: the agent's reply is in, and the
    // thread's tail line names what it waits for.
    await expect(page.getByText("I will wait for the server.")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-cursor-target="liveness-status-line"]')).toContainText("Waiting for `sleep 300`", { timeout: 30_000 });

    const row = toolCallRow(page).filter({ hasText: "Background" }).first();
    await row.locator('[data-cursor-target="background-command-stop"]').click();
    await expect(row.locator('[data-cursor-target="background-command-status"]')).toHaveText("Stopped by a person", { timeout: 30_000 });
    await expect(page.getByText("You stopped the server.")).toBeVisible({ timeout: 30_000 });
  });

  test("approving a background start says it runs in the background and when it stops", async ({ page, stigmerClient }) => {
    seeded = await seedGatedSession(stigmerClient, control, {
      gateBlocks: [shellBlock("call_bg_gated", "npm run dev", { background: true })],
      message: "Start the dev server in the background.",
    });
    await page.goto(`/sessions/${seeded.sessionId}`);
    await expect(page.locator('[data-cursor-target="approval-background-note"]')).toContainText(
      "Runs in the background while the agent works; it stops when the turn ends or pauses for approval.",
      { timeout: 30_000 },
    );
  });
});
