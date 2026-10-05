import type { Stigmer } from "@stigmer/sdk";
import { toAgentUpdateInput } from "@stigmer/sdk";
import { test, expect } from "../../fixtures";
import { ensureDefaultOrg } from "../../fixtures/seed-helpers";
import {
  enqueueCannedTextTurns,
  getMockControlUrl,
} from "../../helpers/mock-llm-control";
import { assertNoErrorBoundary } from "../../helpers/navigation";
import {
  START_SESSION_WAITS_MS,
  getNewSessionComposer,
  waitForAIResponse,
} from "../../helpers/session";

/**
 * A conversation keeps the agent version it started on until its owner
 * moves it.
 *
 * The journey: a person starts a chat on an agent straight from the
 * launcher (`/?agent=org/slug`; the agent has no other resource standing
 * between it and the conversation), and the server pins the agent's
 * current version on the session (`status.agent_id`,
 * `status.agent_version_hash`). The author then saves a new version of the
 * agent. Reopened, the conversation says it runs an older version and
 * offers to update; the update control re-pins the session to the agent's
 * new head (a session update with `agent_ref.version = "latest"`), which
 * the spec reads back over the API.
 *
 * It lives in the interactive tier because the first message needs the
 * runner and a model: the mock-LLM stack (STIGMER_E2E_MOCK_LLM=1) or a
 * provider key, as the session chat canary (session-flow.spec.ts).
 *
 * The notice and its control are found by accessible text: the notice by
 * "older version", the control by a button named "Update" inside the same
 * notice, so a copy edit that keeps those words keeps the spec.
 */

const HAS_LLM_KEY = !!(
  process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY
);

/** The id of the session the console navigated to (`/sessions/ses_…`). */
function sessionIdFromUrl(url: string): string {
  const match = /\/sessions\/(ses_[0-9a-z]+)/.exec(url);
  if (match?.[1] === undefined) {
    throw new Error(`not a session URL: ${url}`);
  }
  return match[1];
}

/** The version a session pins, read over the API. */
async function pinnedVersionOf(
  client: Stigmer,
  sessionId: string,
): Promise<string> {
  const session = await client.session.get(sessionId);
  return session.status?.agentVersionHash ?? "";
}

test.describe("A conversation's agent version", () => {
  test.beforeAll(async ({ stigmerClient }) => {
    await ensureDefaultOrg(stigmerClient);
  });

  test.skip(
    !HAS_LLM_KEY && !getMockControlUrl(),
    "Requires ANTHROPIC_API_KEY/OPENAI_API_KEY or the mock-LLM stack (STIGMER_E2E_MOCK_LLM=1)",
  );

  test("a chat started on an agent keeps its version after the author saves, and the update control re-pins it", async ({
    page,
    stigmerClient,
    testAgent,
  }) => {
    await enqueueCannedTextTurns(["Pinned and ready."]);

    // Start the conversation on the agent from the launcher.
    await page.goto(
      `/?agent=${encodeURIComponent(`${testAgent.org}/${testAgent.slug}`)}`,
    );
    const textarea = getNewSessionComposer(page).locator("textarea");
    await textarea.waitFor({
      state: "visible",
      timeout: START_SESSION_WAITS_MS.composer,
    });
    await textarea.fill("Say exactly: Pinned and ready.");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.waitForURL(/\/sessions\/ses_/, {
      timeout: START_SESSION_WAITS_MS.sessionUrl,
    });
    await assertNoErrorBoundary(page);
    await waitForAIResponse(page, { timeout: 90_000 });

    const sessionId = sessionIdFromUrl(page.url());
    try {
      // The session names the agent and pins its current version.
      const agent = await stigmerClient.agent.get(testAgent.id);
      const startedOn = agent.status?.versionHash ?? "";
      expect(startedOn, "the agent reports its current version").not.toBe("");
      const session = await stigmerClient.session.get(sessionId);
      expect(session.spec?.agentRef?.slug).toBe(testAgent.slug);
      expect(session.status?.agentId).toBe(testAgent.id);
      expect(session.status?.agentVersionHash).toBe(startedOn);

      // The author saves a new version.
      const saved = await stigmerClient.agent.update({
        ...toAgentUpdateInput(agent),
        instructions: "You are a helpful test assistant. Answer in one word.",
      });
      const head = saved.status?.versionHash ?? "";
      expect(head, "the save produces a new version").not.toBe(startedOn);

      // The open conversation keeps its pin and says so.
      expect(await pinnedVersionOf(stigmerClient, sessionId)).toBe(startedOn);
      await page.reload();
      const notice = page
        .getByText(/older version/i)
        .locator("xpath=ancestor-or-self::*[.//button][1]");
      await expect(notice).toBeVisible({ timeout: 15_000 });

      // The update control moves the conversation to the agent's new head.
      await notice.getByRole("button", { name: /update/i }).click();
      await expect
        .poll(() => pinnedVersionOf(stigmerClient, sessionId), {
          timeout: 15_000,
        })
        .toBe(head);
      await expect(page.getByText(/older version/i)).toHaveCount(0);
    } finally {
      await stigmerClient.session.delete(sessionId).catch(() => {});
    }
  });
});
