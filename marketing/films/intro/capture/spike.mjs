#!/usr/bin/env node
/**
 * Capture-quality spike (production plan, phase 2): records the same
 * short console drive in the two candidate configurations and drops the
 * webm files in assets/recordings/spike/ for frame inspection:
 *
 *   dpr1.webm — 1920x1080 viewport, DPR 1, recorded at 1920x1080
 *   dpr2.webm — 1920x1080 viewport, DPR 2, recorded at 3840x2160
 *              (downscaled to 1080p at composition time for crisp text)
 *
 * Playwright's recorder is built for test debugging, not cinematography —
 * this spike decides whether it meets the film's quality bar before any
 * real shooting (fallback ladder: DPR-2 downscale → CDP screencast).
 *
 * VERDICT (2026-09-02): dpr1 PASSES — VP8, constant 25 fps, text crisp in
 * stills AND mid-scroll. The dpr2 lane is NOT viable: recordVideo captures
 * at viewport size and letterboxes into the requested 4K frame instead of
 * upscaling (gray-band output). The harness records at 1920x1080/DPR 1;
 * CDP screencast remains the fallback if the rough cut disagrees.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../../../assets/recordings/spike");
mkdirSync(outDir, { recursive: true });

const CONSOLE = "http://localhost:7234";

/** One deterministic ~9s drive: library list → agent detail, slow scroll. */
async function drive(page) {
  await page.goto(`${CONSOLE}/library`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.mouse.move(960, 400);
  for (let y = 0; y < 600; y += 20) {
    await page.mouse.wheel(0, 20);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(2000);
}

async function capture(name, deviceScaleFactor, size) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor,
    recordVideo: { dir: outDir, size },
  });
  const page = await context.newPage();
  await drive(page);
  await context.close(); // finalizes the video file
  const video = await page.video().path();
  await browser.close();
  console.log(`${name}: ${video}`);
  return video;
}

const a = await capture("dpr1", 1, { width: 1920, height: 1080 });
const b = await capture("dpr2", 2, { width: 3840, height: 2160 });
console.log(JSON.stringify({ dpr1: a, dpr2: b }));
