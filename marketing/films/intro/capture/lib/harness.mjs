/**
 * Capture harness: one shot = one webm in assets/recordings/, named by
 * shot id. Records at 1920x1080/DPR 1 — the configuration the capture
 * spike (spike.mjs) verified against the film's quality bar. Injects the
 * film cursor and hands the drive a Human for paced input.
 *
 * Takes are captured generously long; trims happen at composition time
 * (per-scene cuts in the film manifest), so a drive never races to fit
 * its narration window.
 */
import { mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { CURSOR_INIT_SCRIPT } from "./cursor.mjs";
import { Human } from "./human.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const RECORDINGS_DIR = join(here, "../../../../assets/recordings");

export const CONSOLE_ORIGIN = "http://localhost:7234";
export const ORG = "meridian-travel";

/**
 * Record one shot. `drive(page, human)` performs the on-camera actions;
 * the finished video lands at assets/recordings/<shotId>.webm.
 */
export async function captureShot(shotId, drive) {
  mkdirSync(RECORDINGS_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: RECORDINGS_DIR, size: { width: 1920, height: 1080 } },
  });
  await context.addInitScript(CURSOR_INIT_SCRIPT);
  // The desktop promo banner must never be in frame. Seed the exact state
  // a user who dismissed it has (DesktopAppBanner.tsx, campaign 2026.04) —
  // fresh capture contexts otherwise re-show it on every page.
  await context.addInitScript(() => {
    try {
      localStorage.setItem(
        "stigmer:desktop-banner-dismissed",
        JSON.stringify({ campaign: "2026.04", at: Date.now() }),
      );
    } catch {
      // Storage unavailable — the drive's dismissBanner click still covers it.
    }
  });
  const page = await context.newPage();
  try {
    await drive(page, new Human(page));
  } finally {
    const video = page.video();
    await context.close(); // finalizes the recording
    await browser.close();
    if (video) {
      renameSync(await video.path(), join(RECORDINGS_DIR, `${shotId}.webm`));
    }
  }
  console.log(`captured ${shotId} → assets/recordings/${shotId}.webm`);
}

/** Dismiss the console's promo banner if present — never in frame on camera. */
export async function dismissBanner(page) {
  const dismiss = page.getByRole("button", { name: "Dismiss" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
    await page.waitForTimeout(300);
  }
}

/**
 * Console pages remember the active org client-side; a fresh capture
 * context starts in the seeded default org. Every drive calls this first
 * (off camera it is invisible — it happens before the shot's framing
 * matters) to land in the Meridian Travel org with a clean chrome.
 */
export async function ensureOrg(page, human, org = ORG) {
  await page.goto(`${CONSOLE_ORIGIN}/dashboard`, { waitUntil: "networkidle" });
  await dismissBanner(page);
  const menu = page.getByRole("button", { name: "Organization menu" });
  const label = await menu.textContent();
  if (label !== null && label.toLowerCase().includes(org)) return;
  await menu.click();
  await page.getByRole("menuitem", { name: new RegExp(org, "i") }).click();
  await human.beat(0.6);
}
