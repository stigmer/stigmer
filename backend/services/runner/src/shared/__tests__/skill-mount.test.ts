/**
 * A skill's tree: SKILL.md from the spec, the archive's other files with
 * their executable bits, a plugin root skill's eval suite left out, and a
 * tree held to that at every turn start where the runner does not separate
 * (`../archive-tree.ts` `AgentOwnedTree`); then the download lane and the
 * paths a `Skill`-denying turn may not read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create } from "@bufbuild/protobuf";
import { ConnectError, Code } from "@connectrpc/connect";
import { SkillSchema, type Skill } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { isSkillContentPath, downloadArtifact, skillTreeEntries } from "../skill-mount.js";
import { AgentOwnedTree } from "../archive-tree.js";
import { buildZip } from "@stigmer/zip-structure/testing";

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeSkillProto(overrides: { name?: string; skillMd?: string } = {}): Skill {
  return create(SkillSchema, {
    metadata: { id: `skill-${overrides.name ?? "test"}`, slug: overrides.name ?? "test-skill", org: "test-org" },
    spec: { name: overrides.name ?? "test-skill", description: "A test skill", skillMd: overrides.skillMd ?? "# Test Skill" },
    status: { artifactStorageKey: "", versionHash: "abc" },
  });
}

/** The skill's tree at `dir`, as the resolver places it where the runner does not separate. */
async function mountTree(skill: Skill, dir: string, artifact: Uint8Array | undefined): Promise<AgentOwnedTree> {
  const { entries } = await skillTreeEntries(skill, artifact);
  const tree = new AgentOwnedTree(dir, entries, "skill artifact");
  await tree.verify();
  return tree;
}

// ─── skillTreeEntries + the tree ─────────────────────────────────────────

