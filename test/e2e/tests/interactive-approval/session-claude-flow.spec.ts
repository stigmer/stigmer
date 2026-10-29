// A conversation started on Claude from the console, end to end on the
// deterministic mock LLM stack (STIGMER_E2E_MOCK_LLM): the person picks Claude
// in the new conversation's model picker, the Claude engine's shell call waits
// for their approval, runs once approved, and the conversation keeps its
// engine once it has run.
//
// What this layer proves that the runner's hermetic suites cannot: the
// console's real picker places the conversation on Claude, the server admits
// it, the stack's runner carries the engine and runs the turn through the
// mock, and the approval card's answer reaches the engine's resumed session.
//
// Serial + a shared single-FIFO mock queue: the project runs `--workers=1`
// (Makefile) and resets the queue per test. The script is the engine's two
// model calls: the shell call, then the answer after its result.
import { StigmerError } from "@stigmer/client";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { test, expect } from "../../fixtures";
import { ensureDefaultOrg } from "../../fixtures/seed-helpers";
import { anthropicText, anthropicToolUses } from "../../fixtures/mock-llm";
import { getAIResponses, getNewSessionComposer, START_SESSION_WAITS_MS } from "../../helpers/session";
import { MockControl, approveButton, awaitMockRemaining, getMockControlUrl, toolCallRow } from "../../helpers/approval";

const mockUrl = getMockControlUrl();

const MARKER = "claude-e2e-marker";

function sessionIdFromUrl(url: string): string {
  const match = /\/sessions\/(ses_[0-9a-z]+)/.exec(url);
  if (match?.[1] === undefined) throw new Error(`not a session URL: ${url}`);
  return match[1];
}

test.describe("A conversation on Claude (deterministic mock LLM)", () => {
  test.skip(mockUrl === null, "Requires the mock-LLM stack — run via `make test-e2e-approval` (STIGMER_E2E_MOCK_LLM=1)");
  test.describe.configure({ mode: "serial", timeout: 150_000 });

  const control = new MockControl(mockUrl ?? "");

  test.beforeAll(async ({ stigmerClient }) => {
    await ensureDefaultOrg(stigmerClient);
  });

  test.afterEach(async () => {
    await control.reset();
  });

  test("is started from the picker, asks before its shell call, runs it once approved, and keeps its engine", async ({ page, stigmerClient }) => {
    await control.enqueue(
      anthropicToolUses([{ toolCallId: "toolu_claude_e2e", toolName: "Bash", toolInput: { command: `echo ${MARKER}`, description: "Print the marker" } }]),
    );
    await control.enqueue(anthropicText("Printed the marker."));

    await page.goto("/");
    const composer = getNewSessionComposer(page);
    await composer.locator("textarea").waitFor({ state: "visible", timeout: START_SESSION_WAITS_MS.composer });

    // The model picker names the engine; its harness menu offers Claude.
    await composer.getByRole("button", { name: /Stigmer/ }).click();
    const picker = page.getByRole("dialog", { name: "Model selector" });
    await picker.getByRole("button", { name: "Select harness" }).click();
    await picker.getByRole("listbox", { name: "Available harnesses" }).getByRole("option", { name: "Claude Agent" }).click();
    await page.keyboard.press("Escape");
    await expect(composer.getByRole("button", { name: /Claude/ }).first()).toBeVisible();

    await composer.locator("textarea").fill("Print the marker.");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.waitForURL(/\/sessions\/ses_/, { timeout: START_SESSION_WAITS_MS.sessionUrl });
    const sessionId = sessionIdFromUrl(page.url());

    try {
      expect((await stigmerClient.session.get(sessionId)).spec?.harness, "the picker placed the conversation on Claude").toBe(Harness.CLAUDE);

      // The shell call waits on its row for the person; nothing ran yet.
      await expect(approveButton(page)).toBeVisible({ timeout: 90_000 });
      await approveButton(page).click();

      // Approved, the engine runs exactly that call and answers.
      await expect(getAIResponses(page).last()).toContainText("Printed the marker.", { timeout: 90_000 });
      await expect(toolCallRow(page).filter({ hasText: MARKER }).first()).toBeVisible();
      await awaitMockRemaining(control, 0);

      // A conversation that has run keeps its engine.
      const ran = await stigmerClient.session.get(sessionId);
      ran.spec!.harness = Harness.STIGMER;
      const moved = await stigmerClient.session.update(ran, ["spec.harness"]).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(moved, "a conversation that has run cannot change engines").toBeInstanceOf(StigmerError);
      expect((moved as StigmerError).code).toBe("failed-precondition");
      expect((moved as StigmerError).message).toContain("session harness cannot be changed after the first execution");
      expect((await stigmerClient.session.get(sessionId)).spec?.harness).toBe(Harness.CLAUDE);
    } finally {
      await stigmerClient.session.delete(sessionId).catch(() => {});
    }
  });
});
