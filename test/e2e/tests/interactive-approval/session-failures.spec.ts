// Every way a turn ends badly, end to end on the mock model, as the console's
// session view says it: the provider's failure forced through the mock (a
// refused key, out of credit, a busy provider, a model the key can't use, a
// dropped connection, a request it refused), the platform's own refused
// token, a step limit, and a person's stop. Each pins the notice's headline,
// its act and its link, on both engines for the refused key (which the Claude
// engine, its SDK hiding the provider's body, reads as the platform's on a
// proxied call).
//
// Run again recovers the failed turn in place: the thread shows the
// person's message once, and the recovered turn makes one more model call,
// not the whole turn's again.
//
// Not forced here, and proven where they can be: a stall (its bound is the
// stack's), a workspace held by another turn, an agent whose tool list names
// nothing and a connected app that won't connect are the runner's hermetic
// suites' (`backend/services/runner`), and their words the kit's tests'
// (`sdk/typescript/src/run/__tests__/turn-ending.test.ts`).
//
// Serial with the shared single-FIFO mock queue (`--workers=1`), as the other
// specs in this project.
import type { Stigmer } from "@stigmer/client";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import { anthropicText, anthropicToolUses } from "../../fixtures/mock-llm";
import { MockControl, awaitRunPhase, awaitRunTerminal, getMockControlUrl, shellBlock } from "../../helpers/approval";

const mockUrl = getMockControlUrl();
const ORG = "default";
const MESSAGE = "Invoices are off by a cent. Can you fix the rounding?";
const SENTINEL = "STIGMER_ORGANIZATION_PROVIDER_KEY";
// A provider that retries (429, 5xx, a dropped connection) fails only once
// its retries are spent, over a minute later.
const RETRIED_MS = 240_000;
const STEP_LIMIT = 10;

const ORG_KEY_REFUSED = { type: "error", error: { type: "authentication_error", message: `invalid x-api-key [code: ${SENTINEL}]` } };
const ORG_KEY_NO_CREDIT = {
  type: "error",
  error: { type: "invalid_request_error", message: `Your credit balance is too low to access the Anthropic API. [code: ${SENTINEL}]` },
};
const PLATFORM_REFUSED = { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } };
const MALFORMED = { type: "error", error: { type: "invalid_request_error", message: "messages.0.content: Field required" } };

interface Seeded {
  readonly sessionId: string;
  readonly runId: string;
}

/** An agent, a session on `harness`, and one turn with `MESSAGE`, the mock already scripted. */
async function seedTurn(client: Stigmer, harness: Harness, runConfig?: { readonly maxToolRounds?: number }): Promise<Seeded> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const agent = await client.agent.create({ name: `e2e-fail-agent-${stamp}`, org: ORG, instructions: "You are a test assistant." });
  const session = await client.session.create({ name: `e2e-fail-session-${stamp}`, org: ORG, agentRef: { org: ORG, slug: agent.metadata!.slug }, harness });
  const run = await client.run.create({
    name: `e2e-fail-run-${stamp}`,
    org: ORG,
    sessionId: session.metadata!.id,
    message: MESSAGE,
    autoApproveAll: true,
    ...(runConfig === undefined ? {} : { runConfig }),
  });
  return { sessionId: session.metadata!.id, runId: run.metadata!.id };
}

/** The session view's ending notice, by its headline. */
async function expectNotice(page: Page, sessionId: string, headline: string): Promise<void> {
  await page.goto(`/sessions/${sessionId}`);
  await expect(page.getByText(headline)).toBeVisible({ timeout: 30_000 });
}