describe("a skill's tree", () => {
  let skillDir: string;

  beforeEach(() => {
    skillDir = join(mkdtempSync(join(tmpdir(), "skill-mount-")), "test-skill");
  });

  afterEach(() => {
    rmSync(join(skillDir, ".."), { recursive: true, force: true });
  });

  it("is SKILL.md alone for a skill with no artifact, or whose download failed", async () => {
    const { entries, cacheable } = await skillTreeEntries(makeSkillProto({ skillMd: "# Only" }), undefined);
    expect(entries.map((entry) => entry.path)).toEqual(["SKILL.md"]);
    expect(cacheable).toBe(true);
  });

  it("is rebuilt at the next turn start after a command edits it, so no edit carries into the next message", async () => {
    const tree = await mountTree(makeSkillProto({ skillMd: "# Pushed" }), skillDir, buildZip([{ name: "references/guide.md", content: "guide" }]));
    writeFileSync(join(skillDir, "SKILL.md"), "# Edited by a command");
    writeFileSync(join(skillDir, "references", "guide.md"), "edited");
    writeFileSync(join(skillDir, "planted.md"), "planted");
    await tree.verify();
    expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toBe("# Pushed");
    expect(readFileSync(join(skillDir, "references", "guide.md"), "utf-8")).toBe("guide");
    expect(existsSync(join(skillDir, "planted.md"))).toBe(false);
  });

  it("removes files from a previous mount that the new version no longer carries", async () => {
    const v1 = buildZip([{ name: "references/removed-in-v2.md", content: "old" }]);
    const v2 = buildZip([{ name: "references/new-in-v2.md", content: "new" }]);

    await mountTree(makeSkillProto(), skillDir, v1);
    await mountTree(makeSkillProto(), skillDir, v2);

    expect(existsSync(join(skillDir, "references", "removed-in-v2.md"))).toBe(false);
    expect(readFileSync(join(skillDir, "references", "new-in-v2.md"), "utf-8")).toBe("new");
  });

  it("owns SKILL.md unconditionally — the zip's copy is ignored", async () => {
    const artifact = buildZip([{ name: "SKILL.md", content: "# Stale zip copy" }]);
    await mountTree(makeSkillProto({ skillMd: "# Authoritative" }), skillDir, artifact);
    expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toBe("# Authoritative");
  });

  it("rejects zip entries that escape the mount directory", async () => {
    const artifact = buildZip([{ name: "../escape.txt", content: "evil" }]);
    await expect(mountTree(makeSkillProto(), skillDir, artifact)).rejects.toThrow(/escapes its mount directory/);
    expect(existsSync(join(skillDir, "..", "escape.txt"))).toBe(false);
  });

  it("writes script entries with the executable bit set", async () => {
    const artifact = buildZip([
      { name: "scripts/run.py", content: "print('hi')" },
      { name: "references/notes.md", content: "notes" },
    ]);
    await mountTree(makeSkillProto(), skillDir, artifact);

    expect(statSync(join(skillDir, "scripts", "run.py")).mode & 0o111).not.toBe(0);
    expect(statSync(join(skillDir, "references", "notes.md")).mode & 0o111).toBe(0);
  });

  it("makes an extensionless script executable by its #! line", async () => {
    const artifact = buildZip([
      { name: "scripts/check", content: "#!/usr/bin/env bash\necho ok\n" },
      { name: "scripts/README", content: "plain text" },
    ]);
    await mountTree(makeSkillProto(), skillDir, artifact);

    expect(statSync(join(skillDir, "scripts", "check")).mode & 0o111).not.toBe(0);
    expect(statSync(join(skillDir, "scripts", "README")).mode & 0o111).toBe(0);
  });

  it("never mounts an eval suite a root skill's archive still carries, by its cleaned name, nor caches that archive", async () => {
    // A root skill's archive is the whole plugin, its manifest included; one
    // stored before the suite was stripped at push still holds `evals/`,
    // which a try must not read.
    const artifact = buildZip([
      { name: "./plugin.json", content: JSON.stringify({ name: "p" }) },
      { name: "references/guide.md", content: "guide" },
      { name: "evals/evals.json", content: "{}" },
      { name: "./evals/basic/case.yaml", content: "prompt: hi" },
      { name: "x/../evals/graders/g.yaml", content: "type: llm" },
      { name: "evalsx/kept.md", content: "not the suite" },
    ]);
    await mountTree(makeSkillProto(), skillDir, artifact);

    expect(existsSync(join(skillDir, "evals"))).toBe(false);
    expect(readFileSync(join(skillDir, "references", "guide.md"), "utf-8")).toBe("guide");
    expect(readFileSync(join(skillDir, "evalsx", "kept.md"), "utf-8")).toBe("not the suite");
    expect((await skillTreeEntries(makeSkillProto(), artifact)).cacheable).toBe(false);
  });

  it("mounts a standalone skill's own evals/, which holds no plugin manifest", async () => {
    // skill-creator keeps a skill's tests in `evals/evals.json`; only a
    // plugin's root skill can carry the plugin's suite.
    const artifact = buildZip([
      { name: "references/guide.md", content: "guide" },
      { name: "evals/evals.json", content: "{}" },
      { name: "nested/plugin.json", content: "{}" },
    ]);
    await mountTree(makeSkillProto(), skillDir, artifact);

    expect(readFileSync(join(skillDir, "evals", "evals.json"), "utf-8")).toBe("{}");
    expect(readFileSync(join(skillDir, "references", "guide.md"), "utf-8")).toBe("guide");
  });

  it("never mounts a suite the root skill's own manifest moves", async () => {
    // `experimental.evals` moves the suite out of `evals/`; the mount reads
    // the archive's manifest by the plugin mount's rule.
    const artifact = buildZip([
      { name: ".claude-plugin/plugin.json", content: JSON.stringify({ name: "p", experimental: { evals: "qa" } }) },
      { name: "references/guide.md", content: "guide" },
      { name: "qa/evals.json", content: "{}" },
      { name: "qa/basic/prompt.md", content: "hi" },
      { name: "evals/stale/prompt.md", content: "hi" },
      { name: "qa-notes/kept.md", content: "not the suite" },
    ]);
    await mountTree(makeSkillProto(), skillDir, artifact);

    expect(existsSync(join(skillDir, "qa"))).toBe(false);
    expect(existsSync(join(skillDir, "evals"))).toBe(false);
    expect(readFileSync(join(skillDir, "references", "guide.md"), "utf-8")).toBe("guide");
    expect(readFileSync(join(skillDir, "qa-notes", "kept.md"), "utf-8")).toBe("not the suite");
  });
});

// ─── downloadArtifact — transfer lane routing (#675) ─────────────────────

