import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConnectError, Code } from "@connectrpc/connect";
import {
  MOUNT_MARKER_FILE,
  isSkillContentPath,
  mountIsFresh,
  downloadArtifact,
  writeSkillMount,
} from "../skill-mount.js";
import { buildZip } from "@stigmer/zip-structure/testing";

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeSkillProto(overrides: {
  name?: string;
  skillMd?: string;
  artifactStorageKey?: string;
  versionHash?: string;
} = {}) {
  return {
    metadata: {
      id: `skill-${overrides.name ?? "test"}`,
      slug: overrides.name ?? "test-skill",
      org: "test-org",
    },
    spec: {
      name: overrides.name ?? "test-skill",
      description: "A test skill",
      skillMd: overrides.skillMd ?? "# Test Skill",
    },
    status: {
      artifactStorageKey: overrides.artifactStorageKey ?? "",
      versionHash: overrides.versionHash ?? "abc",
    },
  } as any;
}

// ─── writeSkillMount + mountIsFresh — marker mechanics ───────────────────

describe("writeSkillMount — marker mechanics", () => {
  let skillDir: string;

  beforeEach(() => {
    skillDir = join(mkdtempSync(join(tmpdir(), "skill-mount-")), "test-skill");
  });

  afterEach(() => {
    rmSync(join(skillDir, ".."), { recursive: true, force: true });
  });

  it("stamps a marker recording the hash and a fully mounted artifact", async () => {
    const artifact = buildZip([{ name: "references/guide.md", content: "guide" }]);
    await writeSkillMount(makeSkillProto({ versionHash: "hash-v1" }), skillDir, artifact);

    const marker = JSON.parse(readFileSync(join(skillDir, MOUNT_MARKER_FILE), "utf-8"));
    expect(marker).toEqual({ versionHash: "hash-v1", artifactMounted: true });
    expect(await mountIsFresh(skillDir, "hash-v1", true)).toBe(true);
  });

  it("records a degraded SKILL.md-only mount so the next execution retries the artifact", async () => {
    await writeSkillMount(makeSkillProto({ versionHash: "hash-v1" }), skillDir, undefined);

    const marker = JSON.parse(readFileSync(join(skillDir, MOUNT_MARKER_FILE), "utf-8"));
    expect(marker).toEqual({ versionHash: "hash-v1", artifactMounted: false });
    // Stale for a skill that carries an artifact (retry the download)...
    expect(await mountIsFresh(skillDir, "hash-v1", true)).toBe(false);
    // ...fresh for a skill that never had one.
    expect(await mountIsFresh(skillDir, "hash-v1", false)).toBe(true);
  });

  it("stamps no marker when the skill has no version hash — such mounts never cache", async () => {
    await writeSkillMount(makeSkillProto({ versionHash: "" }), skillDir, undefined);

    expect(existsSync(join(skillDir, MOUNT_MARKER_FILE))).toBe(false);
    expect(await mountIsFresh(skillDir, "", false)).toBe(false);
  });

  it("is stale for a different hash", async () => {
    await writeSkillMount(makeSkillProto({ versionHash: "hash-v1" }), skillDir, undefined);
    expect(await mountIsFresh(skillDir, "hash-v2", false)).toBe(false);
  });

  it("is stale when the marker is missing or unparseable", async () => {
    expect(await mountIsFresh(skillDir, "hash-v1", false)).toBe(false);
  });

  it("removes files from a previous mount that the new version no longer carries", async () => {
    const v1 = buildZip([{ name: "references/removed-in-v2.md", content: "old" }]);
    const v2 = buildZip([{ name: "references/new-in-v2.md", content: "new" }]);

    await writeSkillMount(makeSkillProto({ versionHash: "hash-v1" }), skillDir, v1);
    await writeSkillMount(makeSkillProto({ versionHash: "hash-v2" }), skillDir, v2);

    expect(existsSync(join(skillDir, "references", "removed-in-v2.md"))).toBe(false);
    expect(readFileSync(join(skillDir, "references", "new-in-v2.md"), "utf-8")).toBe("new");
  });

  it("owns SKILL.md and the marker name unconditionally — zip copies are ignored", async () => {
    const artifact = buildZip([
      { name: "SKILL.md", content: "# Stale zip copy" },
      { name: MOUNT_MARKER_FILE, content: "{\"versionHash\":\"forged\"}" },
    ]);
    await writeSkillMount(
      makeSkillProto({ skillMd: "# Authoritative", versionHash: "hash-v1" }),
      skillDir,
      artifact,
    );

    expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toBe("# Authoritative");
    const marker = JSON.parse(readFileSync(join(skillDir, MOUNT_MARKER_FILE), "utf-8"));
    expect(marker.versionHash).toBe("hash-v1");
  });

  it("rejects zip entries that escape the mount directory", async () => {
    const artifact = buildZip([{ name: "../escape.txt", content: "evil" }]);

    await expect(
      writeSkillMount(makeSkillProto({ versionHash: "hash-v1" }), skillDir, artifact),
    ).rejects.toThrow(/escapes its mount directory/);
    expect(existsSync(join(skillDir, "..", "escape.txt"))).toBe(false);
    // The interrupted mount must not have been stamped as complete.
    expect(existsSync(join(skillDir, MOUNT_MARKER_FILE))).toBe(false);
  });

  it("writes script entries with the executable bit set", async () => {
    const artifact = buildZip([
      { name: "scripts/run.py", content: "print('hi')" },
      { name: "references/notes.md", content: "notes" },
    ]);
    await writeSkillMount(makeSkillProto({ versionHash: "hash-v1" }), skillDir, artifact);

    expect(statSync(join(skillDir, "scripts", "run.py")).mode & 0o111).not.toBe(0);
    expect(statSync(join(skillDir, "references", "notes.md")).mode & 0o111).toBe(0);
  });

  it("makes an extensionless script executable by its #! line", async () => {
    const artifact = buildZip([
      { name: "scripts/check", content: "#!/usr/bin/env bash\necho ok\n" },
      { name: "scripts/README", content: "plain text" },
    ]);
    await writeSkillMount(makeSkillProto({ versionHash: "hash-v1" }), skillDir, artifact);

    expect(statSync(join(skillDir, "scripts", "check")).mode & 0o111).not.toBe(0);
    expect(statSync(join(skillDir, "scripts", "README")).mode & 0o111).toBe(0);
  });

  it("never mounts an eval suite a root skill's archive still carries, by its cleaned name", async () => {
    // A root skill's archive is the whole plugin; one stored before the
    // suite was stripped at push still holds `evals/`, which a try must not read.
    const artifact = buildZip([
      { name: "references/guide.md", content: "guide" },
      { name: "evals/evals.json", content: "{}" },
      { name: "./evals/basic/case.yaml", content: "prompt: hi" },
      { name: "x/../evals/graders/g.yaml", content: "type: llm" },
      { name: "evalsx/kept.md", content: "not the suite" },
    ]);
    await writeSkillMount(makeSkillProto({ versionHash: "hash-v1" }), skillDir, artifact);

    expect(existsSync(join(skillDir, "evals"))).toBe(false);
    expect(readFileSync(join(skillDir, "references", "guide.md"), "utf-8")).toBe("guide");
    expect(readFileSync(join(skillDir, "evalsx", "kept.md"), "utf-8")).toBe("not the suite");
  });
});

