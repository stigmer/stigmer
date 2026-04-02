/**
 * Static Image Generation Script for Stigmer Website
 *
 * Generates all favicon and social media images at build time for GitHub Pages
 * static export compatibility. This replaces Next.js dynamic image routes which
 * require Edge runtime and don't work with static exports.
 *
 * Generated assets:
 * - favicon.ico (16x16, 32x32 multi-resolution)
 * - favicon-16x16.png
 * - favicon-32x32.png
 * - apple-touch-icon.png (180x180)
 * - icon-192.png (PWA)
 * - icon-512.png (PWA)
 * - og-image.png (1200x630 social media preview)
 *
 * Usage: tsx scripts/generate-images.ts
 */

import sharp from "sharp";
import pngToIco from "png-to-ico";
import * as fs from "fs/promises";
import * as path from "path";

// ============================================================================
// Configuration
// ============================================================================

const PUBLIC_DIR = path.join(process.cwd(), "public");
const FAVICON_SVG_PATH = path.join(PUBLIC_DIR, "favicon.svg");
const APP_ICON_SVG_PATH = path.join(PUBLIC_DIR, "stigmer_dark.svg");
const ICON_SVG_PATH = path.join(PUBLIC_DIR, "Icon-bw.svg");

// Monochromatic palette from Figma design system
const COLORS = {
  darkBg: "#0a0a0a",
  darkBgEnd: "#111111",
  foreground: "#f5f5f5",
  muted: "#a3a3a3",
  subtle: "#505050",
  border: "#1c1c1c",
} as const;

// Icon sizes to generate
const ICON_SIZES = {
  favicon16: 16,
  favicon32: 32,
  appleTouch: 180,
  pwa192: 192,
  pwa512: 512,
} as const;

// OG Image dimensions (standard for social media)
const OG_IMAGE = {
  width: 1200,
  height: 630,
} as const;

// ============================================================================
// Logo Rendering
// ============================================================================

/**
 * Renders an SVG at 1024x1024 for high-quality downscaling.
 */
async function renderSvgAt1024(svgPath: string): Promise<Buffer> {
  const svgContent = await fs.readFile(svgPath, "utf-8");
  return sharp(Buffer.from(svgContent)).resize(1024, 1024).png().toBuffer();
}

// ============================================================================
// Icon Generation
// ============================================================================

/**
 * Generates a PNG icon at the specified size from the source logo.
 */
async function generateIcon(
  logoBuffer: Buffer,
  size: number,
  outputPath: string
): Promise<void> {
  await sharp(logoBuffer)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(outputPath);

  console.log(`  ✓ Generated ${path.basename(outputPath)} (${size}x${size})`);
}

/**
 * Generates multi-resolution favicon.ico from PNG sources.
 */
async function generateFavicon(
  png16Path: string,
  png32Path: string,
  outputPath: string
): Promise<void> {
  const png16 = await fs.readFile(png16Path);
  const png32 = await fs.readFile(png32Path);

  const icoBuffer = await pngToIco([png16, png32]);
  await fs.writeFile(outputPath, icoBuffer);

  console.log(`  ✓ Generated favicon.ico (16x16, 32x32)`);
}

/**
 * Generates all icon variants.
 * Favicons (16/32) use the tight-cropped favicon.svg for maximum visibility.
 * Larger icons (apple-touch, PWA) use the designer's original stigmer_dark.svg
 * with its intended padding and rounded corners.
 */
async function generateAllIcons(): Promise<void> {
  console.log("\n📦 Generating icons...");

  const [faviconLogo, appIconLogo] = await Promise.all([
    renderSvgAt1024(FAVICON_SVG_PATH),
    renderSvgAt1024(APP_ICON_SVG_PATH),
  ]);

  await Promise.all([
    generateIcon(faviconLogo, ICON_SIZES.favicon16, path.join(PUBLIC_DIR, "favicon-16x16.png")),
    generateIcon(faviconLogo, ICON_SIZES.favicon32, path.join(PUBLIC_DIR, "favicon-32x32.png")),
    generateIcon(appIconLogo, ICON_SIZES.appleTouch, path.join(PUBLIC_DIR, "apple-touch-icon.png")),
    generateIcon(appIconLogo, ICON_SIZES.pwa192, path.join(PUBLIC_DIR, "icon-192.png")),
    generateIcon(appIconLogo, ICON_SIZES.pwa512, path.join(PUBLIC_DIR, "icon-512.png")),
  ]);

  await generateFavicon(
    path.join(PUBLIC_DIR, "favicon-16x16.png"),
    path.join(PUBLIC_DIR, "favicon-32x32.png"),
    path.join(PUBLIC_DIR, "favicon.ico")
  );
}

