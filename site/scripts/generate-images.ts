/**
 * Static Image Generation Script for Stigmer Website
 *
 * Generates all favicon and social media images at build time for static
 * export compatibility. This replaces Next.js dynamic image routes which
 * require Edge runtime and don't work with static exports.
 *
 * Generated assets:
 * - favicon.ico (16x16, 32x32 multi-resolution)
 * - favicon-16x16.png
 * - favicon-32x32.png
 * - apple-touch-icon.png (180x180)
 * - icon-192.png (PWA)
 * - icon-512.png (PWA)
 * - og-image.png (1200x630 social media preview), the social card whose
 *   layouts live in brand/social-card.ts
 *
 * Usage: tsx scripts/generate-images.ts
 */

import sharp from "sharp";
import {
  BRAND_DARK,
  BRAND_LIGHT,
  brandLockupSvg,
  brandShadedSvg,
  brandSvg,
} from "../../brand/assets.mjs";
import { POSITIONING } from "../../brand/positioning";
import { SOCIAL_CARDS, socialCardSvg } from "../../brand/social-card";
import pngToIco from "png-to-ico";
import * as fs from "fs/promises";
import * as path from "path";

// ============================================================================
// Configuration
// ============================================================================

const PUBLIC_DIR = path.join(process.cwd(), "public");

// ============================================================================
// Icon Generation
// ============================================================================

/**
 * Generates multi-resolution favicon.ico from PNG sources.
 */
async function generateFavicon(
  png16Path: string,
  png32Path: string,
  outputPath: string,
): Promise<void> {
  const png16 = await fs.readFile(png16Path);
  const png32 = await fs.readFile(png32Path);

  const icoBuffer = await pngToIco([png16, png32]);
  await fs.writeFile(outputPath, icoBuffer);

  console.log(`  ✓ Generated favicon.ico (16x16, 32x32)`);
}

/**
 * Generates all icon variants.
 * Favicons (16/32) use the tight-cropped flat mark for maximum visibility.
 * Larger icons use the shaded mark with standard padding and rounded backgrounds.
 */
async function generateAllIcons(): Promise<void> {
  await fs.writeFile(
    path.join(PUBLIC_DIR, "logo-lockup-white.svg"),
    await brandLockupSvg({ color: BRAND_LIGHT }),
  );
  const faviconSvg = await brandSvg({
    size: 32,
    color: BRAND_LIGHT,
    background: BRAND_DARK,
    tight: true,
  });
  await fs.writeFile(path.join(PUBLIC_DIR, "favicon.svg"), faviconSvg);
  await fs.writeFile(
    path.join(PUBLIC_DIR, "logo-white.svg"),
    await brandSvg({ color: BRAND_LIGHT }),
  );
  for (const [size, filename, tight] of [
    [16, "favicon-16x16.png", true],
    [32, "favicon-32x32.png", true],
    [180, "apple-touch-icon.png", false],
    [192, "icon-192.png", false],
    [512, "icon-512.png", false],
  ] as const) {
    const framing = { size, background: BRAND_DARK, tight, rounded: !tight };
    const svg = tight
      ? await brandSvg({ ...framing, color: BRAND_LIGHT })
      : await brandShadedSvg({ ...framing, on: "dark" });
    await sharp(Buffer.from(svg)).png().toFile(path.join(PUBLIC_DIR, filename));
  }
  await generateFavicon(
    path.join(PUBLIC_DIR, "favicon-16x16.png"),
    path.join(PUBLIC_DIR, "favicon-32x32.png"),
    path.join(PUBLIC_DIR, "favicon.ico"),
  );
}

// ============================================================================
// OG Image Generation
// ============================================================================

/**
 * Generates the OG image from the social card in brand/social-card.ts, with
 * the headline and the one sentence from brand/positioning.ts. Full-colour
 * PNG, like the LinkedIn covers drawn from the same card.
 */
async function generateOgImage(): Promise<void> {
  console.log("\n🖼️  Generating OG image...");

  const { openGraph } = SOCIAL_CARDS;
  await sharp(Buffer.from(await socialCardSvg(openGraph, POSITIONING)))
    .png()
    .toFile(path.join(PUBLIC_DIR, "og-image.png"));

  console.log(
    `  ✓ Generated og-image.png (${openGraph.width}x${openGraph.height})`,
  );
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  console.log("🚀 Stigmer Static Image Generation");
  console.log("===================================");

  try {
    // Generate all icons (favicons with tight padding, app icons with standard)
    await generateAllIcons();

    // Generate OG image
    await generateOgImage();
    await fs.copyFile(
      path.join(PUBLIC_DIR, "og-image.png"),
      path.resolve(PUBLIC_DIR, "../../docs/banner_dark.png"),
    );

    console.log("\n✅ All images generated successfully!");
    console.log("\nGenerated files:");
    console.log("  • public/favicon.ico");
    console.log("  • public/favicon-16x16.png");
    console.log("  • public/favicon-32x32.png");
    console.log("  • public/apple-touch-icon.png");
    console.log("  • public/icon-192.png");
    console.log("  • public/icon-512.png");
    console.log("  • public/og-image.png");
  } catch (error) {
    console.error("\n❌ Error generating images:", error);
    process.exit(1);
  }
}

export const generation = main();
