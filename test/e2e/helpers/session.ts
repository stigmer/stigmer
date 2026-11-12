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

/**
 * The longest `startNewSession` itself waits: the launcher's composer, then the
 * new session's URL. Exported so a spec's case budget can count it rather than
 * copy the numbers.
 */
export const START_SESSION_WAITS_MS = { composer: 15_000, sessionUrl: 30_000 } as const;

/** The launcher's first question, which an organization where nothing has run opens on. */
export const FIRST_QUESTION = "What should your agent do for your users?";

/**
 * Opens the launcher and leaves its first question for plain chat when it
 * shows: an organization where nothing has run yet opens on it, so whichever
 * spec first starts a session there meets it. Waits on whichever appears,
 * the question or the composer, never on a fixed delay.
 */
export async function openLauncherForChat(page: Page): Promise<Locator> {
  await page.goto("/");
  return chatPastFirstQuestion(page);
}

/** On a launcher already open: leaves its first question for plain chat when it shows, and returns the composer's textarea. */
export async function chatPastFirstQuestion(page: Page): Promise<Locator> {
  const textarea = getNewSessionComposer(page).locator("textarea");
  const question = page.getByRole("heading", { level: 1, name: FIRST_QUESTION });
  await textarea.or(question).first().waitFor({ state: "visible", timeout: START_SESSION_WAITS_MS.composer });
  if (await question.isVisible()) {
    await page.getByRole("button", { name: "Just chat with Stigmer" }).click();
  }
  await textarea.waitFor({ state: "visible", timeout: START_SESSION_WAITS_MS.composer });
  return textarea;
}

export async function startNewSession(
  page: Page,
  message: string,
): Promise<void> {
  const textarea = await openLauncherForChat(page);
  await textarea.fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
  await page.waitForURL(/\/sessions\/ses_/, { timeout: START_SESSION_WAITS_MS.sessionUrl });
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
 * run has written a plan (`status.todos`); collapsed once the plan is
 * fully resolved.
 */
export function getTodoCard(page: Page): Locator {
  return page.getByRole("region", { name: "Agent to-dos" });
}

// The sidebar "Run progress" phase region helpers were removed with
// the stigmer#743 re-anchor: no console page renders that region anymore —
// execution state surfaces as the composer lifecycle plus the settled
// response in the thread (see waitForAIResponse).

/**
 * A turn works: the composer offers Stop, and stays open, since a message
 * sent now waits for the working turn.
 */
export async function assertTurnWorking(page: Page): Promise<void> {
  const form = getSessionComposer(page);
  await expect(form.getByRole("button", { name: "Stop generating" })).toBeVisible();
  await expect(form.getByRole("textbox")).toBeEnabled();
}

/** No turn works: the composer is open and offers no Stop. */
export async function assertTurnIdle(page: Page): Promise<void> {
  const form = getSessionComposer(page);
  await expect(form.getByRole("button", { name: "Stop generating" })).toBeHidden();
  await expect(form.getByRole("textbox")).toBeEnabled();
}
