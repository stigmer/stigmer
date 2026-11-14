import { test, expect } from "../../fixtures";

/**
 * CON-12 on a server that trusts every caller, the stack this project boots:
 * the dashboard's first-steps card names the journey's last step as its
 * sixth row, and on this server nobody else can reach Stigmer, so its
 * page says so and where sign-in is set up, and offers no invite and no
 * list of who joined. The signing-in half (renamed, an invite sent and
 * accepted by a person who never signed in before) is held by Stigmer
 * Cloud's console journey, which has the second person this stack lacks.
 */
test.describe("CON-12 Bring others in, on a server that trusts every caller", () => {
  test("the card names the last step, and its page says only you can reach this Stigmer", async ({ page, freshOrg }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Organization menu" })).toContainText(freshOrg.slug, {
      timeout: 15_000,
    });
    const card = page.getByRole("region", { name: "From first agent to your users" });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole("listitem").nth(5)).toContainText("Bring others in");

    await page.goto("/settings/bring-others-in");
    await expect(page.getByRole("heading", { name: "Bring others in", level: 2 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("This Stigmer is on your computer, so only you can reach it.")).toBeVisible();
    await expect(page.getByRole("link", { name: "a server with sign-in turned on" })).toHaveAttribute(
      "href",
      "https://stigmer.ai/docs/guides/self-hosting/authentication",
    );
    await expect(page.getByRole("button", { name: "Make an invite link" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Who's here" })).toHaveCount(0);
  });
});
