import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/**
 * Clipboard paste in the session composer (stigmer/stigmer#284).
 *
 * Uses a synthetic ClipboardEvent carrying a real (decodable) 1x1 PNG —
 * OS-clipboard automation is not portable across CI runners. Synthetic
 * events exercise the real React paste handler in a real Chromium; the
 * canvas pipeline behind it is covered by the browser-mode vitest suite
 * (sdk/react prepare-image.browser.test.ts).
 *
 * This functional tier has no backend guarantee, so these tests assert the
 * paste-to-chip behavior only (the chip persists whether the upload
 * succeeds or errors). The full upload-and-send path runs in the
 * interactive tier (session-execution-flow.spec.ts).
 */

/** Base64 of a valid 1x1 transparent PNG. */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function pasteImage(textarea: Locator): Promise<void> {
  await textarea.click();
  await textarea.evaluate((el, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    // Browsers name clipboard screenshots "image.png" — replicate that so
    // the synthesized-name path is the one under test.
    const file = new File([bytes], "image.png", { type: "image/png" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, TINY_PNG_BASE64);
}

function getLauncherTextarea(page: Page): Locator {
  return page
    .getByRole("form", { name: "Start a new session" })
    .locator("textarea");
}

function getAttachmentChips(page: Page): Locator {
  return page
    .getByRole("list", { name: "Attached files" })
    .getByRole("listitem");
}

test.describe("Composer clipboard paste", () => {
  test("pasting a screenshot attaches a chip with a synthesized unique name", async ({
    page,
  }) => {
    await page.goto("/");
    const textarea = getLauncherTextarea(page);
    await textarea.waitFor({ state: "visible", timeout: 15_000 });

    await pasteImage(textarea);

    const chip = getAttachmentChips(page).first();
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip).toHaveAttribute("aria-label", /^pasted-image-\d{6}-\d+\.png/);
  });

  test("two pastes attach two distinctly-named chips", async ({ page }) => {
    await page.goto("/");
    const textarea = getLauncherTextarea(page);
    await textarea.waitFor({ state: "visible", timeout: 15_000 });

    await pasteImage(textarea);
    await pasteImage(textarea);

    const chips = getAttachmentChips(page);
    await expect(chips).toHaveCount(2, { timeout: 10_000 });

    const first = await chips.nth(0).getAttribute("aria-label");
    const second = await chips.nth(1).getAttribute("aria-label");
    expect(first).not.toBe(second);
  });

  test("a text-only paste attaches nothing", async ({ page }) => {
    await page.goto("/");
    const textarea = getLauncherTextarea(page);
    await textarea.waitFor({ state: "visible", timeout: 15_000 });

    await textarea.click();
    await textarea.evaluate((el) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", "just words");
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await expect(getAttachmentChips(page)).toHaveCount(0);
  });
});