// ============================================================================
// OG Image Generation
// ============================================================================

/**
 * Creates a gradient background SVG for the OG image.
 * Monochromatic radial vignette matching the marketing site hero.
 */
function createOgBackground(): Buffer {
  const svg = `
    <svg width="${OG_IMAGE.width}" height="${OG_IMAGE.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="vignette" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stop-color="${COLORS.darkBgEnd}"/>
          <stop offset="100%" stop-color="${COLORS.darkBg}"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#vignette)"/>
    </svg>
  `;
  return Buffer.from(svg);
}

/**
 * Creates an SVG with the brand name and tagline.
 * Uses current positioning: headline A + three-pillar sub-headline.
 */
function createOgText(): Buffer {
  const headline = "Build agents that work for your business";
  const subheadline = "Teach them your domain. Connect your tools. Set your rules.";

  const svg = `
    <svg width="${OG_IMAGE.width}" height="${OG_IMAGE.height}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="320" 
            font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
            font-size="48" font-weight="700" 
            fill="${COLORS.foreground}" 
            text-anchor="middle"
            letter-spacing="-1">${headline}</text>
      
      <text x="50%" y="390" 
            font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
            font-size="24" font-weight="400" 
            fill="${COLORS.muted}" 
            text-anchor="middle">${subheadline}</text>
    </svg>
  `;
  return Buffer.from(svg);
}

/**
 * Creates the badges row SVG for the OG image.
 * Monochromatic outline badges matching the hero section.
 */
function createOgBadges(): Buffer {
  const badges = ["Open Source", "Apache 2.0"];

  const badgeWidth = 170;
  const badgeHeight = 44;
  const badgeGap = 20;
  const totalWidth = badges.length * badgeWidth + (badges.length - 1) * badgeGap;
  const startX = (OG_IMAGE.width - totalWidth) / 2;
  const badgeY = 480;

  const badgesSvg = badges
    .map((text, i) => {
      const x = startX + i * (badgeWidth + badgeGap);
      return `
        <g>
          <rect x="${x}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" 
                rx="22" ry="22" 
                fill="none" 
                stroke="${COLORS.subtle}" stroke-width="1"/>
          <text x="${x + badgeWidth / 2}" y="${badgeY + badgeHeight / 2 + 6}" 
                font-family="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
                font-size="16" font-weight="400" 
                fill="${COLORS.muted}" 
                text-anchor="middle">${text}</text>
        </g>
      `;
    })
    .join("");

  const svg = `
    <svg width="${OG_IMAGE.width}" height="${OG_IMAGE.height}" xmlns="http://www.w3.org/2000/svg">
      ${badgesSvg}
    </svg>
  `;
  return Buffer.from(svg);
}

/**
 * Renders the raw icon SVG (no background) at the target size for the OG
 * image. The white paths sit directly on the dark gradient background.
 */
async function prepareLogoForOgImage(): Promise<Buffer> {
  const svgContent = await fs.readFile(ICON_SVG_PATH, "utf-8");
  const logoSize = 120;

  return sharp(Buffer.from(svgContent))
    .resize(logoSize, logoSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/**
 * Generates the OG image by compositing all layers.
 */
async function generateOgImage(): Promise<void> {
  console.log("\n🖼️  Generating OG image...");

  const logoSize = 120;
  const logo = await prepareLogoForOgImage();
  const background = await sharp(createOgBackground()).png().toBuffer();

  await sharp(background)
    .composite([
      {
        input: logo,
        left: Math.round((OG_IMAGE.width - logoSize) / 2),
        top: 110,
      },
      {
        input: await sharp(createOgText()).png().toBuffer(),
        left: 0,
        top: 0,
      },
      {
        input: await sharp(createOgBadges()).png().toBuffer(),
        left: 0,
        top: 0,
      },
    ])
    .png({ quality: 100, compressionLevel: 6 })
    .toFile(path.join(PUBLIC_DIR, "og-image.png"));

  console.log(
    `  ✓ Generated og-image.png (${OG_IMAGE.width}x${OG_IMAGE.height})`
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

main();
