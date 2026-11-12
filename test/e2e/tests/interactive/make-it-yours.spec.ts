// After a newcomer's first job, the console leads them to make the agent
// theirs, end to end on the mock model, in an organization of the test's
// own where nothing has run yet.
//
// The script, one run at a time (each run's model calls are queued just
// before it starts, so a run never eats another's):
//   1. the first job: saves variance-report.md, then a closing line;
//   2. after the instructions change, a run on the sample: the same two calls;
//   3. a run on the person's own CSV: one closing line;
//   4. after the skill is added, a run on the sample: saves
//      variance-report.md and variance-report.csv, then a closing line.
// Saving into the outputs folder needs no approval, so every run ends with
// no gate.
//
// Pins:
//   - the line under the first job leads to the agent page's "Make it yours"
//     tab;
//   - changing the instructions there saves a new version (the Versions tab
//     counts two) and offers a run on the sample, which opens the launcher
//     with the sample attached and the message written;
//   - "Choose a file" opens the launcher on the same agent with the message
//     for the person's own file written; their file attaches and runs;
//   - "Add it" makes the ready-made skill in the organization and adds it to
//     the agent; the next run's record names the skill it loaded;
//   - the dashboard's journey card counts four of six steps done.
//
// Skipped on the file-gate stack, where every write gates before it runs.
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/client";
import { ListRunsBySessionRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import { assertTurnIdle, getNewSessionComposer, START_SESSION_WAITS_MS, waitForAIResponse } from "../../helpers/session";
import { MockControl, getMockControlUrl, isFileGateStack } from "../../helpers/mock-llm-control";
import { anthropicText, anthropicToolUses } from "../../fixtures/mock-llm";
import { assertNoErrorBoundary } from "../../helpers/navigation";

/** One wait on a turn on a loaded runner (session-run-flow.spec.ts's budget). */
const TURN_BUDGET_MS = 90_000;

/** Four session starts, four turns, and 180 s of bounded short waits (pages, saves, the skill's push). */
const CASE_BUDGET_MS = 4 * (START_SESSION_WAITS_MS.composer + START_SESSION_WAITS_MS.sessionUrl + TURN_BUDGET_MS) + 180_000;

const SLUG = "variance-reporter";
const SKILL = "spreadsheet-export";
const REPORT = "# Variance report\n\n| Account | Variance |\n| --- | --- |\n| Marketing | +56.7% |\n";
const TABLE = "account,variance_pct\nMarketing,56.7\n";
const SAMPLE_MESSAGE = "Here is this quarter's ledger, ledger.csv. Write the variance report.";
const OWN_FILE_MESSAGE = "Here is one of our ledgers. Write the variance report.";
const OWN_LEDGER = "account,budget,actual\nRevenue,90000,99500\nMarketing,7000,9800\n";

/** Numbers each queued tool call, so no two calls in the case share an id. */
let toolCalls = 0;

/** The model calls of a run that saves `files` into its outputs folder, then says so. */
async function enqueueSavingRun(control: MockControl, files: readonly { readonly name: string; readonly content: string }[]): Promise<void> {
  await control.enqueue(
    anthropicToolUses(
      files.map((file) => ({
        toolCallId: `toolu_save_${++toolCalls}`,
        toolName: "write_file",
        toolInput: { file_path: `/.stigmer/outputs/${file.name}`, content: file.content },
      })),
    ),
  );
  await control.enqueue(anthropicText(`Saved ${files.map((file) => file.name).join(" and ")}.`));
}

/** Sends the launcher's composer as it stands and waits for the run's answer; returns the new session's id. */
async function sendAndFinish(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Send message" }).click();
  await page.waitForURL(/\/sessions\/ses_/, { timeout: START_SESSION_WAITS_MS.sessionUrl });
  await assertNoErrorBoundary(page);
  await waitForAIResponse(page, { timeout: TURN_BUDGET_MS });
  await assertTurnIdle(page);
  return /\/sessions\/(ses_[^/?#]+)/.exec(page.url())?.[1] ?? "";
}

/** The launcher's composer has finished attaching `name`. */
async function expectAttached(page: Page, name: string): Promise<void> {
  const chip = getNewSessionComposer(page).getByRole("list", { name: "Attached files" }).getByRole("listitem");
  await expect(chip).toHaveAttribute("aria-label", new RegExp(`^${name.replace(".", "\\.")}`), { timeout: 15_000 });
  await expect(chip).not.toHaveAttribute("aria-label", /uploading/, { timeout: 15_000 });
}

/** The skill references a session's run loaded, by slug and by id. */
async function loadedSkills(client: Stigmer, sessionId: string): Promise<readonly { readonly slug: string; readonly id: string }[]> {
  const runs = await client.run.listBySession(create(ListRunsBySessionRequestSchema, { sessionId }));
  return runs.entries.flatMap((run) => (run.status?.loadedVersions?.skills ?? []).map((ref) => ({ slug: ref.slug, id: ref.id })));
}

test.describe("CON-08 after the first job, the console says what comes next and leads to making the agent theirs: change its instructions, run it on their own file, give it a skill", () => {
  test.skip(!getMockControlUrl(), "drives the mock model's script");
  test.skip(isFileGateStack(), "every write gates before it runs on the file-gate stack");

  test("the first job's next line leads to the agent's Make it yours tab, whose three acts each run, and the dashboard counts four of six", async ({
    page,
    freshOrg,
    stigmerClient,
  }) => {
    test.setTimeout(CASE_BUDGET_MS);
    const control = new MockControl(getMockControlUrl()!);
    await control.reset();
    const tabUrl = `/library/agents/${freshOrg.slug}/${SLUG}?tab=make-it-yours`;

    // The first job, from the newcomer's question.
    await enqueueSavingRun(control, [{ name: "variance-report.md", content: REPORT }]);
    await page.goto("/");
    await page.getByRole("button", { name: "Variance report" }).click({ timeout: START_SESSION_WAITS_MS.composer });
    await expect(getNewSessionComposer(page).locator("textarea")).toHaveValue(SAMPLE_MESSAGE, { timeout: START_SESSION_WAITS_MS.composer });
    await expectAttached(page, "ledger.csv");
    await sendAndFinish(page);

    // The line under it leads to the agent's Make it yours tab.
    const next = page.locator("[data-stgm-journey-next]");
    await expect(next).toContainText("Your first agent did a job.", { timeout: 15_000 });
    await next.getByRole("link", { name: "Make it yours" }).click();
    await expect(page.getByRole("tab", { name: "Make it yours", selected: true })).toBeVisible({ timeout: 15_000 });

    // Change what it does: the 10% line becomes 5%, saved as a new version.
    const change = page.getByRole("region", { name: "Change what it does" });
    await change.getByRole("button", { name: /more than 10% over/ }).click();
    const instructions = change.locator("textarea");
    const before = await instructions.inputValue();
    expect(before).toContain("more than 10% over");
    await instructions.fill(before.replace("more than 10% over", "more than 5% over"));
    await change.getByRole("button", { name: "Save" }).click();
    await expect(change.getByText("Saved as a new version.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tab", { name: /Versions/ })).toContainText("2", { timeout: 15_000 });
    const agent = await stigmerClient.agent.getByReference({ org: freshOrg.id, slug: SLUG });
    expect(agent.spec?.instructions).toContain("more than 5% over");

    // Run it on the sample: the launcher, the sample attached, the message written.
    await enqueueSavingRun(control, [{ name: "variance-report.md", content: REPORT }]);
    await change.getByRole("link", { name: "Run it on the sample" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Run it on the sample" })).toBeVisible({
      timeout: START_SESSION_WAITS_MS.composer,
    });
    await expect(getNewSessionComposer(page).locator("textarea")).toHaveValue(SAMPLE_MESSAGE);
    await expectAttached(page, "ledger.csv");
    const sampleSession = await sendAndFinish(page);
    expect((await stigmerClient.session.get(sampleSession)).spec?.agentRef?.slug).toBe(SLUG);

    // Try your own file: the same agent, the own-file message, their CSV attached.
    await control.enqueue(anthropicText("The variance report for your ledger is saved."));
    await page.goto(tabUrl);
    await page.getByRole("region", { name: "Try your own file" }).getByRole("link", { name: "Choose a file" }).click({ timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Try it on your own file" })).toBeVisible({
      timeout: START_SESSION_WAITS_MS.composer,
    });
    const composer = getNewSessionComposer(page);
    await expect(composer.locator("textarea")).toHaveValue(OWN_FILE_MESSAGE);
    await composer.locator('input[type="file"]').setInputFiles({
      name: "our-ledger.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(OWN_LEDGER),
    });
    await expectAttached(page, "our-ledger.csv");
    const ownSession = await sendAndFinish(page);
    expect((await stigmerClient.session.get(ownSession)).spec?.agentRef?.slug).toBe(SLUG);

    // Give it a skill: made in the organization, added to the agent.
    await page.goto(tabUrl);
    const skillCard = page.getByRole("region", { name: "Give it a skill" });
    await skillCard.getByRole("button", { name: "Add it" }).click({ timeout: 15_000 });
    await expect(skillCard.getByText("Spreadsheet export")).toBeVisible();
    await expect(skillCard).toContainText("is on. Its runs hand back a .csv beside the report.", { timeout: 15_000 });
    const skill = await stigmerClient.skill.getByReference({ org: freshOrg.id, slug: SKILL });
    const skillId = skill.metadata?.id ?? "";
    expect(skillId).not.toBe("");

    // A run on the sample now loads the skill, by the run's own record.
    await enqueueSavingRun(control, [
      { name: "variance-report.md", content: REPORT },
      { name: "variance-report.csv", content: TABLE },
    ]);
    await skillCard.getByRole("link", { name: "Run it on the sample" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Run it on the sample" })).toBeVisible({
      timeout: START_SESSION_WAITS_MS.composer,
    });
    await expectAttached(page, "ledger.csv");
    const skillSession = await sendAndFinish(page);
    await expect
      .poll(async () => (await loadedSkills(stigmerClient, skillSession)).some((ref) => ref.slug === SKILL || ref.id === skillId), {
        timeout: 15_000,
      })
      .toBe(true);

    // The journey's card: said, keyed, watched and made theirs.
    await page.goto("/dashboard");
    const card = page.getByRole("region", { name: "From first agent to your users" });
    await expect(card).toContainText("4 of 6", { timeout: 15_000 });

    expect(await control.remaining()).toBe(0);
  });
});
