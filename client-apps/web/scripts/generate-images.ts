/**
 * Static Image Generation Script for Stigmer Web Console
 *
 * Generates dark-mode favicon and PWA icons from Icon-bw.svg.
 * Existing light-mode favicons (favicon-light-*) are kept as-is.
 *
 * Generated assets:
 * - favicon-dark.ico (16x16, 32x32 multi-resolution)
 * - favicon-dark-16x16.png
 * - favicon-dark-32x32.png
 * - apple-touch-icon-dark.png (180x180)
 *
 * Usage: tsx scripts/generate-images.ts
 */

import sharp from "sharp";
import pngToIco from "png-to-ico";
import * as fs from "fs/promises";
import * as path from "path";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const ICON_SVG_PATH = path.join(PUBLIC_DIR, "Icon-bw.svg");

const DARK_BG = "#0a0a0a";

const ICON_SIZES = {
  favicon16: 16,
  favicon32: 32,
  appleTouch: 180,
} as const;

async function renderIconOnDarkBg(size: number): Promise<Buffer> {
  const svgContent = await fs.readFile(ICON_SVG_PATH, "utf-8");

  const padding = Math.round(size * 0.12);
  const iconSize = size - padding * 2;
  const cornerRadius = Math.round(size * 0.18);

  const backgroundSvg = Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${cornerRadius}" ry="${cornerRadius}" fill="${DARK_BG}"/>
    </svg>
  `);

  const iconPng = await sharp(Buffer.from(svgContent))
    .resize(iconSize, iconSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return sharp(backgroundSvg)
    .png()
    .toBuffer()
    .then((bg) =>
      sharp(bg)
        .composite([{ input: iconPng, left: padding, top: padding }])
        .png({ quality: 100, compressionLevel: 9 })
        .toBuffer()
    );
}

async function main(): Promise<void> {
  console.log("🚀 Stigmer Web Console — Image Generation");
  console.log("==========================================\n");

  const outputs: Array<{ size: number; filename: string }> = [
    { size: ICON_SIZES.favicon16, filename: "favicon-dark-16x16.png" },
    { size: ICON_SIZES.favicon32, filename: "favicon-dark-32x32.png" },
    { size: ICON_SIZES.appleTouch, filename: "apple-touch-icon-dark.png" },
  ];

  await Promise.all(
    outputs.map(async ({ size, filename }) => {
      const buf = await renderIconOnDarkBg(size);
      await fs.writeFile(path.join(PUBLIC_DIR, filename), buf);
      console.log(`  ✓ ${filename} (${size}x${size})`);
    })
  );

  // Generate favicon-dark.ico
  const png16 = await fs.readFile(path.join(PUBLIC_DIR, "favicon-dark-16x16.png"));
  const png32 = await fs.readFile(path.join(PUBLIC_DIR, "favicon-dark-32x32.png"));
  const icoBuffer = await pngToIco([png16, png32]);
  await fs.writeFile(path.join(PUBLIC_DIR, "favicon-dark.ico"), icoBuffer);
  console.log("  ✓ favicon-dark.ico (16x16, 32x32)");

  console.log("\n✅ Dark-mode icons generated.");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
