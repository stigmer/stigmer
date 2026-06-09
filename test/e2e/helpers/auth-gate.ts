import type { Page } from "@playwright/test";

/**
 * The smoke suite runs against any deployment, including production
 * (app.stigmer.ai), which is gated by Auth0. An unauthenticated visit to a
 * protected route correctly redirects to the Auth0 universal login page — that
 * is a healthy outcome, not a deployment regression. Authenticated-only
 * assertions (workbench rendering, session composer, etc.) must therefore be
 * skipped when the deployment has handed the browser off to the login gate.
 *
 * Against a local/OSS dev server with no auth, the app renders directly and
 * this returns false, so the real assertions still run.
 */
export async function isAuthGate(page: Page): Promise<boolean> {
  const url = page.url();

  // External auth providers (Auth0) or the app's own /login route.
  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = "";
  }
  if (/auth0\.com/i.test(url) || /^\/(login|u\/login)\b/.test(pathname)) {
    return true;
  }

  // Fall back to content detection for app-hosted login screens.
  const emailField = page.getByRole("textbox", { name: /email/i });
  return (await emailField.count()) > 0;
}
