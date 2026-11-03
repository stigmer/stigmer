// @vitest-environment node
/**
 * The screens the site serves, converted from the visual suite's approved
 * pictures. The real run converts the real list in a temporary site, weighs
 * the hero's moments as sets, and fails the build when a file is over the
 * image budget; direct calls on tiny synthetic pictures cover a missing
 * picture, a picture of the wrong size, a file over the budget, a set over
 * its budget and a file the list no longer names.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import budgets from "../../../test/bundle-budgets.json";
import { SHOWN, shownScreen, shownSize, type Shown } from "../../src/lib/screens";

let root: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("../../../test/bundle-budgets.json");
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/**
 * A temporary folder holding a site, which the module's own run (it converts
 * the real list when imported) takes for the one it builds.
 */
async function prepareSite(): Promise<{ readonly dir: string; readonly screens: string }> {
  root = await mkdtemp(join(tmpdir(), "stigmer-screens-test-"));
  const site = join(root, "site");
  await mkdir(join(site, "public"), { recursive: true });
  vi.spyOn(process, "cwd").mockReturnValue(site);
  vi.spyOn(console, "log").mockImplementation(() => {});
  return { dir: root, screens: join(site, "public", "screens") };
}

/** A synthetic picture: flat, or noise that no encoder can make small. */
async function png(dir: string, name: string, width: number, height: number, noise = false): Promise<void> {
  const image = noise
    ? sharp(Buffer.from(Array.from({ length: width * height * 3 }, () => Math.floor(Math.random() * 256))), {
        raw: { width, height, channels: 3 },
      })
    : sharp({ create: { width, height, channels: 3, background: "#101010" } });
  await writeFile(join(dir, `${name}.png`), await image.png().toBuffer());
}

/** The module, once its own run (which converts the real list into the temporary site) has finished. */
async function load(): Promise<typeof import("../generate-screens")> {
  const screens = await import("../generate-screens");
  await screens.generation;
  return screens;
}

function entry(name: string, width: number, height: number): Shown {
  return { name, scene: "session-approval", title: name, viewport: { width, height } };
}

// Converting one 2560×1600 picture twice at the encoder's highest effort.
const REAL_TIMEOUT_MS = 30_000;

describe("the site's screens, from the real list", () => {
  it(
    "converts every approved picture into a 1x and a 2x WebP, each its declared size and within the budget",
    async () => {
      const { screens: outDir } = await prepareSite();
      const { generation } = await import("../generate-screens");
      await generation;
      const { width, height } = shownSize(shownScreen("approval"));
      for (const [file, density] of [
        ["approval-1x.webp", 1],
        ["approval-2x.webp", 2],
      ] as const) {
        const info = await sharp(join(outDir, file)).metadata();
        expect([info.format, info.width, info.height]).toEqual(["webp", width * density, height * density]);
        expect((await stat(join(outDir, file))).size).toBeLessThanOrEqual(budgets.images["site/screen"]);
      }
      expect((await readdir(outDir)).sort()).toEqual(SHOWN.flatMap((s) => [`${s.name}-1x.webp`, `${s.name}-2x.webp`]).sort());
    },
    REAL_TIMEOUT_MS,
  );

  it(
    "weighs the hero's five moments as one set per crop and density, each within the hero's budget",
    async () => {
      await prepareSite();
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const { generation } = await import("../generate-screens");
      await generation;
      const lines = log.mock.calls.flat().join("\n");
      for (const crop of ["whole", "narrow"]) {
        for (const density of [1, 2]) {
          const [, sum] = new RegExp(`site/hero ${crop} at ${density}x: (\\d+) B of ${budgets.images["site/hero"]} B`).exec(lines) ?? [];
          expect(Number(sum), `${crop} ${density}x`).toBeGreaterThan(0);
          expect(Number(sum), `${crop} ${density}x`).toBeLessThanOrEqual(budgets.images["site/hero"]);
        }
      }
    },
    REAL_TIMEOUT_MS,
  );

  it(
    "stops the build, naming the file and its weight, when a screen is over the image budget",
    async () => {
      await prepareSite();
      vi.doMock("../../../test/bundle-budgets.json", () => ({ default: { budgets: {}, images: { "site/screen": 1000, "site/hero": 600_000 } } }));
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
      const { generation } = await import("../generate-screens");
      await generation;
      expect(exit).toHaveBeenCalledWith(1);
      expect(error.mock.calls.flat().join(" ")).toMatch(/approval-1x\.webp: \d+ B, over the 1000 B a screen may weigh/);
    },
    REAL_TIMEOUT_MS,
  );
});

