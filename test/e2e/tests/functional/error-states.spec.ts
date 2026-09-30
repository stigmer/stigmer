import { test, expect } from "@playwright/test";

/**
 * Error state resilience: every invalid URL renders its own, named state
 * inside the app shell, never a blank page or the global error boundary.
 *
 * Error handling in Stigmer is layered:
 * - Unmatched routes → Next.js not-found.tsx (h1 "Page not found")
 * - Invalid execution IDs → inline "Execution not found"
 * - Invalid session IDs → SessionError ("Failed to load session", naming
 *   the id, with a retry)
 * - Invalid library slugs → inline not-found state ("Agent not found",
 *   "Workflow not found") with the access hint
 *
 * Each case asserts its exact state: a loose "any error-looking text"
 * match would pass on the wrong failure.
 */

async function expectNoCrash(page: import("@playwright/test").Page) {
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
}

test.describe("Error state resilience", () => {
  test("an unknown route renders the 404 page with its recovery link, inside the shell", async ({
    page,
  }) => {
    await page.goto("/this-route-does-not-exist-e2e");

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("link", { name: "Go to Dashboard" })).toBeVisible();
    await expectNoCrash(page);
  });

  test("an invalid execution id says the execution was not found", async ({ page }) => {
    await page.goto("/executions/nonexistent-e2e-test-id");

    await expect(page.getByText("Execution not found")).toBeVisible({ timeout: 15_000 });
    await expectNoCrash(page);
  });

  test("an invalid session id names the missing session and offers a retry", async ({
    page,
  }) => {
    await page.goto("/sessions/nonexistent-e2e-test-id");

    await expect(page.getByRole("heading", { name: "Failed to load session" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Session not found: nonexistent-e2e-test-id")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expectNoCrash(page);
  });

  test("an invalid agent slug shows the agent not-found state with the access hint", async ({
    page,
  }) => {
    await page.goto("/library/agents/e2e-nonexistent-org/e2e-nonexistent-slug");

    await expect(page.getByText("Agent not found")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("This agent doesn't exist or you don't have access to it."),
    ).toBeVisible();
    await expectNoCrash(page);
  });

  test("an invalid workflow slug shows the workflow not-found state with the access hint", async ({
    page,
  }) => {
    await page.goto("/library/workflows/e2e-nonexistent-org/e2e-nonexistent-wf");

    await expect(page.getByText("Workflow not found")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("This workflow doesn't exist or you don't have access to it."),
    ).toBeVisible();
    await expectNoCrash(page);
  });
});
