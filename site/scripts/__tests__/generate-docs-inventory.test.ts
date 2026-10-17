// @vitest-environment node
/** Run the docs inventory gate's CLI in a temporary site, the way `make check-docs-inventory` does. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv;
let root: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  process.argv = argv;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/** A docs tree of one page beside a site directory, with `classification` as its record. */
async function prepare(classification: string) {
  root = await mkdtemp(join(tmpdir(), "stigmer-docs-inventory-"));
  const site = join(root, "site");
  await mkdir(site);
  await mkdir(join(root, "docs", "_inventory"), { recursive: true });
  await writeFile(join(root, "docs", "index.mdx"), "---\ntitle: Home\n---\n\n# Home\n");
  await writeFile(join(root, "docs", "meta.json"), JSON.stringify({ pages: ["index"] }));
  await writeFile(join(root, "docs", "_inventory", "classification.yaml"), classification);
  vi.spyOn(process, "cwd").mockReturnValue(site);
  process.argv = ["node", "index.ts", "--check"];
  const errors: string[] = [];
  const logs: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    errors.push(parts.join(" "));
  });
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    logs.push(parts.join(" "));
  });
  const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  return { errors, logs, exit };
}

describe("the docs inventory gate", () => {
  it("names each violation and the fields an entry needs, and exits 1", async () => {
    const { errors, exit } = await prepare("pages: {}\ncohorts: {}\n");
    const { run } = await import("../generate-docs-inventory/index");
    await run;
    const text = errors.join("\n");
    expect(text).toContain("index [unclassified-page]");
    expect(text).toContain("(fate, diataxis, teaches, medium); generated pages are covered by cohort rules");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("passes a classified tree and says how many pages it checked", async () => {
    const { logs, exit } = await prepare(
      "pages:\n  index:\n    fate: keep\n    diataxis: landing\n    teaches: Where to start.\n    medium: none\ncohorts: {}\n",
    );
    const { run } = await import("../generate-docs-inventory/index");
    await run;
    expect(logs.join("\n")).toContain("docs inventory gate: 1 pages OK (1 classified, 0 cohort-covered)");
    expect(exit).not.toHaveBeenCalled();
  });
});