describe("downloadArtifact — transfer lane routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeClient(overrides: Record<string, any> = {}) {
    return { ...overrides } as any;
  }

  it("fetches bytes over HTTP when the server mints a download URL", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const client = makeClient({
      getSkillArtifactDownloadUrl: vi.fn().mockResolvedValue({
        url: "http://localhost:7234/v1/skill-artifacts/skills/abc.zip",
        sizeBytes: 5n,
        ttlSeconds: 0,
      }),
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes.buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const got = await downloadArtifact(client, "skills/abc.zip");

    expect(got).toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:7234/v1/skill-artifacts/skills/abc.zip");
  });

  it("fails the download on any mint refusal, Unimplemented included", async () => {
    for (const code of [Code.Internal, Code.Unimplemented]) {
      const client = makeClient({
        getSkillArtifactDownloadUrl: vi.fn().mockRejectedValue(new ConnectError("boom", code)),
      });
      await expect(downloadArtifact(client, "skills/abc.zip")).rejects.toThrow("boom");
    }
  });

  it("rejects truncated fetches via the minted size", async () => {
    const client = makeClient({
      getSkillArtifactDownloadUrl: vi.fn().mockResolvedValue({
        url: "http://localhost:7234/v1/skill-artifacts/skills/abc.zip",
        sizeBytes: 100n,
        ttlSeconds: 0,
      }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));

    await expect(downloadArtifact(client, "skills/abc.zip")).rejects.toThrow(/truncated/);
  });

  it("surfaces HTTP failures with the status code", async () => {
    const client = makeClient({
      getSkillArtifactDownloadUrl: vi.fn().mockResolvedValue({
        url: "http://localhost:7234/v1/skill-artifacts/skills/gone.zip",
        sizeBytes: 0n,
        ttlSeconds: 0,
      }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(downloadArtifact(client, "skills/gone.zip")).rejects.toThrow(/HTTP 404/);
  });

  it("keeps a signed URL's query out of a failed fetch's message", async () => {
    const client = makeClient({
      getSkillArtifactDownloadUrl: vi.fn().mockResolvedValue({
        url: "https://storage.example.com/bucket/skills/a.zip?X-Goog-Signature=secret-signature&X-Goog-Expires=300",
        sizeBytes: 0n,
        ttlSeconds: 300,
      }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    const failed = downloadArtifact(client, "skills/a.zip");
    await expect(failed).rejects.toThrow(new Error("artifact fetch failed: HTTP 403 from https://storage.example.com/bucket/skills/a.zip"));
    await expect(failed).rejects.not.toThrow("secret-signature");
  });

  it("names an unparseable minted URL without repeating it", async () => {
    const client = makeClient({
      getSkillArtifactDownloadUrl: vi.fn().mockResolvedValue({ url: "not a url?sig=secret", sizeBytes: 0n, ttlSeconds: 300 }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    await expect(downloadArtifact(client, "skills/a.zip")).rejects.toThrow("artifact fetch failed: HTTP 403 from the minted download URL");
  });
});

describe("isSkillContentPath", () => {
  it("names a mounted skill's files and a mounted plugin's skills, never other platform content", () => {
    expect(isSkillContentPath("/.stigmer/skills/alpha/SKILL.md")).toBe(true);
    expect(isSkillContentPath("/.stigmer/skills")).toBe(true);
    expect(isSkillContentPath("/.stigmer/plugins/abc123/skills/beta/references/x.md")).toBe(true);
    expect(isSkillContentPath("/.stigmer/inputs/../skills/alpha/SKILL.md"), "normalized first").toBe(true);
    expect(isSkillContentPath("/.stigmer/inputs/spec.pdf")).toBe(false);
    expect(isSkillContentPath("/.stigmer/skillsets/x")).toBe(false);
    expect(isSkillContentPath("/.stigmer/plugin-data/safety/state.json"), "a plugin's data is not its package").toBe(false);
    expect(isSkillContentPath("/skills/alpha/SKILL.md"), "the workspace's own skills folder").toBe(false);
  });

  it("names a mounted plugin's whole tree and cached archive, wherever its manifest put its skills", () => {
    expect(isSkillContentPath("/.stigmer/plugins/abc123/my-skills/solo/SKILL.md"), "a manifest-declared skill dir").toBe(true);
    expect(isSkillContentPath("/.stigmer/plugins/abc123/SKILL.md"), "a root skill is the whole tree").toBe(true);
    expect(isSkillContentPath("/.stigmer/plugins/abc123/hooks/run.sh")).toBe(true);
    expect(isSkillContentPath("/.stigmer/plugins/abc123.zip")).toBe(true);
    expect(isSkillContentPath(`/.stigmer/archives/${"a".repeat(64)}.zip`), "a cached archive of either kind").toBe(true);
  });

  it("matches without regard to case, as a case-insensitive filesystem resolves the path", () => {
    expect(isSkillContentPath("/.stigmer/Skills/alpha/SKILL.md")).toBe(true);
    expect(isSkillContentPath("/.STIGMER/skills/alpha/SKILL.md")).toBe(true);
    expect(isSkillContentPath("/.Stigmer/PLUGINS/abc123/skills/b/SKILL.md")).toBe(true);
    expect(isSkillContentPath("/.STIGMER/inputs/spec.pdf")).toBe(false);
  });
});
