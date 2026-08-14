import { test, expect } from "../../fixtures";
import {
  startNewSession,
  sendFollowUp,
  waitForAIResponse,
  getAIResponses,
  getUserMessages,
  getMessageThread,
  getSessionComposer,
  assertComposerDisabled,
  assertComposerEnabled,
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

// Simulated model latency for every canned turn in this file: these tests
// assert MID-execution states (disabled composer), so the execution must stay
// observable for longer than the page needs to reflect it — a zero-latency
// turn can complete before the UI ever shows the run (stigmer/stigmer#743).
const TURN_DELAY_MS = 2_000;

/**
 * Agent execution through the session surface, anchored to the signals the
 * CURRENT session viewer exposes (stigmer/stigmer#743 re-anchor): the
 * composer disables while a run is active and re-enables after, and the
 * response lands in the thread. The pre-redesign sidebar "Execution
 * progress" phase region these tests originally pinned is no longer
 * rendered by any console page — execution phases are deliberately not a
 * header/sidebar surface anymore.
 */
test.describe("Agent execution via session", () => {
  // The launcher's send path resolves the platform default agent; a raw
  // e2e stack has neither the org nor that agent seeded. Idempotent.
  test.beforeAll(async ({ stigmerClient }) => {
    await ensureDefaultOrg(stigmerClient);
    await ensureDefaultAgent(stigmerClient);
  });

  // Runnable two ways: against a real provider key, or with zero secrets
  // against the mock-LLM proxy (STIGMER_E2E_MOCK_LLM=1 — how the CI lane
  // runs it). Each test programs the proxy with exactly the turns it will
  // consume and drains them before ending.
  test.skip(
    !HAS_LLM_KEY && !getMockControlUrl(),
    "Requires ANTHROPIC_API_KEY/OPENAI_API_KEY or the mock-LLM stack (STIGMER_E2E_MOCK_LLM=1)",
  );

  // Folds the old "execution progress appears in sidebar" intent into the
  // composer lifecycle: the disabled composer IS the user-visible "a run is
  // in progress" signal on the current surface.
  test("composer reflects the execution lifecycle: disabled while running, enabled after", async ({
    page,
    testAgent,
  }) => {
    await enqueueCannedTextTurns(["hello"], { delayMs: TURN_DELAY_MS });

    await startNewSession(page, "Say exactly: hello");
    await assertNoErrorBoundary(page);

    // Follow-up composer should exist (session page, not launcher).
    const form = getSessionComposer(page);
    await expect(form).toBeVisible({ timeout: 15_000 });

    // Disabled while the execution is active — the in-progress signal.
    await assertComposerDisabled(page);

    // The settled response is the completion signal on this surface.
    await waitForAIResponse(page, { timeout: 90_000 });
    await assertComposerEnabled(page);
  });

  test("AI response appears in thread after completion", async ({
    page,
    testAgent,
  }) => {
    await enqueueCannedTextTurns(["world"], { delayMs: TURN_DELAY_MS });

    await startNewSession(page, "Say exactly: world");
    await assertNoErrorBoundary(page);

    // Settled response: visible and no longer streaming (not aria-busy).
    const aiResponse = await waitForAIResponse(page, { timeout: 90_000 });
    await expect(aiResponse).toBeVisible();

    const thread = getMessageThread(page);
    await expect(thread).toBeVisible();

    // User message should also be in the thread.
    const userMsg = getUserMessages(page).first();
    await expect(userMsg).toBeVisible();
    await expect(userMsg).toContainText("Say exactly: world");
  });

  test("pasted screenshot uploads for real and rides the follow-up message", async ({
    page,
    testAgent,
  }) => {
    // Two turns: the opening message and the follow-up that carries the image.
    await enqueueCannedTextTurns(["ready", "got the image"], {
      delayMs: TURN_DELAY_MS,
    });

    await startNewSession(page, "Say exactly: ready");
    await assertNoErrorBoundary(page);
    await waitForAIResponse(page, { timeout: 90_000 });
    await assertComposerEnabled(page);

    const form = getSessionComposer(page);
    const textarea = form.locator("textarea");

    // Synthetic ClipboardEvent with a real (decodable) 1x1 PNG named the way
    // browsers name clipboard screenshots — OS-clipboard automation is not
    // portable across CI runners, and the synthetic event exercises the
    // exact same React paste handler.
    await textarea.click();
    await textarea.evaluate((el) => {
      const base64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], "image.png", { type: "image/png" });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // The chip appears with a synthesized name and the REAL upload against
    // the real server completes (no "uploading", no "upload failed").
    const chip = form
      .getByRole("list", { name: "Attached files" })
      .getByRole("listitem");
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip).toHaveAttribute("aria-label", /^pasted-image-\d{6}-\d+\.png/);
    await expect(chip).not.toHaveAttribute("aria-label", /uploading/, {
      timeout: 15_000,
    });
    await expect(chip).not.toHaveAttribute("aria-label", /upload failed/);

    // Send — the message dispatches with the attachment and the chip clears.
    await textarea.fill("Say exactly: got the image");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(getUserMessages(page).last()).toContainText(
      "Say exactly: got the image",
      { timeout: 10_000 },
    );
    await expect(chip).toHaveCount(0);

    // Drain the follow-up's turn before ending: the send above started a
    // second execution; its settled response re-enables the composer.
    await expect(getAIResponses(page)).toHaveCount(2, { timeout: 90_000 });
    await assertComposerEnabled(page);
  });

  test("follow-up message creates new execution", async ({
    page,
    testAgent,
  }) => {
    await enqueueCannedTextTurns(["first", "second"], {
      delayMs: TURN_DELAY_MS,
    });

    await startNewSession(page, "Say exactly: first");
    await assertNoErrorBoundary(page);

    // Wait for the first execution to complete.
    await waitForAIResponse(page, { timeout: 90_000 });
    await assertComposerEnabled(page);

    // Send follow-up.
    await sendFollowUp(page, "Say exactly: second");

    // User message should appear immediately (optimistic rendering).
    await expect(getUserMessages(page).last()).toContainText(
      "Say exactly: second",
      { timeout: 10_000 },
    );

    // New execution should start — composer disables again.
    await assertComposerDisabled(page);

    // Thread ends with two settled AI responses — the second execution's
    // completion signal — and the composer re-enables.
    await expect(getAIResponses(page)).toHaveCount(2, { timeout: 90_000 });
    await expect(getAIResponses(page).last()).not.toHaveAttribute(
      "aria-busy",
      "true",
      { timeout: 90_000 },
    );
    await assertComposerEnabled(page);
  });
});
