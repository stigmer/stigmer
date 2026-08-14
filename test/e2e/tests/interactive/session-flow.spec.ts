import { test, expect } from "../../fixtures";
import {
  startNewSession,
  waitForAIResponse,
  getMessageThread,
  getUserMessages,
} from "../../helpers/session";
import {
  enqueueCannedTextTurns,
  getMockControlUrl,
} from "../../helpers/mock-llm-control";
import {
  ensureDefaultAgent,
  ensureDefaultOrg,
} from "../../fixtures/seed-helpers";
import { assertNoErrorBoundary } from "../../helpers/navigation";

const HAS_LLM_KEY = !!(
  process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY
);

test.describe("Session chat flow (canary)", () => {
  // The launcher's send path resolves the platform default agent; a raw
  // e2e stack has neither the org nor that agent seeded. Idempotent.
  test.beforeAll(async ({ stigmerClient }) => {
    await ensureDefaultOrg(stigmerClient);
    await ensureDefaultAgent(stigmerClient);
  });

  // Runnable two ways: against a real provider key, or with zero secrets
  // against the mock-LLM proxy (STIGMER_E2E_MOCK_LLM=1 — how the CI lane
  // runs it, stigmer/stigmer#743). Each test programs the proxy with
  // exactly the turns it will consume and drains them before ending.
  test.skip(
    !HAS_LLM_KEY && !getMockControlUrl(),
    "Requires ANTHROPIC_API_KEY/OPENAI_API_KEY or the mock-LLM stack (STIGMER_E2E_MOCK_LLM=1)",
  );

  test("sending a message produces an AI response in the thread", async ({
    page,
    testAgent,
  }) => {
    await enqueueCannedTextTurns(["hello world"]);

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
    await enqueueCannedTextTurns(["Message received."]);

    await startNewSession(page, "Testing message visibility");
    await assertNoErrorBoundary(page);

    const userMsg = getUserMessages(page).first();
    await expect(userMsg).toBeVisible({ timeout: 10_000 });
    await expect(userMsg).toContainText("Testing message visibility");

    // Drain the turn before ending: the execution this message started must
    // consume its scripted response, or the next test's queue reset races it.
    await waitForAIResponse(page, { timeout: 90_000 });
  });
});