// ─── downloadArtifact — transfer lane routing (#675) ─────────────────────

/** A server that predates the transfer lane (#675) answers the mint RPC
 * with UNIMPLEMENTED — the default posture for these tests, which keeps
 * every pre-existing case pinned to the unary getSkillArtifact fallback. */
function unimplementedMint() {
  return vi.fn().mockRejectedValue(new ConnectError("unimplemented", Code.Unimplemented));
}

describe("downloadArtifact — transfer lane routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeClient(overrides: Record<string, any> = {}) {
    return {
      getSkillArtifact: vi.fn().mockResolvedValue({ artifact: new Uint8Array(0) }),
      getSkillArtifactDownloadUrl: unimplementedMint(),
      ...overrides,
    } as any;
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
    // The unary lane (10MB-capped) must not be touched when the URL lane works.
    expect(client.getSkillArtifact).not.toHaveBeenCalled();
  });

  it("falls back to the unary RPC when the server predates the lane", async () => {
    const bytes = new Uint8Array([9, 9]);
    const client = makeClient({
      getSkillArtifact: vi.fn().mockResolvedValue({ artifact: bytes }),
    });
    vi.stubGlobal("fetch", vi.fn()); // must never be called

    const got = await downloadArtifact(client, "skills/abc.zip");

    expect(got).toEqual(bytes);
    expect(client.getSkillArtifact).toHaveBeenCalledWith("skills/abc.zip");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does NOT fall back on non-Unimplemented mint failures", async () => {
    const client = makeClient({
      getSkillArtifactDownloadUrl: vi.fn().mockRejectedValue(
        new ConnectError("boom", Code.Internal),
      ),
    });

    await expect(downloadArtifact(client, "skills/abc.zip")).rejects.toThrow("boom");
    // Falling back here would mask real server faults behind the capped lane.
    expect(client.getSkillArtifact).not.toHaveBeenCalled();
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
  });

  it("matches without regard to case, as a case-insensitive filesystem resolves the path", () => {
    expect(isSkillContentPath("/.stigmer/Skills/alpha/SKILL.md")).toBe(true);
    expect(isSkillContentPath("/.STIGMER/skills/alpha/SKILL.md")).toBe(true);
    expect(isSkillContentPath("/.Stigmer/PLUGINS/abc123/skills/b/SKILL.md")).toBe(true);
    expect(isSkillContentPath("/.STIGMER/inputs/spec.pdf")).toBe(false);
  });
});
