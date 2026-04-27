/**
 * Desktop Icon Generation Script for Stigmer
 *
 * Generates all Tauri bundle icons from stigmer_dark.svg with proper macOS
 * icon grid padding (~10% transparent margin per side). This ensures the
 * icon looks correctly sized in the macOS dock alongside system applications.
 *
 * Generated assets (in src-tauri/icons/):
 *   Tauri bundle:    32x32, 64x64, 128x128, 128x128@2x, icon.png
 *   macOS:           icon.icns  (via iconutil)
 *   Windows:         icon.ico   (multi-resolution)
 *   Windows Store:   Square*.png, StoreLogo.png
 *
 * Usage: tsx scripts/generate-icons.ts
 */

import sharp from "sharp";
import pngToIco from "png-to-ico";
import * as fs from "fs/promises";
import * as path from "path";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

// ============================================================================
// Configuration
// ============================================================================

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(SCRIPT_DIR, "..");
const SOURCE_SVG = path.join(DESKTOP_ROOT, "public", "stigmer_dark.svg");
const ICONS_DIR = path.join(DESKTOP_ROOT, "src-tauri", "icons");

/**
 * Apple's macOS icon grid places the visible icon body at ~80% of the full
 * canvas, leaving ~10% transparent padding on each side. This matches how
 * Finder, Chrome, Slack, and other well-behaved dock icons are sized.
 */
const ICON_BODY_RATIO = 0.80;

const MASTER_SIZE = 1024;

const TAURI_PNGS: Record<string, number> = {
  "32x32.png": 32,
  "64x64.png": 64,
  "128x128.png": 128,
  "128x128@2x.png": 256,
  "icon.png": 512,
};

const WINDOWS_STORE_PNGS: Record<string, number> = {
  "Square30x30Logo.png": 30,
  "Square44x44Logo.png": 44,
  "Square71x71Logo.png": 71,
  "Square89x89Logo.png": 89,
  "Square107x107Logo.png": 107,
  "Square142x142Logo.png": 142,
  "Square150x150Logo.png": 150,
  "Square284x284Logo.png": 284,
  "Square310x310Logo.png": 310,
  "StoreLogo.png": 50,
};

/**
 * iconutil requires an .iconset directory with these exact filenames.
 * Each @2x variant is double the pixel size of its base.
 */
const ICONSET_ENTRIES: Record<string, number> = {
  "icon_16x16.png": 16,
  "icon_16x16@2x.png": 32,
  "icon_32x32.png": 32,
  "icon_32x32@2x.png": 64,
  "icon_128x128.png": 128,
  "icon_128x128@2x.png": 256,
  "icon_256x256.png": 256,
  "icon_256x256@2x.png": 512,
  "icon_512x512.png": 512,
  "icon_512x512@2x.png": 1024,
};

const ICO_SIZES = [16, 32, 48, 256];

// ============================================================================
// Rendering
// ============================================================================

/**
 * Renders the source SVG centered on a transparent canvas with macOS-standard
 * padding. The artwork occupies ICON_BODY_RATIO of the canvas; the rest is
 * transparent margin.
 */
async function renderMaster(): Promise<Buffer> {
  const svgContent = await fs.readFile(SOURCE_SVG, "utf-8");
  const bodySize = Math.round(MASTER_SIZE * ICON_BODY_RATIO);
  const offset = Math.round((MASTER_SIZE - bodySize) / 2);

  const artwork = await sharp(Buffer.from(svgContent))
    .resize(bodySize, bodySize)
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: MASTER_SIZE,
      height: MASTER_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: artwork, left: offset, top: offset }])
    .png()
    .toBuffer();
}

async function resizeTo(master: Buffer, size: number): Promise<Buffer> {
  return sharp(master)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ============================================================================
// Icon Generation
// ============================================================================

async function generatePngSet(
  master: Buffer,
  label: string,
  entries: Record<string, number>,
): Promise<void> {
  console.log(`\n  ${label}:`);
  await Promise.all(
    Object.entries(entries).map(async ([filename, size]) => {
      const buf = await resizeTo(master, size);
      await fs.writeFile(path.join(ICONS_DIR, filename), buf);
      console.log(`    + ${filename} (${size}x${size})`);
    }),
  );
}

async function generateIcns(master: Buffer): Promise<void> {
  console.log("\n  macOS .icns:");

  const iconsetDir = path.join(tmpdir(), `stigmer-${Date.now()}.iconset`);
  await fs.mkdir(iconsetDir, { recursive: true });

  try {
    await Promise.all(
      Object.entries(ICONSET_ENTRIES).map(async ([filename, size]) => {
        const buf = await resizeTo(master, size);
        await fs.writeFile(path.join(iconsetDir, filename), buf);
      }),
    );

    const outputPath = path.join(ICONS_DIR, "icon.icns");
    execSync(`iconutil -c icns "${iconsetDir}" -o "${outputPath}"`, {
      stdio: "pipe",
    });
    console.log("    + icon.icns");
  } finally {
    await fs.rm(iconsetDir, { recursive: true, force: true });
  }
}

async function generateIco(master: Buffer): Promise<void> {
  console.log("\n  Windows .ico:");

  const pngBuffers = await Promise.all(
    ICO_SIZES.map((size) => resizeTo(master, size)),
  );

  const icoBuffer = await pngToIco(pngBuffers);
  await fs.writeFile(path.join(ICONS_DIR, "icon.ico"), icoBuffer);
  console.log(`    + icon.ico (${ICO_SIZES.join(", ")})`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const bodyPx = Math.round(MASTER_SIZE * ICON_BODY_RATIO);
  const padPct = Math.round(((1 - ICON_BODY_RATIO) / 2) * 100);

  console.log("Stigmer Desktop Icon Generation");
  console.log("================================");
  console.log(`Source:    ${path.relative(DESKTOP_ROOT, SOURCE_SVG)}`);
  console.log(`Output:    ${path.relative(DESKTOP_ROOT, ICONS_DIR)}/`);
  console.log(`Padding:   ${padPct}% per side (body ${bodyPx}px of ${MASTER_SIZE}px master)`);

  const master = await renderMaster();

  await generatePngSet(master, "Tauri bundle PNGs", TAURI_PNGS);
  await generatePngSet(master, "Windows Store PNGs", WINDOWS_STORE_PNGS);
  await generateIcns(master);
  await generateIco(master);

  console.log("\nAll desktop icons generated successfully.");
}

main().catch((err) => {
  console.error("\nError generating icons:", err);
  process.exit(1);
});