test.describe("Every way a turn ends badly, in its own words (deterministic mock LLM)", () => {
  test.skip(mockUrl === null, "Requires the mock-LLM stack — run via `make test-e2e-approval` (STIGMER_E2E_MOCK_LLM=1)");
  test.describe.configure({ mode: "serial", timeout: 300_000 });

  const control = new MockControl(mockUrl ?? "");
  test.afterEach(async () => {
    await control.reset();
  });

  for (const harness of [Harness.STIGMER, Harness.CLAUDE]) {
    test(`a refused key reads as the organization's, and Run again recovers the turn in place (${Harness[harness]})`, async ({ page, stigmerClient }) => {
      // Persistent: an engine may ask again on a refused key before it gives up.
      await control.enqueueError({ status: 401, body: ORG_KEY_REFUSED, persistent: true });
      const seeded = await seedTurn(stigmerClient, harness);
      expect(await awaitRunTerminal(stigmerClient, seeded.runId, { timeoutMs: RETRIED_MS })).toBe(RunPhase.RUN_FAILED);

      if (harness === Harness.STIGMER) {
        await expectNotice(page, seeded.sessionId, "Anthropic refused this organization's model key.");
        await expect(page.getByRole("link", { name: "Open Models & providers" })).toBeVisible();
      } else {
        // The Claude engine's SDK words a refused key in its own text, without
        // the provider's body, so the proxy's organization-key mark never
        // reaches the runner: on a proxied call it reads as the platform's
        // refused token, the cautious reading (an admin is never sent to
        // replace a key that works).
        await expectNotice(page, seeded.sessionId, "Something broke on Stigmer's side.");
      }
      await expect(page.getByText("Didn't finish").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Copy details" })).toBeVisible();

      // The key is fixed: the provider answers again.
      await control.clearFault();
      const calls = await control.scriptedCalls();
      await control.enqueue(anthropicText("Rounded once, at the total."));
      await page.getByRole("button", { name: "Run again" }).click();
      await awaitRunPhase(stigmerClient, seeded.runId, RunPhase.RUN_COMPLETED);
      await expect(page.getByText("Rounded once, at the total.")).toBeVisible({ timeout: 30_000 });
      // The same turn picked up: the message once, one more model call.
      await expect(page.getByText(MESSAGE, { exact: true })).toHaveCount(1);
      expect(await control.scriptedCalls()).toBe(calls + 1);
    });
  }

  test("the platform's own refused token reads as Stigmer's fault", async ({ page, stigmerClient }) => {
    await control.enqueueError({ status: 401, body: PLATFORM_REFUSED });
    const seeded = await seedTurn(stigmerClient, Harness.STIGMER);
    await awaitRunTerminal(stigmerClient, seeded.runId, { timeoutMs: RETRIED_MS });
    await expectNotice(page, seeded.sessionId, "Something broke on Stigmer's side.");
  });

  test("an account out of credit links the provider's billing", async ({ page, stigmerClient }) => {
    await control.enqueueError({ status: 400, body: ORG_KEY_NO_CREDIT });
    const seeded = await seedTurn(stigmerClient, Harness.STIGMER);
    await awaitRunTerminal(stigmerClient, seeded.runId, { timeoutMs: RETRIED_MS });
    await expectNotice(page, seeded.sessionId, "Your Anthropic account has no credit left.");
    await expect(page.getByRole("link", { name: "Open Anthropic billing" })).toHaveAttribute("target", "_blank");
  });

  test("a busy provider says so, and links its status", async ({ page, stigmerClient }) => {
    await control.enqueueError({ status: 529, body: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, persistent: true });
    const seeded = await seedTurn(stigmerClient, Harness.STIGMER);
    await awaitRunTerminal(stigmerClient, seeded.runId, { timeoutMs: RETRIED_MS });
    await expectNotice(page, seeded.sessionId, "Anthropic was too busy to answer.");
    await expect(page.getByRole("link", { name: "Anthropic's status page" })).toBeVisible();
  });

  test("a model the key can't use offers another model, not Run again", async ({ page, stigmerClient }) => {
    await control.enqueueError({ status: 404, body: { type: "error", error: { type: "not_found_error", message: "model not found" } } });
    const seeded = await seedTurn(stigmerClient, Harness.STIGMER);
    await awaitRunTerminal(stigmerClient, seeded.runId, { timeoutMs: RETRIED_MS });
    await expectNotice(page, seeded.sessionId, "This key can't use");
    await expect(page.getByRole("button", { name: "Run again" })).toHaveCount(0);
    await page.getByRole("button", { name: "Choose another model" }).click();
    await expect(page.getByRole("dialog", { name: "Model selector" }).or(page.getByLabel("Model selector"))).toBeVisible();
  });

  test("a dropped connection says the provider couldn't be reached", async ({ page, stigmerClient }) => {
    await control.enqueueError({ drop: true, persistent: true });
    const seeded = await seedTurn(stigmerClient, Harness.STIGMER);
    await awaitRunTerminal(stigmerClient, seeded.runId, { timeoutMs: RETRIED_MS });
    await expectNotice(page, seeded.sessionId, "Stigmer couldn't reach Anthropic.");
  });

  test("a request the provider refused offers no Run again", async ({ page, stigmerClient }) => {
    // Persistent: the runner may ask once more before it gives up.
    await control.enqueueError({ status: 400, body: MALFORMED, persistent: true });
    const seeded = await seedTurn(stigmerClient, Harness.STIGMER);
    await awaitRunTerminal(stigmerClient, seeded.runId, { timeoutMs: RETRIED_MS });
    await expectNotice(page, seeded.sessionId, "Anthropic refused this request.");
    await expect(page.getByRole("button", { name: /again/ })).toHaveCount(0);
  });

  test("a step limit reads amber, and Continue sends Continue", async ({ page, stigmerClient }) => {
    // The runner's floor for the limit is 10 rounds (`shared/tool-rounds.ts`): one more ends the turn.
    for (let round = 1; round <= STEP_LIMIT + 1; round++) {
      await control.enqueue(anthropicToolUses([shellBlock(`call_${round}`, `echo ${round}`)]));
    }
    await control.enqueue(anthropicText("Stopped short."));
    const seeded = await seedTurn(stigmerClient, Harness.STIGMER, { maxToolRounds: STEP_LIMIT });
    expect(await awaitRunTerminal(stigmerClient, seeded.runId)).toBe(RunPhase.RUN_TERMINATED);
    await control.reset();

    await expectNotice(page, seeded.sessionId, "This turn reached its step limit.");
    await expect(page.getByText("Paused at its step limit").first()).toBeVisible();
    await control.enqueue(anthropicText("Carrying on."));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Carrying on.")).toBeVisible({ timeout: 60_000 });
  });
});
