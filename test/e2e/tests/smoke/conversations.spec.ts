import { test, expect, type Page } from "@playwright/test";
import { isAuthGate } from "../../helpers/auth-gate";

// Presence-and-routing coverage only, on purpose: production is auth-gated
// past the error-boundary check, and the local e2e stack is the OSS server
// whose documented conversation postures are an empty list and NOT_FOUND for
// single-row reads. The participation loop's behavioral net lives in the Go
// front-door integration suite (test/integration/channel_conversation_test.go),
// which fakes the WhatsApp provider — never here, where it would send real
// messages and flake on live state.
//
// The two run modes pin DIFFERENT layers, stated here so neither is
// mistaken for the other:
//
// - Local (`next dev`): the app layer — the workbench renders, a deep link
//   restores the selection. The dev server resolves dynamic routes natively,
//   so the static-export placeholder mechanism never engages here.
// - Deployed (STIGMER_E2E_BASE_URL): the serving layer — nginx must answer
//   a cold deep link with the conversations placeholder document, not the
//   home page (the channel-conversations F-12 blank-page failure). That is
//   decidable from the raw document before any login, so it runs against
//   the auth-gated production deployment where the app-layer assertions
//   cannot (they bail at the auth gate, by design).

/**
 * Settle the page without a fixed sleep: the route is ready when either the
 * app rendered the workbench (authless targets) or the deployment handed the
 * browser to the login gate (production).
 */
async function waitForConversationsSettled(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  const workbench = page.locator('[aria-label="Conversations workbench"]');
  await expect
    .poll(
      async () => (await workbench.count()) > 0 || (await isAuthGate(page)),
      { timeout: 15_000 },
    )
    .toBe(true);
}

test.describe("Conversations page", () => {
  test("/conversations loads without critical console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/conversations");
    await waitForConversationsSettled(page);

    const errorBoundary = page.locator('text="Something went wrong"');
    await expect(errorBoundary).toHaveCount(0);

    // Same noise filter as app-bootstrap.spec.ts.
    const criticalErrors = consoleErrors.filter(
      (msg) =>
        !msg.includes("favicon") &&
        !msg.includes("third-party") &&
        !msg.includes("[HMR]"),
    );
    expect(criticalErrors).toEqual([]);
  });

  test("/conversations renders the workbench", async ({ page }) => {
    await page.goto("/conversations");
    await waitForConversationsSettled(page);

    const errorBoundary = page.locator('text="Something went wrong"');
    await expect(errorBoundary).toHaveCount(0);

    // Production gates this route behind Auth0; a redirect to login is healthy,
    // not a regression. Only assert the workbench when the app rendered.
    if (await isAuthGate(page)) return;

    const workbench = page.locator('[aria-label="Conversations workbench"]');
    await expect(workbench).toBeVisible();

    // The inbox pane renders alongside — a list, an empty state, or an
    // error surface, but never a blank pane.
    const listPane = page.locator('[aria-label="Conversation list"]');
    await expect(listPane).toBeVisible();
  });

  test("deep link restores a conversation selection", async ({ page }) => {
    // Seed history first so goBack below has somewhere real to land.
    await page.goto("/conversations");
    await waitForConversationsSettled(page);

    // The dynamic route ships as a static-export SPA fallback
    // (generateStaticParams -> __placeholder__), so a cold deep link is a
    // real deployment risk worth pinning. The OSS backend answers the row
    // read with NOT_FOUND, which the SDK models as awaiting-customer: the
    // header still carries the decoded key and the composer explains why
    // replying is locked — exactly what a cold deep link must show.
    await page.goto("/conversations/chan-e2e-smoke/%2B15550100");
    await waitForConversationsSettled(page);

    const errorBoundary = page.locator('text="Something went wrong"');
    await expect(errorBoundary).toHaveCount(0);

    if (await isAuthGate(page)) return;

    const workbench = page.locator('[aria-label="Conversations workbench"]');
    await expect(workbench).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "+15550100" }),
    ).toBeVisible();
    await expect(
      page.getByText("The customer hasn't written yet"),
    ).toBeVisible();

    // Leaving the deep link lands back on the inbox with nothing selected.
    // (A row-click -> back cycle needs conversation data the OSS edition
    // cannot serve; that flow is covered by the SDK component tests and the
    // live validation script, not faked here.)
    await page.goBack();
    await waitForConversationsSettled(page);
    await expect(page.getByText("Select a conversation")).toBeVisible();
  });

  test("a cold deep link is served the placeholder document, not the home page", async ({
    request,
  }) => {
    test.skip(
      !process.env.STIGMER_E2E_BASE_URL,
      "serving-layer check: static-export placeholders only exist behind nginx, not `next dev`",
    );

    // Raw document fetches — no page, no auth. The static export bakes the
    // literal `__placeholder__` into a dynamic route's document (its
    // embedded route data), and the home page contains none, so the marker
    // decides which document nginx actually served.
    const deepLink = await request.get(
      "/conversations/chan-e2e-smoke/%2B15550100",
    );
    expect(deepLink.ok()).toBe(true);
    expect(await deepLink.text()).toContain("__placeholder__");

    // Guards the discriminator itself: if the home document ever carried
    // the marker, the assertion above could pass vacuously.
    const home = await request.get("/");
    expect(home.ok()).toBe(true);
    expect(await home.text()).not.toContain("__placeholder__");
  });
});
