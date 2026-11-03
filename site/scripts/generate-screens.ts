/**
 * Converts the screens the site and the docs show into the files they serve.
 *
 * Every screen is a picture the visual suite draws and approves
 * (test/visual/src/shown.ts, approved under test/visual/tests/__shown__).
 * This writes each one to `public/screens` once per density
 * (src/lib/screens.ts names the files) as WebP, in whichever of its two
 * encodings is smaller, and fails the build when an
 * approved picture is missing, is not the size its entry declares, or
 * converts to a file heavier than the per-file image budget in
 * test/bundle-budgets.json. A set of screens one visit fetches together
 * (the homepage hero's five moments, in one crop at one density) is weighed
 * as a whole too, against its own budget there, and its sum is printed.
 * Files the list no longer names are removed, so a dropped screen is not
 * served on.
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
import { HERO_SETS } from "../src/lib/hero-moments";
import { SCREEN_DENSITIES, SCREENS_DIR, SHOWN, SHOWN_SCALE, screenFile, shownSize, type Shown } from "../src/lib/screens";

/** Where the visual suite keeps the pictures it approved for the site. */
const APPROVED = fileURLToPath(new URL("../../test/visual/tests/__shown__/", import.meta.url));

/**
 * The encoder's two settings; each file is written in the smaller. Lossless
 * keeps the drawing's own pixels, and wins where those are served as drawn
 * (the density the suite draws at), since a screen of the product is flat
 * colour and text. Quality 90 keeps the edges of small text clean, and wins
 * where the picture is scaled down, which blends new colours into every
 * edge. Effort 6 spends the build's time once for a smaller file on every
 * visit.
 */
const WEBP_SETTINGS = [
  { quality: 90, effort: 6 },
  { lossless: true, effort: 6 },
] as const;

/** `source` at `width`×`height` as WebP, in the smaller of the encoder's settings. */
async function smallestWebp(source: string, width: number, height: number): Promise<Buffer> {
  const encoded = await Promise.all(WEBP_SETTINGS.map((settings) => sharp(source).resize(width, height).webp(settings).toBuffer()));
  return encoded.reduce((smallest, candidate) => (candidate.length < smallest.length ? candidate : smallest));
}

/** Screens a visit fetches together, and the most they may weigh at any one density. */
export interface ScreenSet {
  /** The set's name in the budget file and in what is printed: `site/hero whole`. */
  readonly label: string;
  readonly names: readonly string[];
  readonly maxBytes: number;
}

/** One conversion: the pictures to convert, where their approved PNGs are, where the files go, the most one file may weigh, and the sets weighed whole. */
export interface ScreensJob {
  readonly shown: readonly Shown[];
  readonly sourceDir: string;
  readonly outDir: string;
  readonly maxBytes: number;
  readonly sets?: readonly ScreenSet[];
}

/** One file written, and its weight. */
export interface WrittenScreen {
  readonly file: string;
  readonly bytes: number;
}

/** One set at one density, and what its files weigh together. */
export interface SetWeight {
  readonly set: ScreenSet;
  readonly density: number;
  readonly bytes: number;
}

/** Each set's weight at each density, from the files written; a file not written counts nothing, and its own problem says why. */
export function setWeights(sets: readonly ScreenSet[], written: readonly WrittenScreen[]): SetWeight[] {
  const bytesOf = new Map(written.map(({ file, bytes }) => [file, bytes]));
  return sets.flatMap((set) =>
    SCREEN_DENSITIES.map((density) => ({
      set,
      density,
      bytes: set.names.reduce((sum, name) => sum + (bytesOf.get(screenFile(name, density)) ?? 0), 0),
    })),
  );
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
      const data = await smallestWebp(source, size.width * density, size.height * density);
      await fs.writeFile(path.join(job.outDir, file), data);
      written.push({ file, bytes: data.length });
      if (data.length > job.maxBytes) {
        problems.push(`${file}: ${data.length} B, over the ${job.maxBytes} B a screen may weigh (test/bundle-budgets.json, images)`);
      }
    }
  }

  for (const { set, density, bytes } of setWeights(job.sets ?? [], written)) {
    if (bytes > set.maxBytes) {
      problems.push(`${set.label} at ${density}x: ${bytes} B together, over the ${set.maxBytes} B the set may weigh (test/bundle-budgets.json, images)`);
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
  // The hero's moments, one set per crop: a visit fetches one crop at one density.
  const sets = HERO_SETS.map(({ crop, names }) => ({ label: `site/hero ${crop}`, names, maxBytes: budgets.images["site/hero"] }));
  try {
    const written = await generateScreens({
      shown: SHOWN,
      sourceDir: APPROVED,
      outDir: path.join(process.cwd(), "public", SCREENS_DIR),
      maxBytes: budgets.images["site/screen"],
      sets,
    });
    for (const { file, bytes } of written) console.log(`  ✓ public/${SCREENS_DIR}/${file} (${bytes} B)`);
    for (const { set, density, bytes } of setWeights(sets, written)) {
      console.log(`  ✓ ${set.label} at ${density}x: ${bytes} B of ${set.maxBytes} B`);
    }
  } catch (error) {
    console.error("\n❌ Error generating screens:\n", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export const generation = main();
