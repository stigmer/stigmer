// @vitest-environment node
/** Exercise the real image pipeline in a temporary site, including its failure reporting. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

vi.mock("../../../brand/assets.mjs", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../brand/assets.mjs")>();
  return { ...real, brandSvg: vi.fn(real.brandSvg) };
});
let root: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function prepare(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "stigmer-brand-test-"));
  const site = join(root, "site");
  await mkdir(join(site, "public"), { recursive: true });
  await mkdir(join(root, "docs"));
  vi.spyOn(process, "cwd").mockReturnValue(site);
  vi.spyOn(console, "log").mockImplementation(() => {});
  return join(site, "public");
}

describe("website brand exports", () => {
  it("generates browser sizes, an ICO, the social image and the README banner", async () => {
    const publicDir = await prepare();
    const { generation } = await import("../generate-images");
    await generation;
    for (const [file, width, height] of [
      ["favicon-16x16.png", 16, 16],
      ["favicon-32x32.png", 32, 32],
      ["apple-touch-icon.png", 180, 180],
      ["icon-192.png", 192, 192],
      ["icon-512.png", 512, 512],
      ["og-image.png", 1200, 630],
    ] as const) {
      const info = await sharp(join(publicDir, file)).metadata();
      expect([info.width, info.height]).toEqual([width, height]);
    }
    const ico = await readFile(join(publicDir, "favicon.ico"));
    expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 2, 0]);
    expect(await readFile(join(root!, "docs/banner_dark.png"))).toEqual(
      await readFile(join(publicDir, "og-image.png")),
    );
    expect(await readFile(join(publicDir, "logo-lockup-white.svg"))).toEqual(
      await readFile(new URL("../../../brand/logo-lockup-white.svg", import.meta.url)),
    );
  });

  it("reports source errors and exits unsuccessfully instead of declaring success", async () => {
    await prepare();
    const { brandSvg } = await import("../../../brand/assets.mjs");
    vi.mocked(brandSvg).mockRejectedValueOnce(
      new Error("brand source unavailable"),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    const { generation } = await import("../generate-images");
    await expect(generation).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ message: "brand source unavailable" }),
    );
  });
});
