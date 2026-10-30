/**
 * Converts the screens the site and the docs show into the files they serve.
 *
 * Every screen is a picture the visual suite draws and approves
 * (test/visual/src/shown.ts, approved under test/visual/tests/__shown__).
 * This writes each one to `public/screens` once per density
 * (src/lib/screens.ts names the files) as WebP, and fails the build when an
 * approved picture is missing, is not the size its entry declares, or
 * converts to a file heavier than the per-file image budget in
 * test/bundle-budgets.json. Files the list no longer names are removed, so
 * a dropped screen is not served on.
 *
 * The folder is build output, ignored by git: the approved PNG is the one
 * copy of each picture, and every build converts it again.
 *
 * Usage: tsx scripts/generate-screens.ts
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import budgets from "../../test/bundle-budgets.json";
import { SCREEN_DENSITIES, SCREENS_DIR, SHOWN, SHOWN_SCALE, screenFile, shownSize, type Shown } from "../src/lib/screens";

/** Where the visual suite keeps the pictures it approved for the site. */
const APPROVED = fileURLToPath(new URL("../../test/visual/tests/__shown__/", import.meta.url));

/**
 * The encoder's settings. Quality 90 keeps the edges of small text clean,
 * which is most of what a screen of the product is; effort 6 spends the
 * build's time once for a smaller file on every visit.
 */
const WEBP = { quality: 90, effort: 6 } as const;

/** One conversion: the pictures to convert, where their approved PNGs are, where the files go and the most one file may weigh. */
export interface ScreensJob {
  readonly shown: readonly Shown[];
  readonly sourceDir: string;
  readonly outDir: string;
  readonly maxBytes: number;
}

/** One file written, and its weight. */
export interface WrittenScreen {
  readonly file: string;
  readonly bytes: number;
}

/**
 * Converts every picture in `job.shown` and removes every other file in
 * `job.outDir`. Throws one error naming every problem found, after writing
 * what it could.
 */
export async function generateScreens(job: ScreensJob): Promise<WrittenScreen[]> {
  await fs.mkdir(job.outDir, { recursive: true });
  const problems: string[] = [];
  const written: WrittenScreen[] = [];

  for (const shown of job.shown) {
    const source = path.join(job.sourceDir, `${shown.name}.png`);
    const size = shownSize(shown);
    const drawn = await sharp(source)
      .metadata()
      .catch(() => null);
    if (!drawn) {
      problems.push(`${shown.name}: no approved picture at ${source}; mint it with \`make test-visual UPDATE=1\``);
      continue;
    }
    const expected = [size.width * SHOWN_SCALE, size.height * SHOWN_SCALE];
    if (drawn.width !== expected[0] || drawn.height !== expected[1]) {
      problems.push(
        `${shown.name}: the approved picture is ${drawn.width}×${drawn.height}, ` +
          `not the ${expected[0]}×${expected[1]} its entry declares at scale ${SHOWN_SCALE}`,
      );
      continue;
    }
    for (const density of SCREEN_DENSITIES) {
      const file = screenFile(shown.name, density);
      const data = await sharp(source)
        .resize(size.width * density, size.height * density)
        .webp(WEBP)
        .toBuffer();
      await fs.writeFile(path.join(job.outDir, file), data);
      written.push({ file, bytes: data.length });
      if (data.length > job.maxBytes) {
        problems.push(`${file}: ${data.length} B, over the ${job.maxBytes} B a screen may weigh (test/bundle-budgets.json, images)`);
      }
    }
  }

  const named = new Set(job.shown.flatMap((shown) => SCREEN_DENSITIES.map((density) => screenFile(shown.name, density))));
  for (const file of await fs.readdir(job.outDir)) {
    if (!named.has(file)) await fs.rm(path.join(job.outDir, file), { recursive: true, force: true });
  }

  if (problems.length > 0) throw new Error(problems.join("\n"));
  return written;
}

async function main(): Promise<void> {
  console.log("🖥  Stigmer screens, from the visual suite's approved pictures");
  try {
    const written = await generateScreens({
      shown: SHOWN,
      sourceDir: APPROVED,
      outDir: path.join(process.cwd(), "public", SCREENS_DIR),
      maxBytes: budgets.images["site/screen"],
    });
    for (const { file, bytes } of written) console.log(`  ✓ public/${SCREENS_DIR}/${file} (${bytes} B)`);
  } catch (error) {
    console.error("\n❌ Error generating screens:\n", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export const generation = main();
