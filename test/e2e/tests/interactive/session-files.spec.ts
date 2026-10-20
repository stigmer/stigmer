// A conversation's Files tab, end to end on the mock model: what was given
// to the conversation and what its agent saved, in two groups.
//
// The script: an opening turn; a follow-up carrying a pasted screenshot,
// whose turn saves .stigmer/outputs/report.md; a second follow-up whose
// turn saves the same path again with other text. Saving into the outputs
// folder needs no approval (it flows wherever a workspace edit does), so
// each turn runs to its end with no gate.
//
// Pins:
//   - the screenshot is listed under "Given to the conversation" as soon as
//     its turn starts, before the turn ends;
//   - report.md is listed once under "Saved by the agent", the second
//     turn's text winning, with the first turn's version behind a
//     disclosure that opens in the preview;
//   - the opened text shows its text, the opened image draws the image,
//     and Download hands the browser the File under its own name.
//
// Skipped on the file-gate stack, where every write gates before it runs.
import { test, expect } from "../../fixtures";
import {
  startNewSession,
  waitForAIResponse,
  getAIResponses,
  getSessionComposer,
  assertComposerEnabled,
  START_SESSION_WAITS_MS,
} from "../../helpers/session";
import { MockControl, getMockControlUrl, isFileGateStack } from "../../helpers/mock-llm-control";
import { anthropicText, anthropicToolUses } from "../../fixtures/mock-llm";
import { assertNoErrorBoundary } from "../../helpers/navigation";

/** One wait on a turn on a loaded runner (session-run-flow.spec.ts's budget). */
const TURN_BUDGET_MS = 90_000;

/** Long enough to read the started turn's Files before it ends. */
const SLOW_TURN_MS = 6_000;

const SESSION_START_MS = START_SESSION_WAITS_MS.composer + START_SESSION_WAITS_MS.sessionUrl;

/** A session start, five turn waits and 90 s of bounded short waits. */
const CASE_BUDGET_MS = SESSION_START_MS + 5 * TURN_BUDGET_MS + 90_000;

const REPORT_PATH = "/.stigmer/outputs/report.md";

test.describe("A conversation's Files tab", () => {
  test.skip(!getMockControlUrl(), "drives the mock model's script");
  test.skip(isFileGateStack(), "every write gates before it runs on the file-gate stack");

  test("lists the pasted screenshot as given and report.md once as saved, its earlier version behind it", async ({
    page,
    testAgent,
  }) => {
    test.setTimeout(CASE_BUDGET_MS);
    void testAgent;
    const control = new MockControl(getMockControlUrl()!);
    await control.reset();
    // Opening turn.
    await control.enqueue(anthropicText("ready"));
    // First follow-up: held back so its Files can be read mid-turn, then a
    // save into the outputs folder and the closing text.
    await control.enqueue(
      anthropicToolUses([
        { toolCallId: "toolu_report_v1", toolName: "write_file", toolInput: { file_path: REPORT_PATH, content: "first draft\n" } },
      ]),
      SLOW_TURN_MS,
    );
    await control.enqueue(anthropicText("saved the first draft"));
    // Second follow-up: the same path again.
    await control.enqueue(
      anthropicToolUses([
        { toolCallId: "toolu_report_v2", toolName: "write_file", toolInput: { file_path: REPORT_PATH, content: "final report\n" } },
      ]),
    );
    await control.enqueue(anthropicText("saved the final report"));

    await startNewSession(page, "Say exactly: ready");
    await assertNoErrorBoundary(page);
    await waitForAIResponse(page, { timeout: TURN_BUDGET_MS });
    await assertComposerEnabled(page);

    // Paste a real 1x1 PNG (session-run-flow.spec.ts's synthetic paste).
    const form = getSessionComposer(page);
    const textarea = form.locator("textarea");
    await textarea.click();
    await textarea.evaluate((el) => {
      const base64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], "image.png", { type: "image/png" });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dataTransfer, bubbles: true, cancelable: true }));
    });
    const chip = form.getByRole("list", { name: "Attached files" }).getByRole("listitem");
    await expect(chip).not.toHaveAttribute("aria-label", /uploading/, { timeout: 15_000 });
    const chipLabel = (await chip.getAttribute("aria-label")) ?? "";
    const screenshotName = chipLabel.match(/^(pasted-image-[^ ]+\.png)/)?.[1] ?? "";
    expect(screenshotName).not.toBe("");

    await textarea.fill("Save a first draft of the report");
    await page.getByRole("button", { name: "Send message" }).click();

    // The screenshot is the conversation's from the moment the turn starts.
    await page.getByRole("button", { name: "Show panel" }).click();
    const filesView = page.getByRole("radio", { name: /^Files( \(\d+\))?$/ });
    await filesView.click({ timeout: 15_000 });
    const given = page.getByRole("region", { name: "Given to the conversation" });
    await expect(given.getByText(screenshotName)).toBeVisible({ timeout: 10_000 });
    // ...while the turn is still running (it is held back SLOW_TURN_MS).
    await expect(getAIResponses(page)).toHaveCount(1);

    await expect(getAIResponses(page)).toHaveCount(2, { timeout: TURN_BUDGET_MS });
    await assertComposerEnabled(page);
    await textarea.fill("Save the final report");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(getAIResponses(page)).toHaveCount(3, { timeout: TURN_BUDGET_MS });
    await assertComposerEnabled(page);

    // One report.md under what was saved, the latest turn's.
    const saved = page.getByRole("region", { name: "Saved by the agent" });
    await expect(saved.getByText("report.md", { exact: true })).toHaveCount(1, { timeout: 15_000 });
    await saved.getByText("report.md", { exact: true }).click();
    await expect(page.getByRole("article", { name: "File report.md" })).toContainText("final report", {
      timeout: 15_000,
    });

    // The download is the File, under its own name.
    const download = page.waitForEvent("download");
    await page.getByRole("article", { name: "File report.md" }).getByRole("button", { name: "Download" }).click();
    expect((await download).suggestedFilename()).toBe("report.md");

    // The first turn's version, behind its disclosure, in the preview.
    await saved.getByRole("button", { name: "Show 1 earlier version" }).click();
    await saved.getByRole("list", { name: "Earlier versions of report.md" }).getByText("report.md").click();
    const preview = page.getByRole("dialog", { name: "Preview report.md" });
    await expect(preview).toContainText("first draft", { timeout: 15_000 });
    await page.keyboard.press("Escape");

    // The screenshot draws as an image.
    await given.getByText(screenshotName).click();
    await expect(page.getByRole("article", { name: `File ${screenshotName}` }).getByRole("img", { name: screenshotName })).toBeVisible({
      timeout: 15_000,
    });

    expect(await control.remaining()).toBe(0);
  });
});
