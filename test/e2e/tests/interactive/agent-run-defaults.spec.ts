import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { toAgentUpdateInput } from "@stigmer/sdk";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ListAgentExecutionsBySessionRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
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
 * An agent's run defaults reach a conversation in the console, and a person
 * can change them for one message.
 *
 * The journey: the author gives the agent run defaults (the native engine,
 * Haiku 4.5, thinking on). A new chat on the agent opens on "Agent
 * default", and its first turn runs the agent's model and thinking, read
 * back over the API from `status.run_config` while the request names
 * nothing. The person then turns thinking off in the picker: the next turn
 * asks for thinking off alone and runs the agent's model with thinking
 * off, and the agent's defaults are unchanged. A "Build from plan" turn on
 * the same conversation (the flag at the top of the spec) still completes.
 *
 * It lives in the interactive tier because each message needs the runner
 * and a model: the mock-LLM stack (STIGMER_E2E_MOCK_LLM=1) or a provider
 * key, as the session chat canary (session-flow.spec.ts).
 */

const HAS_LLM_KEY = !!(
  process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY
);

const AGENT_MODEL = "claude-haiku-4.5";

/** The id of the session the console navigated to (`/sessions/ses_…`). */
function sessionIdFromUrl(url: string): string {
  const match = /\/sessions\/(ses_[0-9a-z]+)/.exec(url);
  if (match?.[1] === undefined) {
    throw new Error(`not a session URL: ${url}`);
  }
  return match[1];
}

/** The session's turn that carried `message`. */
async function turnWith(
  client: Stigmer,
  sessionId: string,
  message: string,
): Promise<AgentExecution | undefined> {
  const listed = await client.agentExecution.listBySession(
    create(ListAgentExecutionsBySessionRequestSchema, { sessionId }),
  );
  return listed.entries.find((turn) => turn.spec?.message === message);
}

test.describe("An agent's run defaults in the console", () => {
  test.beforeAll(async ({ stigmerClient }) => {
    await ensureDefaultOrg(stigmerClient);
  });

  test.skip(
    !HAS_LLM_KEY && !getMockControlUrl(),
    "Requires ANTHROPIC_API_KEY/OPENAI_API_KEY or the mock-LLM stack (STIGMER_E2E_MOCK_LLM=1)",
  );

  test("a chat opens on the agent's defaults, a message can turn thinking off, and build-from-plan still runs", async ({
    page,
    stigmerClient,
    testAgent,
  }) => {
    // The author gives the agent its run defaults.
    const agent = await stigmerClient.agent.get(testAgent.id);
    await stigmerClient.agent.update({
      ...toAgentUpdateInput(agent),
      harness: Harness.NATIVE,
      runConfig: { modelName: AGENT_MODEL, thinkingMode: ThinkingMode.ENABLED },
    });

    await enqueueCannedTextTurns([
      "Defaults in use.",
      "Thinking is off.",
      "Built.",
    ]);

    // A new chat on the agent opens on its defaults.
    await page.goto(
      `/?agent=${encodeURIComponent(`${testAgent.org}/${testAgent.slug}`)}`,
    );
    const composer = getNewSessionComposer(page);
    const textarea = composer.locator("textarea");
    await textarea.waitFor({
      state: "visible",
      timeout: START_SESSION_WAITS_MS.composer,
    });
    await expect(
      page.getByRole("button", { name: /Agent default/ }),
    ).toBeVisible({ timeout: 15_000 });
    await textarea.fill("Say exactly: Defaults in use.");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.waitForURL(/\/sessions\/ses_/, {
      timeout: START_SESSION_WAITS_MS.sessionUrl,
    });
    await assertNoErrorBoundary(page);
    await waitForAIResponse(page, { timeout: 90_000 });

    const sessionId = sessionIdFromUrl(page.url());
    try {
      const first = await turnWith(stigmerClient, sessionId, "Say exactly: Defaults in use.");
      expect(first?.spec?.runConfig?.modelName ?? "", "the message named no model").toBe("");
      expect(first?.status?.runConfig?.modelName).toBe(AGENT_MODEL);
      expect(first?.status?.runConfig?.thinkingMode).toBe(ThinkingMode.ENABLED);

      // Thinking off for the next message, in the picker.
      await page.getByRole("button", { name: /Agent default/ }).click();
      await page.getByRole("switch", { name: "Thinking" }).click();
      await page.keyboard.press("Escape");
      const followUp = page.locator("textarea").last();
      await followUp.fill("Say exactly: Thinking is off.");
      await page.getByRole("button", { name: "Send message" }).click();
      await expect
        .poll(
          async () =>
            (await turnWith(stigmerClient, sessionId, "Say exactly: Thinking is off.")) !== undefined,
          { timeout: 30_000 },
        )
        .toBe(true);
      await waitForAIResponse(page, { timeout: 90_000 });
      const second = await turnWith(stigmerClient, sessionId, "Say exactly: Thinking is off.");
      expect(second?.spec?.runConfig?.thinkingMode).toBe(ThinkingMode.DISABLED);
      expect(second?.spec?.runConfig?.modelName ?? "").toBe("");
      expect(second?.status?.runConfig?.modelName).toBe(AGENT_MODEL);
      expect(second?.status?.runConfig?.thinkingMode).toBe(ThinkingMode.DISABLED);

      // The author's defaults are untouched.
      const after = await stigmerClient.agent.get(testAgent.id);
      expect(after.spec?.runConfig?.thinkingMode).toBe(ThinkingMode.ENABLED);

      // A build-from-plan turn on the same conversation still runs.
      const build = await stigmerClient.agentExecution.create({
        org: testAgent.org,
        name: `build-${Date.now()}`,
        sessionId,
        message: "Build from plan",
        buildFromPlan: true,
      });
      await expect
        .poll(
          async () =>
            (await stigmerClient.agentExecution.get(build.metadata?.id ?? ""))
              .status?.phase,
          { timeout: 90_000 },
        )
        .toBe(3); // EXECUTION_COMPLETED
      const built = await stigmerClient.agentExecution.get(build.metadata?.id ?? "");
      expect(built.spec?.buildFromPlan).toBe(true);
    } finally {
      await stigmerClient.session.delete(sessionId).catch(() => {});
    }
  });
});
