// @vitest-environment node
/**
 * Run the llms.txt generator over a one-page docs tree in a temporary site.
 *
 * Pins that both files AI tools read first describe Stigmer in the one
 * sentence from brand/positioning.ts, the words every other surface uses.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POSITIONING } from "../../../brand/positioning";

let root: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("generate-llms-txt", () => {
  it("opens llms.txt and llms-full.txt with the one sentence", async () => {
    root = await mkdtemp(join(tmpdir(), "stigmer-llms-test-"));
    const site = join(root, "site");
    await mkdir(join(site, "out"), { recursive: true });
    await mkdir(join(root, "docs"));
    await writeFile(
      join(root, "docs", "index.mdx"),
      "---\ntitle: Home\ndescription: About home.\n---\n\n# Home\n",
    );
    await writeFile(join(root, "docs", "meta.json"), JSON.stringify({ pages: [] }));
    vi.spyOn(process, "cwd").mockReturnValue(site);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { generation } = await import("../generate-llms-txt");
    await generation;

    const llms = await readFile(join(site, "out", "llms.txt"), "utf8");
    const full = await readFile(join(site, "out", "llms-full.txt"), "utf8");
    expect(llms.split("\n").slice(0, 3)).toEqual(["# Stigmer", "", `> ${POSITIONING.oneSentence}`]);
    expect(full.split("\n").slice(0, 3)).toEqual([
      "# Stigmer Documentation",
      "",
      `> ${POSITIONING.oneSentence}`,
    ]);
  });
});
