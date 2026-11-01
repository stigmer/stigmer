import type { Locator, Page } from "@playwright/test";
import { test as base, expect } from "../../fixtures";
import { createTestAgent, type TestAgentResult } from "../../fixtures/seed-helpers";

/**
 * An agent's page holds one copy of the agent (stigmer/stigmer#2813),
 * against the live OSS stack: the page and its Edit YAML read the same
 * agent, so neither shows what the other has replaced.
 *
 * - An Edit YAML apply shows on the page at once, without a reload.
 * - An inline edit of the instructions, then Edit YAML, opens the editor
 *   on the edited text, so an apply of it cannot write the old text back.
 *
 * The two components were each right alone; the bug lived between them,
 * where no unit test sees both, so the journey is pinned here.
 */

const INSTRUCTIONS = "Answer support tickets in two sentences.";

/** Each case edits an agent of its own, seeded with known instructions. */
const test = base.extend<{ agent: TestAgentResult }>({
  agent: async ({ stigmerClient }, use) => {
    const agent = await createTestAgent(stigmerClient, { instructions: INSTRUCTIONS });
    await use(agent);
    await agent.cleanup();
  },
});

/** Opens the agent's page and waits for its instructions to render. */
async function openAgent(page: Page, org: string, slug: string): Promise<void> {
  await page.goto(`/library/agents/${org}/${slug}`);
  await expect(page.getByRole("button", { name: INSTRUCTIONS })).toBeVisible({ timeout: 15_000 });
}

/** Opens Edit YAML from the kebab menu and returns its CodeMirror editor. */
async function openEditYaml(page: Page): Promise<{ dialog: Locator; editor: Locator }> {
  await page.getByRole("button", { name: "More actions" }).first().click();
  await page.getByRole("menu", { name: "More actions" }).getByRole("menuitem", { name: "Edit YAML" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit YAML" });
  const editor = dialog.locator(".cm-content");
  await expect(editor).toBeVisible({ timeout: 15_000 });
  return { dialog, editor };
}

test.describe("Agent page: one copy of the agent", () => {
  test("an Edit YAML apply shows on the page without a reload", async ({ page, agent }) => {
    await openAgent(page, agent.org, agent.slug);

    const { dialog, editor } = await openEditYaml(page);
    await expect(editor).toContainText(INSTRUCTIONS);
    const opened = await editor.innerText();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(opened.replace(INSTRUCTIONS, "Answer billing questions only."));
    await dialog.getByRole("button", { name: "Apply changes" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    await expect(page.getByRole("button", { name: "Answer billing questions only." })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: INSTRUCTIONS })).toHaveCount(0);
  });

  test("Edit YAML opens on the instructions an inline edit just saved", async ({ page, agent }) => {
    await openAgent(page, agent.org, agent.slug);

    await page.getByRole("button", { name: INSTRUCTIONS }).click();
    const field = page.getByPlaceholder("Add instructions for the agent");
    await field.fill("Answer refund requests only.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Answer refund requests only." })).toBeVisible({
      timeout: 15_000,
    });

    const { editor } = await openEditYaml(page);
    await expect(editor).toContainText("Answer refund requests only.");
    await expect(editor).not.toContainText(INSTRUCTIONS);
  });
});
