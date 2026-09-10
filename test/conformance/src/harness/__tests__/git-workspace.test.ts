// Unit arms for the git workspace fixture (entry 20260910.02): the two seeds
// the runner's capture depends on are ignored from the first commit, seeded
// files are tracked and HEAD moves only when the FIXTURE commits, and the
// read/exists/remove surface reads the tree the runner will later reconcile.
// Real git in a temp dir; no runner, no target.
// Domain: conformance harness (execution engine).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitWorkspace } from "../git-workspace";

const execFileAsync = promisify(execFile);
let workspace: GitWorkspace;

beforeAll(async () => {
  workspace = await GitWorkspace.create();
});

afterAll(async () => {
  await workspace.cleanup();
});

async function isIgnored(relPath: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["check-ignore", "-q", "--", relPath], { cwd: workspace.dir });
    return true;
  } catch {
    return false;
  }
}

describe("GitWorkspace", () => {
  it("seeds a repo whose runner state dir and .env are ignored and whose HEAD is the seed commit", async () => {
    expect(await isIgnored(".stigmer/state.json"), "the runner's per-workspace state must never be capturable").toBe(true);
    expect(await isIgnored(".env"), "the canonical secret path is ignored, which is what classifies it as a secret").toBe(true);
    expect(await isIgnored("src/app.ts"), "ordinary paths are capturable").toBe(false);
    expect(await workspace.headSha()).toMatch(/^[0-9a-f]{40}$/);
  });

  it("seedFile tracks content in a new commit; seedGitignorePattern ignores a non-secret path", async () => {
    const before = await workspace.headSha();
    await workspace.seedFile("notes.md", "hello\n");
    const afterSeed = await workspace.headSha();

    expect(afterSeed).not.toBe(before);
    expect(await workspace.readFile("notes.md")).toBe("hello\n");
    expect(await isIgnored("notes.md")).toBe(false);

    await workspace.seedGitignorePattern("cache/");
    expect(await isIgnored("cache/data.txt")).toBe(true);
    expect(await workspace.headSha()).not.toBe(afterSeed);
  });

  it("seeds binary bytes verbatim and reads them back; removeWorkingFile drops the working copy only", async () => {
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x00, 0x42]);
    await workspace.seedFile("blob.bin", bytes);
    expect((await workspace.readBytes("blob.bin")).equals(bytes)).toBe(true);

    const head = await workspace.headSha();
    await workspace.removeWorkingFile("blob.bin");
    expect(await workspace.exists("blob.bin")).toBe(false);
    expect(await workspace.headSha(), "removing a working file never touches the object store").toBe(head);
    await expect(workspace.removeWorkingFile("blob.bin"), "a second remove is a no-op").resolves.toBeUndefined();
  });
});
