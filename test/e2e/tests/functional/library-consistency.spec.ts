import { test, expect } from "../../fixtures";
import { createTestAgent, createTestWorkflow } from "../../fixtures/seed-helpers";

/**
 * The agent and workflow libraries share one list pattern: the same
 * heading, search and header action, and the card view as the default
 * presentation of what an organization holds. Each case seeds one resource
 * into an organization of its own (`freshOrg`), so the list it opens holds
 * exactly that card.
 */
const LIBRARIES = [
  {
    kind: "agent",
    path: "/library/agents",
    heading: "Agents",
    search: "Search agents…",
    create: { name: "Create agent", href: "/library/agents/new" },
    seed: createTestAgent,
  },
  {
    kind: "workflow",
    path: "/library/workflows",
    heading: "Workflows",
    search: "Search workflows…",
    create: { name: "Create workflow", href: "/library/workflows/new" },
    seed: createTestWorkflow,
  },
] as const;

test.describe("Library consistency: agents and workflows", () => {
  for (const library of LIBRARIES) {
    test(`the ${library.kind} library lists a seeded ${library.kind} as the only card, in the default card view`, async ({
      page,
      stigmerClient,
      freshOrg,
    }) => {
      const seeded = await library.seed(stigmerClient, { org: freshOrg.slug });
      try {
        await page.goto(library.path);

        await expect(page.getByRole("heading", { level: 1, name: library.heading })).toBeVisible({
          timeout: 15_000,
        });
        await expect(page.getByRole("textbox", { name: library.search })).toBeVisible();
        await expect(
          page.getByRole("link", { name: library.create.name }).first(),
        ).toHaveAttribute("href", library.create.href);

        const views = page.getByRole("radiogroup", { name: "View mode" });
        await expect(views.getByRole("radio", { name: "Card view" })).toBeChecked();

        const cards = page.getByRole("list", { name: "Resource cards" }).getByRole("listitem");
        await expect(cards).toHaveCount(1, { timeout: 15_000 });
        await expect(cards).toContainText(seeded.slug);
        await expect(page.getByRole("table")).toHaveCount(0);
      } finally {
        await seeded.cleanup();
      }
    });
  }
});
