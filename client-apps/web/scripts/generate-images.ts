/**
 * Static Image Generation Script for Stigmer Web Console
 *
 * Generates favicon and apple-touch PNG/ICO variants for dark and light modes.
 *
 * Favicon PNGs (16/32) use the tight-cropped favicon-{dark,light}.svg for
 * maximum visibility at small tab-icon sizes.
 * Apple-touch icons use the designer's original SVGs (stigmer_dark/light.svg via
 * Icon-bw.svg / Icon-light.svg) with their intended padding and rounded corners.
 *
 * Generated assets per variant:
 * - favicon-{dark,light}.ico (16x16, 32x32 multi-resolution)
 * - favicon-{dark,light}-16x16.png, favicon-{dark,light}-32x32.png
 * - apple-touch-icon-{dark,light}.png (180x180)
 *
 * Usage: tsx scripts/generate-images.ts
 */

import sharp from "sharp";
import pngToIco from "png-to-ico";
import * as fs from "fs/promises";
import * as path from "path";

const PUBLIC_DIR = path.join(process.cwd(), "public");

const ICON_SIZES = {
  favicon16: 16,
  favicon32: 32,
  appleTouch: 180,
} as const;

interface IconVariant {
  faviconSvg: string;
  appIconSvg: string;
  prefix: string;
}

const VARIANTS: IconVariant[] = [
  {
    faviconSvg: path.join(PUBLIC_DIR, "favicon-dark.svg"),
    appIconSvg: path.join(PUBLIC_DIR, "Icon-bw.svg"),
    prefix: "dark",
  },
  {
    faviconSvg: path.join(PUBLIC_DIR, "favicon-light.svg"),
    appIconSvg: path.join(PUBLIC_DIR, "Icon-light.svg"),
    prefix: "light",
  },
];

async function renderSvgAt1024(svgPath: string): Promise<Buffer> {
  const svgContent = await fs.readFile(svgPath, "utf-8");
  return sharp(Buffer.from(svgContent)).resize(1024, 1024).png().toBuffer();
}

async function generateVariant(variant: IconVariant): Promise<void> {
  const faviconLogo = await renderSvgAt1024(variant.faviconSvg);
  const { prefix } = variant;

  const faviconOutputs: Array<{ size: number; filename: string }> = [
    { size: ICON_SIZES.favicon16, filename: `favicon-${prefix}-16x16.png` },
    { size: ICON_SIZES.favicon32, filename: `favicon-${prefix}-32x32.png` },
  ];

  await Promise.all(
    faviconOutputs.map(async ({ size, filename }) => {
      await sharp(faviconLogo)
        .resize(size, size)
        .png({ quality: 100, compressionLevel: 9 })
        .toFile(path.join(PUBLIC_DIR, filename));
      console.log(`  ✓ ${filename} (${size}x${size})`);
    })
  );

  const png16 = await fs.readFile(path.join(PUBLIC_DIR, `favicon-${prefix}-16x16.png`));
  const png32 = await fs.readFile(path.join(PUBLIC_DIR, `favicon-${prefix}-32x32.png`));
  const icoBuffer = await pngToIco([png16, png32]);
  await fs.writeFile(path.join(PUBLIC_DIR, `favicon-${prefix}.ico`), icoBuffer);
  console.log(`  ✓ favicon-${prefix}.ico (16x16, 32x32)`);

  // Apple-touch icon: render the favicon SVG (same tight crop looks better
  // at 180px than the raw paths without background from Icon-bw/light.svg)
  const appleTouchFilename = `apple-touch-icon-${prefix}.png`;
  await sharp(faviconLogo)
    .resize(ICON_SIZES.appleTouch, ICON_SIZES.appleTouch)
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(path.join(PUBLIC_DIR, appleTouchFilename));
  console.log(`  ✓ ${appleTouchFilename} (${ICON_SIZES.appleTouch}x${ICON_SIZES.appleTouch})`);
}

async function main(): Promise<void> {
  console.log("🚀 Stigmer Web Console — Image Generation");
  console.log("==========================================\n");

  for (const variant of VARIANTS) {
    console.log(`📦 Generating ${variant.prefix}-mode icons...`);
    await generateVariant(variant);
    console.log();
  }

  console.log("✅ All icons generated.");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