describe("generateScreens", () => {
  it("writes each density from the picture drawn at the suite's scale, and removes files the list no longer names", async () => {
    const { dir } = await prepareSite();
    const outDir = join(dir, "out");
    await mkdir(outDir);
    await writeFile(join(outDir, "dropped-2x.webp"), "stale");
    await png(dir, "card", 40, 30);
    const { generateScreens } = await load();
    const written = await generateScreens({ shown: [entry("card", 20, 15)], sourceDir: dir, outDir, maxBytes: 100_000 });
    expect(written.map((w) => w.file)).toEqual(["card-1x.webp", "card-2x.webp"]);
    expect((await sharp(join(outDir, "card-1x.webp")).metadata()).width).toBe(20);
    expect((await readdir(outDir)).sort()).toEqual(["card-1x.webp", "card-2x.webp"]);
  });

  it("writes each file in the smaller of the lossless and the quality-90 encoding", async () => {
    const { dir } = await prepareSite();
    const outDir = join(dir, "out");
    await mkdir(outDir);
    await png(dir, "flat", 40, 30);
    await png(dir, "noisy", 40, 30, true);
    const { generateScreens } = await load();
    const written = await generateScreens({
      shown: [entry("flat", 20, 15), entry("noisy", 20, 15)],
      sourceDir: dir,
      outDir,
      maxBytes: 100_000,
    });
    for (const [name, density] of [
      ["flat", 2],
      ["noisy", 2],
      ["noisy", 1],
    ] as const) {
      const source = join(dir, `${name}.png`);
      const [width, height] = [20 * density, 15 * density];
      const lossy = (await sharp(source).resize(width, height).webp({ quality: 90, effort: 6 }).toBuffer()).length;
      const lossless = (await sharp(source).resize(width, height).webp({ lossless: true, effort: 6 }).toBuffer()).length;
      expect(written.find((w) => w.file === `${name}-${density}x.webp`)?.bytes, `${name} ${density}x`).toBe(Math.min(lossy, lossless));
    }
  });

  it("weighs a set of screens together at each density, and names a set over its budget with its sum", async () => {
    const { dir } = await prepareSite();
    await png(dir, "first", 40, 30, true);
    await png(dir, "second", 40, 30, true);
    await png(dir, "apart", 40, 30, true);
    const { generateScreens, setWeights } = await load();
    const shown = [entry("first", 20, 15), entry("second", 20, 15), entry("apart", 20, 15)];
    const set = { label: "site/hero whole", names: ["first", "second"], maxBytes: 1 };
    const outDir = join(dir, "out");
    const message = await generateScreens({ shown, sourceDir: dir, outDir, maxBytes: 100_000, sets: [set] }).then(
      () => "converted with no problem",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    const bytes = async (file: string) => (await stat(join(outDir, file))).size;
    for (const density of [1, 2]) {
      const sum = (await bytes(`first-${density}x.webp`)) + (await bytes(`second-${density}x.webp`));
      expect(message).toContain(`site/hero whole at ${density}x: ${sum} B together, over the 1 B the set may weigh`);
    }
    // Only the set's own files count, at their own density.
    const written = await Promise.all(
      ["first", "second", "apart"].flatMap((name) => [1, 2].map(async (density) => ({ file: `${name}-${density}x.webp`, bytes: await bytes(`${name}-${density}x.webp`) }))),
    );
    expect(setWeights([set], written).map(({ density, bytes: sum }) => [density, sum])).toEqual([
      [1, (await bytes("first-1x.webp")) + (await bytes("second-1x.webp"))],
      [2, (await bytes("first-2x.webp")) + (await bytes("second-2x.webp"))],
    ]);
  });

  it("names every problem at once: a missing picture, one of the wrong size, a file over the budget", async () => {
    const { dir } = await prepareSite();
    await png(dir, "wrong", 30, 30);
    await png(dir, "heavy", 200, 200, true);
    const { generateScreens } = await load();
    const job = {
      shown: [entry("missing", 10, 10), entry("wrong", 20, 15), entry("heavy", 100, 100)],
      sourceDir: dir,
      outDir: join(dir, "out"),
      maxBytes: 2_000,
    };
    const message = await generateScreens(job).then(
      () => "converted with no problem",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(message).toMatch(/missing: no approved picture at .*missing\.png; mint it with `make test-visual UPDATE=1`/);
    expect(message).toMatch(/wrong: the approved picture is 30×30, not the 40×30 its entry declares at scale 2/);
    expect(message).toMatch(/heavy-2x\.webp: \d+ B, over the 2000 B a screen may weigh/);
  });
});
