import { test, expect } from "@playwright/test";

/**
 * Error state resilience tests.
 *
 * Verifies that the app handles invalid URLs gracefully — rendering
 * recognizable error or not-found UI instead of crashing, showing a
 * blank screen, or triggering the global error boundary.
 *
 * Error handling in Stigmer is layered:
 * - Unmatched routes → Next.js not-found.tsx (h1 "Page not found")
 * - Invalid execution IDs → inline "Execution not found" (no boundary)
 * - Invalid session IDs → SessionError component ("Failed to load session")
 * - Invalid library slugs → inline NotFoundState ("Agent not found", etc.)
 *
 * notFound() from next/navigation is never called; API 404s are handled
 * inline by SDK hooks.
 *
 * Prerequisites:
 * - Local dev server (auto-started by Playwright config)
 * - Some tests require a running backend for API error responses;
 *   without one, connection errors render instead of not-found states
 */

test.describe("Error state resilience", () => {
  test("404 page renders with heading and recovery link", async ({ page }) => {
    await page.goto("/this-route-does-not-exist-e2e");

    await expect(
      page.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByRole("link", { name: "Go to Dashboard" }),
    ).toBeVisible();
  });

  test("sidebar remains visible on 404 page", async ({ page }) => {
    await page.goto("/this-route-does-not-exist-e2e");

    await expect(
      page.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible({ timeout: 15_000 });

    const sidebar = page.getByLabel("Main navigation");
    const openButton = page.getByLabel("Open sidebar");
    await expect(sidebar.or(openButton)).toBeVisible();
  });

  test("invalid execution ID shows error state, not crash", async ({
    page,
  }) => {
    await page.goto("/executions/nonexistent-e2e-test-id");

    const notFound = page.getByText("Execution not found");
    const errorState = page.getByText(/error|unavailable|failed/i);
    const loadingSkeleton = page.locator('[aria-busy="true"]');

    await expect(
      notFound.or(errorState).or(loadingSkeleton),
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  });

  test("invalid session ID shows error state, not crash", async ({ page }) => {
    await page.goto("/sessions/nonexistent-e2e-test-id");

    const sessionError = page.getByText("Failed to load session");
    const errorState = page.getByText(/error|unavailable|failed/i);
    const loadingSkeleton = page.locator('[aria-busy="true"]');

    await expect(
      sessionError.or(errorState).or(loadingSkeleton),
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  });

  test("invalid agent slug shows not-found state", async ({ page }) => {
    await page.goto("/library/agents/e2e-nonexistent-org/e2e-nonexistent-slug");

    const notFound = page.getByText("Agent not found");
    const accessHint = page.getByText(
      /doesn't exist or you don't have access/,
    );
    const errorState = page.getByText(/error|unavailable|failed/i);

    await expect(
      notFound.or(accessHint).or(errorState),
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  });

  test("invalid workflow slug shows not-found state", async ({ page }) => {
    await page.goto(
      "/library/workflows/e2e-nonexistent-org/e2e-nonexistent-wf",
    );

    const notFound = page.getByText("Workflow not found");
    const accessHint = page.getByText(
      /doesn't exist or you don't have access/,
    );
    const errorState = page.getByText(/error|unavailable|failed/i);

    await expect(
      notFound.or(accessHint).or(errorState),
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  });
});
