/**
 * Where a skill's or plugin's tree goes, and the archive cache beside it
 * (`../archive-tree.ts`): runner-owned under `/runner/mounts/<session>`
 * only where the runner separates (root, Linux, the runner layer), the
 * archive cache used only while it verifies, and nothing kept of an
 * archive carrying an eval suite. The runner-owned tree itself (root
 * writes, the agent refused) is proved in a container
 * (`../../__tests__/skill-mount-readonly.container.test.ts`).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentOwnedTree,
  cachedArchive,
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
