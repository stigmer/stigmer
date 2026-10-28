// Unit arms for the end-state reader, over temp directories.
// Domain: conformance benchmark.
//
// Pinned: the comparison lists added, modified and deleted files, sorted by
// code point, ignores an empty directory (what a harness's teardown can leave),
// and counts a symbolic link as an entry of its own without following it.
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changedFiles } from "../workspace-facts";

let base: string;
let before: string;
let after: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "workspace-facts-"));
  before = join(base, "before");
  after = join(base, "after");
  for (const root of [before, after]) {
    await mkdir(join(root, "duration"), { recursive: true });
    await writeFile(join(root, "README.md"), "# orders-sync\n");
    await writeFile(join(root, "duration", "duration.go"), "package duration\n");
    await writeFile(join(root, "CHANGELOG.md"), "# Changelog\n");
  }
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("changedFiles", () => {
  it("is empty for an untouched copy", async () => {
    expect(await changedFiles(before, after)).toEqual([]);
  });

  it("lists added, modified and deleted files sorted by path, and ignores an empty directory", async () => {
    await writeFile(join(after, "duration", "duration.go"), "package duration\n\nfunc X() {}\n");
    await writeFile(join(after, "NOTES.md"), "notes\n");
    await rm(join(after, "CHANGELOG.md"));
    await mkdir(join(after, ".claude", "rules"), { recursive: true });
    expect(await changedFiles(before, after)).toEqual([
      { path: "CHANGELOG.md", change: "deleted" },
      { path: "NOTES.md", change: "added" },
      { path: "duration/duration.go", change: "modified" },
    ]);
  });

  it("lists a file left in a runner-owned directory, and a link, without following the link", async () => {
    await mkdir(join(after, ".claude"), { recursive: true });
    await writeFile(join(after, ".claude", "settings.json"), "{}\n");
    await symlink(join(base, "elsewhere"), join(after, ".stigmer"));
    expect(await changedFiles(before, after)).toEqual([
      { path: ".claude/settings.json", change: "added" },
      { path: ".stigmer", change: "added" },
    ]);
  });
});
