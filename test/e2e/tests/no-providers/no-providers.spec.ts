import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { getErrorReason, StigmerError } from "@stigmer/client";
import { test, expect } from "../../fixtures";
import { NO_PROVIDERS_STACK } from "../../fixtures/no-providers";

/**
 * A laptop whose runner reaches no model provider, end to end: the console
 * says so before anyone presses Send, and the server refuses the run anyway
 * if someone asks it directly.
 *
 * What a person sees, and what the server answers:
 * - Models & providers (the sidebar's own row) shows every provider not
 *   connected, each with the command that gives this machine's runner its
 *   key, and a Copy button;
 * - the launcher's first screen is the connect step in the composer's
 *   place: no composer, no Send;
 * - a run created through the API is refused at create, FAILED_PRECONDITION
 *   with ErrorInfo reason PROVIDER_KEY_REQUIRED naming Anthropic, in the
 *   runners' words (the server's `runnersProviderMissingCopy`).
 *
 * Stack shape: `STIGMER_E2E_NO_PROVIDERS=1` (fixtures/no-providers.ts): the
 * shipped entry, trusted-local, nothing seeded, its server booted with
 * STIGMER_RUNNER_PROVIDERS set and empty. The answer half (a key given, a
 * first answer) is every mock-stack spec's: the setting is read at boot, so
 * this stack never gains a provider.
 */

/** The runners' refusal copy for an Anthropic model, as the server words it. */
function runnersMissingAnthropic(model: string): string {
  const forModel = model === "" ? "" : ` for model '${model}'`;
  return (
    `This server's runners have no Anthropic key${forModel}, so the run was not started. ` +
    "On your own machine, run `stigmer setup`, then `stigmer down && stigmer up`."
  );
}

test.describe("a laptop whose runner reaches no model provider", () => {
  test.skip(
    !NO_PROVIDERS_STACK,
    "needs the no-provider stack shape — run with STIGMER_E2E_NO_PROVIDERS=1",
  );

  test("Models & providers shows every provider not connected, with this machine's command", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("link", { name: "Models & providers" });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(page).toHaveURL(/\/models$/);
    await expect(page.getByRole("heading", { name: "Models & providers", level: 1 })).toBeVisible({
      timeout: 15_000,
    });

    const anthropic = page.getByRole("article", { name: "Anthropic" });
    const openai = page.getByRole("article", { name: "OpenAI" });
    for (const card of [anthropic, openai]) {
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card.getByText("Not connected", { exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "Copy" })).toBeVisible();
      // A laptop's runner gets its key from the machine, never from a form here.
      await expect(card.getByRole("textbox")).toHaveCount(0);
    }
    await expect(anthropic.locator("pre")).toHaveText("stigmer setup\nstigmer down && stigmer up");
    await expect(openai.locator("pre")).toHaveText("export OPENAI_API_KEY=<your key>\nstigmer down && stigmer up");
  });

  test("the launcher's first screen is the connect step, with no composer and no Send", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Connect a model provider to start" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Give this machine's runner a key, and you can send your first task.")).toBeVisible();
    await expect(page.getByRole("article", { name: "Anthropic" }).locator("pre")).toContainText("stigmer setup");
    await expect(page.getByRole("link", { name: "every provider is in Models & providers" })).toHaveAttribute(
      "href",
      "/models",
    );
    await expect(page.getByRole("button", { name: "Send message" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "What would you like to work on?" })).toHaveCount(0);
  });

  test("a run created through the API is refused at create, in the runners' words", async ({ stigmerClient }) => {
    const session = await stigmerClient.session.create({
      name: `e2e-no-providers-${Date.now()}`,
      org: "",
      harness: Harness.NATIVE,
    });
    const org = session.metadata?.org ?? "";
    try {
      const refusal = await stigmerClient.run
        .create({
          name: `e2e-no-providers-run-${Date.now()}`,
          org,
          sessionId: session.metadata!.id,
          message: "Say hello.",
        })
        .then(
          () => null,
          (error: unknown) => error,
        );

      expect(refusal, "the run is refused, not started").toBeInstanceOf(StigmerError);
      expect((refusal as StigmerError).code).toBe("failed-precondition");
      const reason = getErrorReason(refusal);
      expect(reason?.reason).toBe("PROVIDER_KEY_REQUIRED");
      expect(reason?.metadata.org).toBe(org);
      expect(reason?.metadata.provider).toBe("anthropic");
      expect((refusal as StigmerError).message).toBe(runnersMissingAnthropic(reason?.metadata.model ?? ""));
    } finally {
      await stigmerClient.session.delete(session.metadata!.id).catch(() => {});
    }
  });
});
