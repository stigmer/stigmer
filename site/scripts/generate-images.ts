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
const LOGO_SVG_PATH = path.join(PUBLIC_DIR, "logo.svg");

// Brand colors from design system
const COLORS = {
  blue: "#3b82f6",
  purple: "#8b5cf6",
  darkBg: "#0a0f1a",
  darkBgEnd: "#1a1f2e",
  white: "#ffffff",
  slate300: "#cbd5e1",
  slate400: "#94a3b8",
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
// Logo Extraction
// ============================================================================

/**
 * Loads the logo from the SVG file.
 * Supports both embedded PNG (base64) and vector SVG formats.
 * Returns a high-resolution PNG buffer for further processing.
 */
async function extractLogoFromSvg(): Promise<Buffer> {
  const svgContent = await fs.readFile(LOGO_SVG_PATH, "utf-8");

  // Try to extract base64 PNG if embedded (legacy format)
  const base64Match = svgContent.match(
    /xlink:href="data:image\/png;base64,([^"]+)"/
  );

  if (base64Match && base64Match[1]) {
    const base64Data = base64Match[1];
    return Buffer.from(base64Data, "base64");
  }

  // For vector SVGs, render to a high-resolution PNG using sharp
  // Use 1024x1024 as the base resolution for icon generation
  const logoBuffer = await sharp(Buffer.from(svgContent))
    .resize(1024, 1024, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return logoBuffer;
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
 * Generates all icon variants from the source logo.
 */
async function generateAllIcons(logoBuffer: Buffer): Promise<void> {
  console.log("\n📦 Generating icons...");

  const iconOutputs: Array<{ size: number; filename: string }> = [
    { size: ICON_SIZES.favicon16, filename: "favicon-16x16.png" },
    { size: ICON_SIZES.favicon32, filename: "favicon-32x32.png" },
    { size: ICON_SIZES.appleTouch, filename: "apple-touch-icon.png" },
    { size: ICON_SIZES.pwa192, filename: "icon-192.png" },
    { size: ICON_SIZES.pwa512, filename: "icon-512.png" },
  ];

  // Generate all PNG icons in parallel
  await Promise.all(
    iconOutputs.map(({ size, filename }) =>
      generateIcon(logoBuffer, size, path.join(PUBLIC_DIR, filename))
    )
  );

  // Generate favicon.ico from the 16x16 and 32x32 PNGs
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
 * Matches the design from opengraph-image.tsx
 */
function createOgBackground(): Buffer {
  const svg = `
    <svg width="${OG_IMAGE.width}" height="${OG_IMAGE.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <!-- Main background gradient -->
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${COLORS.darkBg}"/>
          <stop offset="100%" stop-color="${COLORS.darkBgEnd}"/>
        </linearGradient>
        
        <!-- Accent blur gradient -->
        <radialGradient id="accentGrad" cx="80%" cy="20%" r="50%">
          <stop offset="0%" stop-color="${COLORS.blue}" stop-opacity="0.15"/>
          <stop offset="50%" stop-color="${COLORS.purple}" stop-opacity="0.10"/>
          <stop offset="100%" stop-color="${COLORS.purple}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      
      <!-- Background -->
      <rect width="100%" height="100%" fill="url(#bgGrad)"/>
      
      <!-- Accent blur effect -->
      <ellipse cx="${OG_IMAGE.width * 0.85}" cy="${OG_IMAGE.height * 0.1}" 
               rx="${OG_IMAGE.width * 0.35}" ry="${OG_IMAGE.height * 0.5}" 
               fill="url(#accentGrad)"/>
    </svg>
  `;
  return Buffer.from(svg);
}

/**
 * Creates an SVG with the brand name and tagline.
 * Positioned below the logo in the OG image.
 */
function createOgText(): Buffer {
  const headline = "Build Agents. Skip the Infrastructure.";
  const subheadline =
    "We handle sandboxing, orchestration, and MCP security.";
  const subheadline2 = "You write 5 lines of YAML. Your agent runs anywhere.";

  const svg = `
    <svg width="${OG_IMAGE.width}" height="${OG_IMAGE.height}" xmlns="http://www.w3.org/2000/svg">
      <!-- Headline -->
      <text x="50%" y="320" 
            font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
            font-size="52" font-weight="700" 
            fill="${COLORS.white}" 
            text-anchor="middle"
            letter-spacing="-1">${headline}</text>
      
      <!-- Subheadline line 1 -->
      <text x="50%" y="390" 
            font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
            font-size="28" font-weight="400" 
            fill="${COLORS.slate300}" 
            text-anchor="middle">${subheadline}</text>
      
      <!-- Subheadline line 2 -->
      <text x="50%" y="430" 
            font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
            font-size="28" font-weight="400" 
            fill="${COLORS.slate300}" 
            text-anchor="middle">${subheadline2}</text>
    </svg>
  `;
  return Buffer.from(svg);
}

/**
 * Creates the badges row SVG for the OG image.
 */
function createOgBadges(): Buffer {
  const badges = [
    { text: "Local-First", color: COLORS.blue },
    { text: "Open Source", color: COLORS.purple },
    { text: "gRPC APIs", color: COLORS.blue },
  ];

  const badgeWidth = 160;
  const badgeHeight = 44;
  const badgeGap = 20;
  const totalWidth = badges.length * badgeWidth + (badges.length - 1) * badgeGap;
  const startX = (OG_IMAGE.width - totalWidth) / 2;
  const badgeY = 520;

  const badgesSvg = badges
    .map((badge, i) => {
      const x = startX + i * (badgeWidth + badgeGap);
      return `
        <g>
          <rect x="${x}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" 
                rx="22" ry="22" 
                fill="none" 
                stroke="${badge.color}" stroke-width="1.5" stroke-opacity="0.4"/>
          <rect x="${x}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" 
                rx="22" ry="22" 
                fill="${badge.color}" fill-opacity="0.1"/>
          <text x="${x + badgeWidth / 2}" y="${badgeY + badgeHeight / 2 + 6}" 
                font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
                font-size="18" font-weight="500" 
                fill="${badge.color}" 
                text-anchor="middle">${badge.text}</text>
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
 * Prepares the logo for the OG image.
 * Resizes to the target size for display in the social preview.
 */
async function prepareLogoForOgImage(logoBuffer: Buffer): Promise<Buffer> {
  const logoSize = 140;

  // Resize logo to target size
  const resizedLogo = await sharp(logoBuffer)
    .resize(logoSize, logoSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return resizedLogo;
}

/**
 * Generates the OG image by compositing all layers.
 */
async function generateOgImage(logoBuffer: Buffer): Promise<void> {
  console.log("\n🖼️  Generating OG image...");

  // Prepare the logo (resized, no extra container since logo has its own background)
  const logo = await prepareLogoForOgImage(logoBuffer);

  // Start with background
  const background = await sharp(createOgBackground()).png().toBuffer();

  // Composite all layers and write to file
  await sharp(background)
    .composite([
      // Logo (centered horizontally, positioned above text)
      {
        input: logo,
        left: Math.round((OG_IMAGE.width - 140) / 2),
        top: 120,
      },
      // Text layer
      {
        input: await sharp(createOgText()).png().toBuffer(),
        left: 0,
        top: 0,
      },
      // Badges layer
      {
        input: await sharp(createOgBadges()).png().toBuffer(),
        left: 0,
        top: 0,
      },
    ])
    .png({ quality: 100, compressionLevel: 9 })
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
    // Load logo from SVG
    console.log("\n📂 Loading logo from SVG...");
    const logoBuffer = await extractLogoFromSvg();
    console.log("  ✓ Logo loaded (1024x1024 PNG)");

    // Generate all icons
    await generateAllIcons(logoBuffer);

    // Generate OG image
    await generateOgImage(logoBuffer);

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
