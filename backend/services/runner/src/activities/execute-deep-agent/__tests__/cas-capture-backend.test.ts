import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CasCaptureFilesystemBackend } from "../cas-capture-backend.js";
import { CasCaptureObserver } from "../cas-capture-observer.js";

/**
 * The backend is a thin adapter: it forwards each mutation point to the shared
 * {@link CasCaptureObserver} (which owns all capture state and logic) and then
 * delegates to the base `FilesystemBackend` to apply the write to disk. These
 * tests assert exactly that delegation contract — the write lands on disk AND the
 * observer sees the pre-turn bytes. The recording semantics themselves (first
 * touch, concurrency, memoization) are covered in cas-capture-observer.test.ts.
 */
describe("CasCaptureFilesystemBackend (thin CAS adapter)", () => {
  let root: string;

  const isIgnored = async (relPath: string): Promise<boolean> => relPath.startsWith("ignored/");

  function makeBackend(): { backend: CasCaptureFilesystemBackend; observer: CasCaptureObserver } {
    const observer = new CasCaptureObserver({ rootDir: root, isIgnored });
    const backend = new CasCaptureFilesystemBackend({ rootDir: root }, { observer });
    return { backend, observer };
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cas-backend-"));
    await mkdir(join(root, "ignored"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("write applies to disk AND records before=null for a new gitignored file", async () => {
    const { backend, observer } = makeBackend();

    await backend.write("ignored/new.txt", "hello");

    expect(await readFile(join(root, "ignored/new.txt"), "utf8")).toBe("hello");
    expect(observer.before.get("ignored/new.txt")).toBeNull();
  });

  it("edit applies to disk AND records the pre-turn bytes for a gitignored file", async () => {
    await writeFile(join(root, "ignored/cfg.txt"), "v0");
    const { backend, observer } = makeBackend();

    await backend.edit("ignored/cfg.txt", "v0", "v1");

    expect(await readFile(join(root, "ignored/cfg.txt"), "utf8")).toBe("v1");
    expect(Buffer.from(observer.before.get("ignored/cfg.txt")!).toString("utf8")).toBe("v0");
  });

  it("a git-tracked write applies to disk but is NOT observed (the git diff owns it)", async () => {
    const { backend, observer } = makeBackend();

    await backend.write("src/app.ts", "export const x = 1;");

    expect(await readFile(join(root, "src/app.ts"), "utf8")).toBe("export const x = 1;");
    expect(observer.before.size).toBe(0);
  });
});
