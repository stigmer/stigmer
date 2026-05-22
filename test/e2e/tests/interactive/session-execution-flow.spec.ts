import { test, expect } from "../../fixtures";
import {
  startNewSession,
  sendFollowUp,
  getAIResponses,
  getUserMessages,
  getMessageThread,
  getSessionComposer,
  waitForExecutionPhase,
  assertComposerDisabled,
  assertComposerEnabled,
} from "../../helpers/session";
import { assertNoErrorBoundary } from "../../helpers/navigation";

const HAS_LLM_KEY = !!(
  process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY
);

test.describe("Agent execution via session", () => {
  test.skip(!HAS_LLM_KEY, "Requires ANTHROPIC_API_KEY or OPENAI_API_KEY");

  test("execution progress appears in sidebar during processing", async ({
    page,
    testAgent,
  }) => {
    await startNewSession(page, "Say exactly: ping");
    await assertNoErrorBoundary(page);

    // Sidebar execution progress region should appear with a non-terminal phase.
    // The execution may be Pending or Running depending on timing.
    await waitForExecutionPhase(page, "Running", { timeout: 30_000 });
  });

  test("composer disabled during execution, enabled after completion", async ({
    page,
    testAgent,
  }) => {
    await startNewSession(page, "Say exactly: hello");
    await assertNoErrorBoundary(page);

    // Follow-up composer should exist (session page, not launcher)
    const form = getSessionComposer(page);
    await expect(form).toBeVisible({ timeout: 15_000 });

    // Composer should be disabled while execution is active
    await assertComposerDisabled(page);

    // Wait for execution to complete
    await waitForExecutionPhase(page, "Completed", { timeout: 90_000 });

    // Composer should re-enable after terminal phase
    await assertComposerEnabled(page);
  });

  test("AI response appears in thread after completion", async ({
    page,
    testAgent,
  }) => {
    await startNewSession(page, "Say exactly: world");
    await assertNoErrorBoundary(page);

    await waitForExecutionPhase(page, "Completed", { timeout: 90_000 });

    const thread = getMessageThread(page);
    await expect(thread).toBeVisible();

    // At least one AI response should be visible and not still streaming
    const aiResponse = getAIResponses(page).first();
    await expect(aiResponse).toBeVisible({ timeout: 10_000 });
    await expect(aiResponse).not.toHaveAttribute("aria-busy", "true");

    // User message should also be in the thread
    const userMsg = getUserMessages(page).first();
    await expect(userMsg).toBeVisible();
    await expect(userMsg).toContainText("Say exactly: world");
  });

  test("follow-up message creates new execution", async ({
    page,
    testAgent,
  }) => {
    await startNewSession(page, "Say exactly: first");
    await assertNoErrorBoundary(page);

    // Wait for first execution to complete
    await waitForExecutionPhase(page, "Completed", { timeout: 90_000 });
    await assertComposerEnabled(page);

    // Send follow-up
    await sendFollowUp(page, "Say exactly: second");

    // User message should appear immediately (optimistic rendering)
    await expect(getUserMessages(page).last()).toContainText(
      "Say exactly: second",
      { timeout: 10_000 },
    );

    // New execution should start — composer disables again
    await assertComposerDisabled(page);

    // Wait for second execution to complete
    await waitForExecutionPhase(page, "Completed", { timeout: 90_000 });
    await assertComposerEnabled(page);

    // Thread should now have multiple AI responses
    const aiResponses = getAIResponses(page);
    await expect(aiResponses).toHaveCount(2, { timeout: 10_000 });
  });
});
