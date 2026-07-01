import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CasCaptureFilesystemBackend, type CasBeforeMap } from "../cas-capture-backend.js";

/**
 * The observer records the PRE-TURN bytes of first-touched gitignored paths,
 * gate-independently, so the turn boundary can compose them into the CAS change
 * set. These tests assert the recording contract (not deepagents' write/edit
 * semantics): only gitignored paths, only the first touch, and never a
 * post-write baseline under concurrency.
 */
describe("CasCaptureFilesystemBackend (CAS before-observer)", () => {
  let root: string;

  /** Paths under `ignored/` are gitignored; everything else is git-tracked. */
  const isIgnored = async (relPath: string): Promise<boolean> =>
    relPath.startsWith("ignored/");

  function makeBackend(): { backend: CasCaptureFilesystemBackend; collector: CasBeforeMap } {
    const collector: CasBeforeMap = new Map();
    const backend = new CasCaptureFilesystemBackend({ rootDir: root }, { collector, isIgnored });
    return { backend, collector };
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cas-observer-"));
    await mkdir(join(root, "ignored"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("records before=null for a newly created gitignored path (an ADD)", async () => {
    const { backend, collector } = makeBackend();

    await backend.write("ignored/new.txt", "hello");

    expect(collector.has("ignored/new.txt")).toBe(true);
    expect(collector.get("ignored/new.txt")).toBeNull();
  });

  it("records the pre-turn bytes for a modified gitignored file", async () => {
    await writeFile(join(root, "ignored/cfg.txt"), "v0");
    const { backend, collector } = makeBackend();

    await backend.edit("ignored/cfg.txt", "v0", "v1");

    const before = collector.get("ignored/cfg.txt");
    expect(before).not.toBeNull();
    expect(Buffer.from(before!).toString("utf8")).toBe("v0");
  });

  it("first-touch-wins: a second edit does not overwrite the recorded baseline", async () => {
    await writeFile(join(root, "ignored/log.txt"), "a");
    const { backend, collector } = makeBackend();

    await backend.edit("ignored/log.txt", "a", "b");
    await backend.edit("ignored/log.txt", "b", "c");

    const before = collector.get("ignored/log.txt");
    expect(Buffer.from(before!).toString("utf8")).toBe("a"); // the pre-turn bytes
  });

  it("does NOT record git-tracked paths (the git diff captures those)", async () => {
    const { backend, collector } = makeBackend();

    await backend.write("src/app.ts", "export const x = 1;");

    expect(collector.has("src/app.ts")).toBe(false);
    expect(collector.size).toBe(0);
  });

  it("normalizes virtual-root ('/'-prefixed) paths to workspace-relative keys", async () => {
    const { backend, collector } = makeBackend();

    await backend.write("/ignored/rooted.txt", "x");

    expect(collector.has("ignored/rooted.txt")).toBe(true);
  });

  it("under concurrent writes to one path, records the pre-turn baseline exactly once", async () => {
    await writeFile(join(root, "ignored/race.txt"), "orig");
    const { backend, collector } = makeBackend();

    // Fire two edits concurrently; the synchronous slot reservation must ensure
    // only the pre-turn bytes are recorded, never a post-write value.
    await Promise.allSettled([
      backend.edit("ignored/race.txt", "orig", "A"),
      backend.edit("ignored/race.txt", "orig", "B"),
    ]);

    expect(collector.size).toBe(1);
    const before = collector.get("ignored/race.txt");
    expect(Buffer.from(before!).toString("utf8")).toBe("orig");
  });
});
