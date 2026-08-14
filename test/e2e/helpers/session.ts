import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export function getNewSessionComposer(page: Page): Locator {
  return page.getByRole("form", { name: "Start a new session" });
}

export function getSessionComposer(page: Page): Locator {
  return page.getByRole("form", { name: "Send message" });
}

export function getMessageThread(page: Page): Locator {
  return page.getByRole("log");
}

export function getUserMessages(page: Page): Locator {
  return page.getByRole("article", { name: "User message" });
}

export function getAIResponses(page: Page): Locator {
  return page.getByRole("article", { name: "AI response" });
}

export async function startNewSession(
  page: Page,
  message: string,
): Promise<void> {
  await page.goto("/");
  const form = getNewSessionComposer(page);
  const textarea = form.locator("textarea");
  await textarea.waitFor({ state: "visible", timeout: 15_000 });
  await textarea.fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
  await page.waitForURL(/\/sessions\/ses_/, { timeout: 30_000 });
}

export async function sendFollowUp(
  page: Page,
  message: string,
): Promise<void> {
  const form = getSessionComposer(page);
  const textarea = form.locator("textarea");
  await textarea.fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
}

export async function waitForAIResponse(
  page: Page,
  opts?: { timeout?: number },
): Promise<Locator> {
  const timeout = opts?.timeout ?? 60_000;
  const aiResponse = getAIResponses(page).last();
  await aiResponse.waitFor({ state: "visible", timeout });
  await expect(aiResponse).not.toHaveAttribute("aria-busy", "true", { timeout });
  return aiResponse;
}

/**
 * The agent's inline "To-dos" card in the message thread. Present once an
 * execution has written a plan (`status.todos`); collapsed once the plan is
 * fully resolved.
 */
export function getTodoCard(page: Page): Locator {
  return page.getByRole("region", { name: "Agent to-dos" });
}

// The sidebar "Execution progress" phase region helpers were removed with
// the stigmer#743 re-anchor: no console page renders that region anymore —
// execution state surfaces as the composer lifecycle plus the settled
// response in the thread (see waitForAIResponse).

export async function assertComposerDisabled(page: Page): Promise<void> {
  const form = getSessionComposer(page);
  await expect(form.getByRole("textbox")).toBeDisabled();
}

export async function assertComposerEnabled(page: Page): Promise<void> {
  const form = getSessionComposer(page);
  await expect(form.getByRole("textbox")).toBeEnabled();
}
