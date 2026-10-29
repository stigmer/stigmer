// A running shell command's output reaches the console while it runs, end to
// end on the real stack (stigmer-server + Temporal + the runner, the Stigmer
// harness in its agent host) and the real web console. What only this layer
// proves: the runner's shell streams what the command prints, the runtime
// sends it to the session as tool-output previews between status writes, the
// server relays them, and the console's shell row shows them in its terminal
// block before the command ends, then its finished view once it returns.
//
// Determinism: the mock LLM scripts one `execute` call and the run is created
// with `auto_approve_all`, so no gate holds it. The command prints a line
// every two seconds; the spec asserts the first lines are visible while the
// row still shows the live view, which it can only be while the command runs.
//
// Serial + a shared single-FIFO mock queue: the project runs `--workers=1` and
// resets the queue per test.
import { test, expect } from "../../fixtures";
import {
  MockControl,
  getMockControlUrl,
  seedToolRunSession,
  shellBlock,
  toolCallRow,
  type SeededGatedRun,
} from "../../helpers/approval";

const mockUrl = getMockControlUrl();

/** Six lines, two seconds apart: about twelve seconds of a command that is visibly running. */
const COMMAND = "for i in 1 2 3 4 5 6; do echo live-line-$i; sleep 2; done";

test.describe("a running shell command's output (deterministic mock LLM)", () => {
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

  test("streams into the shell row while the command runs, then shows the finished view", async ({
    page,
    stigmerClient,
  }) => {
    seeded = await seedToolRunSession(stigmerClient, control, {
      toolTurns: [[shellBlock("call_live_1", COMMAND)]],
      message: "Run the slow command.",
    });
    await page.goto(`/sessions/${seeded.sessionId}`);

    // While the command runs: the live view, with lines it has printed and
    // not the last one, which is still seconds away.
    const live = page.locator('[data-cursor-target="terminal-live-output"]');
    await expect(live).toContainText("live-line-2", { timeout: 30_000 });
    await expect(live).not.toContainText("live-line-6");

    // Once it returns: the row settles to its finished view (a shell row
    // collapses to the tail of its output), which ends with the last line,
    // and the live view is gone.
    await expect(toolCallRow(page).first()).toContainText("live-line-6", { timeout: 60_000 });
    await expect(live).toHaveCount(0);
  });
});
