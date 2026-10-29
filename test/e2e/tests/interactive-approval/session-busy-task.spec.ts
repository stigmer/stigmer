// A busy task in the console's session view, end to end on the mock model:
// the jobs the view is designed for, through the console's real wiring.
//
// The script: the agent keeps a two-item to-do list, saves a report into its
// outputs folder (never gated: it comes back as a File), then runs a shell
// command, which waits for the person's approval; once approved, it answers.
//
// Pins:
//   - follow: while the turn waits, one line says so above the composer,
//     with how far the to-do list has got and Stop on it;
//   - steer: the approval is on screen and answering it resumes the turn;
//   - receive: the ended turn closes with what it made, and the saved File
//     opens from there in the console's inspector.
//
// The guest's side of the same jobs runs on the local cloud's journey: a
// chat link's guest token has no open-source implementation, so the framed
// chat page is cloud-only (embed-agent-flow.spec.ts says why).
//
// Serial with the shared single-FIFO mock queue (`--workers=1`), as the
// other specs in this project.
import { test, expect } from "../../fixtures";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import {
  MockControl,
  approveButton,
  awaitRunPhase,
  awaitRunTerminal,
  getMockControlUrl,
  seedGatedSession,
  shellBlock,
  type SeededGatedRun,
} from "../../helpers/approval";

const mockUrl = getMockControlUrl();
const REPORT = "variance-report.md";

test.describe("A busy task in the session view (deterministic mock LLM)", () => {
  test.skip(mockUrl === null, "Requires the mock-LLM stack — run via `make test-e2e-approval` (STIGMER_E2E_MOCK_LLM=1)");
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

  test("follows the turn, answers its approval, and opens what it made", async ({ page, stigmerClient }) => {
    seeded = await seedGatedSession(stigmerClient, control, {
      message: "Write the variance report, then check the build.",
      gateTurns: [
        [
          {
            toolCallId: "toolu_todos",
            toolName: "write_todos",
            toolInput: {
              todos: [
                { content: "Write the variance report", status: "in_progress" },
                { content: "Check the build", status: "pending" },
              ],
            },
          },
        ],
        [
          {
            toolCallId: "toolu_report",
            toolName: "write_file",
            toolInput: { file_path: `/.stigmer/outputs/${REPORT}`, content: "# Variance\n\nTravel is 12% over plan.\n" },
          },
        ],
        [shellBlock("toolu_build", "echo build ok")],
      ],
    });
    await awaitRunPhase(stigmerClient, seeded.runId, RunPhase.RUN_WAITING_FOR_APPROVAL);

    await page.goto(`/sessions/${seeded.sessionId}`);

    // Follow: one line, above the composer, while the turn waits on the person.
    const activity = page.getByRole("status").filter({ hasText: "Waiting for you" });
    await expect(activity).toBeVisible({ timeout: 30_000 });
    await expect(activity).toContainText("0 of 2 done");
    await expect(activity.getByRole("button", { name: "Stop" })).toBeVisible();

    // Steer: the approval is answered from the screen and the turn resumes.
    await approveButton(page).click();
    const phase = await awaitRunTerminal(stigmerClient, seeded.runId);
    expect(phase, "the approved turn completes").toBe(RunPhase.RUN_COMPLETED);

    // Receive: the turn closes with what it made, and the File opens in place.
    const outcome = page.getByRole("region", { name: "What this turn produced" });
    await expect(outcome).toBeVisible({ timeout: 30_000 });
    await expect(outcome).toContainText("Done");
    await expect(page.getByRole("status").filter({ hasText: "Waiting for you" })).toHaveCount(0);
    await outcome.getByRole("button", { name: new RegExp(REPORT.replace(".", "\\.")) }).click();
    await expect(page.getByRole("button", { name: "Hide panel" })).toBeVisible({ timeout: 15_000 });
    // The opened File renders its markdown; the write's card above shows the
    // same text as raw source in a <pre>, so the check names the paragraph.
    await expect(page.getByRole("paragraph").filter({ hasText: "Travel is 12% over plan." })).toBeVisible({ timeout: 15_000 });
  });
});
