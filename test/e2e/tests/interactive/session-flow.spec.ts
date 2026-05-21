import { test, expect } from "../../fixtures";
import {
  startNewSession,
  waitForAIResponse,
  getMessageThread,
  getUserMessages,
} from "../../helpers/session";
import { assertNoErrorBoundary } from "../../helpers/navigation";

const HAS_LLM_KEY = !!(
  process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY
);

test.describe("Session chat flow (canary)", () => {
  test.skip(!HAS_LLM_KEY, "Requires ANTHROPIC_API_KEY or OPENAI_API_KEY");

  test("sending a message produces an AI response in the thread", async ({
    page,
    testAgent,
  }) => {
    await startNewSession(page, "Say exactly: hello world");
    await assertNoErrorBoundary(page);

    const response = await waitForAIResponse(page, { timeout: 90_000 });
    await expect(response).toContainText(/hello world/i);

    const thread = getMessageThread(page);
    await expect(thread).toBeVisible();
    await expect(getUserMessages(page).first()).toBeVisible();
  });

  test("user message appears in the thread immediately", async ({
    page,
    testAgent,
  }) => {
    await startNewSession(page, "Testing message visibility");
    await assertNoErrorBoundary(page);

    const userMsg = getUserMessages(page).first();
    await expect(userMsg).toBeVisible({ timeout: 10_000 });
    await expect(userMsg).toContainText("Testing message visibility");
  });
});
