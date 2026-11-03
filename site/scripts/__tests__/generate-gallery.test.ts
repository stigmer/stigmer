// @vitest-environment node
/**
 * The gallery's build into the site: the workspace's Vite, run in the visual
 * suite with the site's `/gallery/` base and `public/gallery` as its output
 * (the module builds when imported, so each case imports it with the build
 * answered); a workspace with no Vite, and a build that fails, fail the
 * site's build too.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = fileURLToPath(new URL("../../", import.meta.url));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("node:child_process");
  vi.doUnmock("node:fs");
  vi.restoreAllMocks();
});

/** Imports the script with Vite present or not, and the build answering `status`; returns the calls it made. */
async function runWith(vitePresent: boolean, status: number | null) {
  const spawnSync = vi.fn(() => ({ status, signal: status === null ? "SIGKILL" : null }));
  vi.doMock("node:child_process", () => ({ spawnSync }));
  vi.doMock("node:fs", async (original) => ({ ...(await original<typeof import("node:fs")>()), existsSync: () => vitePresent }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  const imported = import("../generate-gallery");
  return { spawnSync, imported };
}

describe("generate-gallery", () => {
  it("builds the visual suite's page under /gallery/ into the site's public folder", async () => {
    const { spawnSync, imported } = await runWith(true, 0);
    const { galleryBuild } = await imported;
    const build = galleryBuild(SITE);
    expect(build.out).toBe(path.join(SITE, "public", "gallery"));
    expect(build.cwd).toBe(path.join(SITE, "..", "test", "visual"));
    expect(build.args).toEqual(["build", "--base", "/gallery/", "--outDir", build.out, "--emptyOutDir", "--logLevel", "warn"]);
    expect(spawnSync).toHaveBeenCalledWith(build.vite, build.args, { cwd: build.cwd, stdio: "inherit" });
    expect(console.log).toHaveBeenCalledWith("gallery: built into public/gallery/ for the docs' live demos");
  });

  it("fails the site's build when the workspace has no Vite", async () => {
    const { spawnSync, imported } = await runWith(false, 0);
    await expect(imported).rejects.toThrow(/no Vite at .*run `npm ci` at the root first/);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("fails the site's build when the gallery's build fails, naming how", async () => {
    await expect((await runWith(true, 2)).imported).rejects.toThrow("the gallery's build failed (exit 2)");
    vi.resetModules();
    await expect((await runWith(true, null)).imported).rejects.toThrow("the gallery's build failed (exit SIGKILL)");
  });
});
