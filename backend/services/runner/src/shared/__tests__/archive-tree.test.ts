/**
 * Where a skill's or plugin's tree goes, and the archive cache beside it
 * (`../archive-tree.ts`): runner-owned under `/runner/mounts/<session>`
 * only where the runner separates (root, Linux, the runner layer), the
 * archive cache used only while it verifies, and nothing kept of an
 * archive carrying an eval suite. The runner-owned tree's logic runs here
 * as this machine's own user standing in for root (its link, its completion
 * mark, the re-unpack after a wake, the refusal of a folder someone else
 * could write); root's writes and the agent's refusals are proved in a
 * container (`../../__tests__/skill-mount-readonly.container.test.ts`).
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentOwnedTree,
  RunnerOwnedTree,
  cachedArchive,
  holdSessionTrees,
  releaseSessionTrees,
  cachedArchivePath,
  keepArchive,
  placeArchiveTree,
  pluginTreeKey,
  runnerMountsRoot,
  sessionTreesDir,
  skillTreeKey,
} from "../archive-tree.js";

const LINUX_ROOT_LAYER = { platform: "linux" as const, uid: 0, env: { STIGMER_RUNNER_LAYER: "1" } };

describe("where the trees go", () => {
  it("is /runner/mounts/<session> only where the runner separates", () => {
    expect(runnerMountsRoot(LINUX_ROOT_LAYER)).toBe("/runner/mounts");
    expect(sessionTreesDir("ses-1", LINUX_ROOT_LAYER)).toBe("/runner/mounts/ses-1");
    expect(runnerMountsRoot({ ...LINUX_ROOT_LAYER, env: { ...LINUX_ROOT_LAYER.env, STIGMER_RUNNER_MOUNTS_DIR: "/srv/trees" } })).toBe("/srv/trees");
    expect(runnerMountsRoot({ ...LINUX_ROOT_LAYER, uid: 1000 })).toBeUndefined();
    expect(runnerMountsRoot({ ...LINUX_ROOT_LAYER, platform: "darwin" })).toBeUndefined();
    expect(runnerMountsRoot({ ...LINUX_ROOT_LAYER, env: {} })).toBeUndefined();
  });

  it("keys a tree by its content: a skill by its archive and spec text, a plugin by its digest", () => {
    expect(skillTreeKey("a".repeat(64), "# A")).not.toBe(skillTreeKey("a".repeat(64), "# B"));
    expect(skillTreeKey(undefined, "# A")).not.toBe(skillTreeKey("a".repeat(64), "# A"));
    expect(skillTreeKey("a".repeat(64), "# A")).toMatch(/^skill-[0-9a-f]{64}$/);
    expect(pluginTreeKey("d".repeat(64))).toBe(`plugin-${"d".repeat(64)}`);
  });
});

describe("the archive cache", () => {
  let platform: string;
  const archive = new TextEncoder().encode("zip bytes");
  const sha = createHash("sha256").update(archive).digest("hex");

  beforeEach(() => {
    platform = mkdtempSync(join(tmpdir(), "archive-cache-"));
  });
  afterEach(() => rmSync(platform, { recursive: true, force: true }));

  it("fetches once, then serves the cache while it verifies", async () => {
    const fetch = vi.fn(async () => archive);
    await keepArchive(platform, sha, (await cachedArchive(platform, sha, fetch))!, true);
    await cachedArchive(platform, sha, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(readFileSync(cachedArchivePath(platform, sha))).toEqual(Buffer.from(archive));
  });

  it("fetches again when the cache was tampered with, and refuses fetched bytes of another version", async () => {
    mkdirSync(join(platform, "archives"));
    writeFileSync(cachedArchivePath(platform, sha), "tampered");
    const fetch = vi.fn(async () => archive);
    expect(await cachedArchive(platform, sha, fetch)).toEqual(archive);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(cachedArchive(platform, "0".repeat(64), fetch)).rejects.toThrow(/does not match its version/);
  });

  it("keeps nothing of an archive that carries an eval suite, removing an earlier copy", async () => {
    await keepArchive(platform, sha, archive, true);
    await keepArchive(platform, sha, archive, false);
    expect(existsSync(cachedArchivePath(platform, sha))).toBe(false);
  });
});

describe("placeArchiveTree where the runner does not separate", () => {
  it("writes an agent-owned tree at the link's path, held to its archive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "place-tree-"));
    try {
      const tree = await placeArchiveTree({
        linkPath: join(dir, "skills", "notes"),
        sessionId: "ses-1",
        key: "skill-x",
        entries: [{ path: "SKILL.md", content: new TextEncoder().encode("# Notes") }],
        label: "skill artifact",
      });
      expect(tree).toBeInstanceOf(AgentOwnedTree);
      expect(tree.root).toBe(join(dir, "skills", "notes"));
      writeFileSync(join(tree.root, "SKILL.md"), "edited");
      await tree.verify();
      expect(readFileSync(join(tree.root, "SKILL.md"), "utf-8")).toBe("# Notes");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the agent-owned tree, where the runner does not separate", () => {
  it("rebuilds a tree whose root became a link, as a runner-owned layout left it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-tree-"));
    try {
      const entries = [{ path: "SKILL.md", content: new TextEncoder().encode("# Pushed") }];
      mkdirSync(join(dir, "elsewhere"));
      writeFileSync(join(dir, "elsewhere", "SKILL.md"), "# Pushed");
      symlinkSync(join(dir, "elsewhere"), join(dir, "notes"));
      await new AgentOwnedTree(join(dir, "notes"), entries, "skill artifact").verify();
      expect(lstatSync(join(dir, "notes")).isDirectory()).toBe(true);
      expect(readFileSync(join(dir, "notes", "SKILL.md"), "utf8")).toBe("# Pushed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the runner-owned tree, its owner standing in for root", () => {
  let base: string;
  let mounts: string;
  let platform: string;
  const owner = process.getuid?.() ?? 0;
  const enc = (text: string) => new TextEncoder().encode(text);
  const entries = [
    { path: "SKILL.md", content: enc("# Pushed") },
    { path: "scripts/run.sh", content: enc("echo ok") },
  ];
  const treeAt = (key = "skill-k") => new RunnerOwnedTree(join(platform, "skills", "notes"), mounts, join(mounts, "ses-1"), key, entries, "skill artifact", owner);

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "runner-tree-"));
    mounts = join(base, "mounts");
    platform = join(base, "platform");
    mkdirSync(join(platform, "skills"), { recursive: true });
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("unpacks the tree under the session's folder, completion mark beside it, and links the platform folder to it", async () => {
    const tree = treeAt();
    await tree.verify();
    const treeDir = join(mounts, "ses-1", "skill-k");
    expect(lstatSync(tree.root).isSymbolicLink()).toBe(true);
    expect(readlinkSync(tree.root)).toBe(treeDir);
    expect(readFileSync(join(tree.root, "SKILL.md"), "utf8")).toBe("# Pushed");
    expect(statSync(join(treeDir, "scripts", "run.sh")).mode & 0o111).not.toBe(0);
    expect(existsSync(`${treeDir}.complete`)).toBe(true);
  });

  it("puts back a link a command replaced, and unpacks again when the folder is gone (a wake), the mark first", async () => {
    const tree = treeAt();
    await tree.verify();
    rmSync(tree.root);
    mkdirSync(tree.root);
    writeFileSync(join(tree.root, "SKILL.md"), "forged");
    await tree.verify();
    expect(readFileSync(join(tree.root, "SKILL.md"), "utf8")).toBe("# Pushed");

    rmSync(mounts, { recursive: true, force: true });
    await tree.verify();
    expect(readFileSync(join(tree.root, "SKILL.md"), "utf8")).toBe("# Pushed");

    rmSync(join(mounts, "ses-1", "skill-k.complete"));
    writeFileSync(join(mounts, "ses-1", "skill-k", "planted.md"), "a half-written tree");
    await tree.verify();
    expect(existsSync(join(mounts, "ses-1", "skill-k", "planted.md")), "a tree without its mark is unpacked afresh").toBe(false);
  });

  it("refuses to write in a folder others may write, or one that is a link", async () => {
    mkdirSync(join(mounts, "ses-1"), { recursive: true });
    chmodSync(join(mounts, "ses-1"), 0o777);
    await expect(treeAt().verify()).rejects.toThrow(/closed to others; the runner writes no skill there/);

    rmSync(join(mounts, "ses-1"), { recursive: true });
    mkdirSync(join(base, "elsewhere"));
    symlinkSync(join(base, "elsewhere"), join(mounts, "ses-1"));
    await expect(treeAt().verify()).rejects.toThrow(/closed to others/);
  });

  it("holds the session's folder to the trees a turn mounted, and removes it with the session", async () => {
    const facts = { platform: "linux" as const, uid: 0, env: { STIGMER_RUNNER_LAYER: "1", STIGMER_RUNNER_MOUNTS_DIR: mounts } };
    await treeAt("skill-kept").verify();
    await treeAt("skill-dropped").verify();
    await holdSessionTrees("ses-1", ["skill-kept"], facts);
    expect(existsSync(join(mounts, "ses-1", "skill-kept"))).toBe(true);
    expect(existsSync(join(mounts, "ses-1", "skill-kept.complete"))).toBe(true);
    expect(existsSync(join(mounts, "ses-1", "skill-dropped"))).toBe(false);
    await holdSessionTrees("ses-missing", [], facts);

    await releaseSessionTrees("ses-1", facts);
    expect(existsSync(join(mounts, "ses-1"))).toBe(false);
  });

  it("logs, never throws, when a session's trees cannot be removed", async () => {
    writeFileSync(join(base, "a-file"), "not a folder");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const facts = { platform: "linux" as const, uid: 0, env: { STIGMER_RUNNER_LAYER: "1", STIGMER_RUNNER_MOUNTS_DIR: join(base, "a-file") } };
    await expect(releaseSessionTrees("ses-1", facts)).resolves.toBeUndefined();
    expect(errors.mock.calls.flat().join(" ")).toContain("removing the skill trees of session ses-1 failed");
    errors.mockRestore();
  });
});
