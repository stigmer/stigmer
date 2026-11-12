// A newcomer's first question, end to end on the mock model, in an
// organization of the test's own where nothing has run yet.
//
// The script: the turn saves variance-report.md into the outputs folder,
// then closes with a line. Saving into the outputs folder needs no approval,
// so the turn runs to its end with no gate.
//
// Pins:
//   - the launcher opens on "What should your agent do for your users?",
//     with the four example jobs;
//   - picking "Variance report" makes the Variance Reporter agent and fills
//     the composer: the agent picked, ledger.csv attached, the first
//     message written;
//   - Send starts the conversation, and the agent's file is listed under
//     what it saved.
//
// Skipped on the file-gate stack, where every write gates before it runs.
import { test, expect } from "../../fixtures";
import { assertTurnIdle, getNewSessionComposer, START_SESSION_WAITS_MS, waitForAIResponse } from "../../helpers/session";
import { MockControl, getMockControlUrl, isFileGateStack } from "../../helpers/mock-llm-control";
import { anthropicText, anthropicToolUses } from "../../fixtures/mock-llm";
import { assertNoErrorBoundary } from "../../helpers/navigation";

/** One wait on a turn on a loaded runner (session-run-flow.spec.ts's budget). */
const TURN_BUDGET_MS = 90_000;

/** The question, the pick and its agent, a session start, one turn and 60 s of bounded short waits. */
const CASE_BUDGET_MS = START_SESSION_WAITS_MS.composer * 2 + START_SESSION_WAITS_MS.sessionUrl + TURN_BUDGET_MS + 60_000;

const REPORT = "# Variance report\n\n| Account | Variance |\n| --- | --- |\n| Marketing | +56.7% |\n";

test.describe("CON-06 a newcomer's first question, end to end on the mock model", () => {
  test.skip(!getMockControlUrl(), "drives the mock model's script");
  test.skip(isFileGateStack(), "every write gates before it runs on the file-gate stack");

  test("asks the question, a pick fills the composer with the agent, its sample and its message, and the run saves the report", async ({
    page,
    freshOrg,
  }) => {
    test.setTimeout(CASE_BUDGET_MS);
    void freshOrg;
    const control = new MockControl(getMockControlUrl()!);
    await control.reset();
    await control.enqueue(
      anthropicToolUses([
        {
          toolCallId: "toolu_variance_report",
          toolName: "write_file",
          toolInput: { file_path: "/.stigmer/outputs/variance-report.md", content: REPORT },
        },
      ]),
    );
    await control.enqueue(anthropicText("The variance report is saved as variance-report.md."));

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "What should your agent do for your users?" })).toBeVisible({
      timeout: START_SESSION_WAITS_MS.composer,
    });
    for (const job of ["Variance report", "Ticket replies", "Contract check", "Invoice match"]) {
      await expect(page.getByRole("button", { name: job })).toBeVisible();
    }

    await page.getByRole("button", { name: "Variance report" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Send it the sample" })).toBeVisible({
      timeout: START_SESSION_WAITS_MS.composer,
    });
    await expect(page.getByText("Variance Reporter is made. Its sample ledger is attached.")).toBeVisible();
    const composer = getNewSessionComposer(page);
    await expect(composer.locator("textarea")).toHaveValue("Here is this quarter's ledger, ledger.csv. Write the variance report.");
    const chip = composer.getByRole("list", { name: "Attached files" }).getByRole("listitem");
    await expect(chip).toHaveAttribute("aria-label", /^ledger\.csv/, { timeout: 15_000 });
    await expect(chip).not.toHaveAttribute("aria-label", /uploading/, { timeout: 15_000 });
    await expect(composer.getByRole("button", { name: /Variance Reporter/ }).first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Send message" }).click();
    await page.waitForURL(/\/sessions\/ses_/, { timeout: START_SESSION_WAITS_MS.sessionUrl });
    await assertNoErrorBoundary(page);
    await waitForAIResponse(page, { timeout: TURN_BUDGET_MS });
    await assertTurnIdle(page);

    await page.getByRole("button", { name: "Show panel" }).click();
    await page.getByRole("radio", { name: /^Files( \(\d+\))?$/ }).click({ timeout: 15_000 });
    await expect(page.getByRole("region", { name: "Given to the conversation" }).getByText("ledger.csv")).toBeVisible({
      timeout: 15_000,
    });
    const saved = page.getByRole("region", { name: "Saved by the agent" });
    await expect(saved.getByText("variance-report.md", { exact: true })).toBeVisible({ timeout: 15_000 });

    expect(await control.remaining()).toBe(0);
  });
});
