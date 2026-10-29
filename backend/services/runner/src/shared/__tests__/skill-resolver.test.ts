import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveSkills } from "../skill-resolver.js";
import { mintedDownload } from "../../__test-utils__/minted-download.js";
import { buildZip } from "@stigmer/zip-structure/testing";

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeSkillProto(overrides: {
  name?: string;
  slug?: string;
  description?: string;
  skillMd?: string;
  artifactStorageKey?: string;
  versionHash?: string;
} = {}) {
  return {
    metadata: {
      id: `skill-${overrides.slug ?? "test"}`,
      slug: overrides.slug ?? "test-skill",
      org: "test-org",
    },
    spec: {
      name: overrides.name ?? overrides.slug ?? "test-skill",
      description: overrides.description ?? "A test skill",
      skillMd: overrides.skillMd ?? "# Test Skill",
    },
    status: {
      artifactStorageKey: overrides.artifactStorageKey ?? "",
      versionHash: overrides.versionHash ?? "abc",
    },
  } as any;
}

function makeRef(slug: string, org = "test-org") {
  return { slug, org, kind: 43 } as any;
}

// ─── resolveSkills with artifacts ────────────────────────────────────────

describe("resolveSkills — artifact extraction", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = makeTempDir("resolver-ws-");
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  /**
   * Resolve skills using a mock client. The getPlatformDir call uses the
   * real HOME-based path, but we override by mocking the module to point
   * at our temp directory instead.
   */
  async function resolveWithMockClient(
    refs: any[],
    clientOverrides: Record<string, any>,
  ) {
    const sessionId = `test-session-${Date.now()}`;

    // We need to clean up the platform dir after the test; capture it
    // via the getPlatformDir import so we know the actual path.
    const { getPlatformDir } = await import("../workspace/platform-dir.js");
    const platformDir = getPlatformDir(sessionId);

    const client = {
      getSkillByReference: vi.fn(),
      getSkillArtifactDownloadUrl: vi.fn().mockResolvedValue(mintedDownload(new Uint8Array(0))),
      ...clientOverrides,
    } as any;

    // Re-run resolution for the same session — the mount-cache tests model
    // one session's successive executions, which share the platform dir.
    const resolveAgain = () =>
      resolveSkills(client, refs, { sessionId, primaryWorkspaceDir: workspaceDir });

    try {
      const result = await resolveAgain();
      return { result, platformDir, client, resolveAgain };
    } catch (err) {
      // Clean up on failure
      rmSync(platformDir, { recursive: true, force: true });
      throw err;
    }
  }

  function cleanupPlatformDir(platformDir: string) {
    try {
      rmSync(platformDir, { recursive: true, force: true });
    } catch { /* best effort */ }
    // Also remove the symlink in workspace
    try {
      rmSync(join(workspaceDir, ".stigmer"), { force: true });
    } catch { /* best effort */ }
  }

  it("writes SKILL.md and extracts reference files from artifact", async () => {
    const skillMd = "# Garden Design Makeover\n\nSee [references/database-schema.md](references/database-schema.md)";
    const schemaContent = "# Database Schema\n\nTable definitions here.";

    const artifact = buildZip([
      { name: "SKILL.md", content: skillMd },
      { name: "references/", content: "" },
      { name: "references/database-schema.md", content: schemaContent },
    ]);

    const { result, platformDir } = await resolveWithMockClient(
      [makeRef("garden-design-makeover")],
      {
        getSkillByReference: vi.fn().mockResolvedValue(
          makeSkillProto({
            name: "garden-design-makeover",
            slug: "garden-design-makeover",
            skillMd,
            artifactStorageKey: "artifacts/garden.zip",
          }),
        ),
        getSkillArtifactDownloadUrl: vi.fn().mockResolvedValue(mintedDownload(artifact)),
      },
    );

    try {
      expect(result).toHaveLength(1);
      expect(result[0].metadata.name).toBe("garden-design-makeover");
      // Beside what the prompt renders, the skill by id at the version mounted.
      expect([result[0].loaded.org, result[0].loaded.kind, result[0].loaded.id, result[0].loaded.version]).toEqual([
        "test-org",
        43,
        "skill-garden-design-makeover",
        "abc",
      ]);

      const skillDir = join(platformDir, "skills", "garden-design-makeover");
      expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toBe(skillMd);
      expect(readFileSync(join(skillDir, "references", "database-schema.md"), "utf-8")).toBe(schemaContent);
    } finally {
      cleanupPlatformDir(platformDir);
    }
  });

  it("writes only SKILL.md when skill has no artifactStorageKey", async () => {
    const { result, platformDir, client } = await resolveWithMockClient(
      [makeRef("simple-skill")],
      {
        getSkillByReference: vi.fn().mockResolvedValue(
          makeSkillProto({
            name: "simple-skill",
            slug: "simple-skill",
            skillMd: "# Simple",
            artifactStorageKey: "",
          }),
        ),
      },
    );

    try {
      expect(result).toHaveLength(1);
      expect(client.getSkillArtifactDownloadUrl).not.toHaveBeenCalled();

      const skillDir = join(platformDir, "skills", "simple-skill");
      expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toBe("# Simple");
      expect(existsSync(join(skillDir, "references"))).toBe(false);
    } finally {
      cleanupPlatformDir(platformDir);
    }
  });

  it("falls back to SKILL.md only when artifact download fails", async () => {
    const { result, platformDir } = await resolveWithMockClient(
      [makeRef("flaky-skill")],
      {
        getSkillByReference: vi.fn().mockResolvedValue(
          makeSkillProto({
            name: "flaky-skill",
            slug: "flaky-skill",
            skillMd: "# Flaky",
            artifactStorageKey: "artifacts/flaky.zip",
          }),
        ),
        getSkillArtifactDownloadUrl: vi.fn().mockRejectedValue(new Error("Network timeout")),
      },
    );

    try {
      expect(result).toHaveLength(1);
      expect(result[0].metadata.name).toBe("flaky-skill");

      const skillDir = join(platformDir, "skills", "flaky-skill");
      expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toBe("# Flaky");
    } finally {
      cleanupPlatformDir(platformDir);
    }
  });

  it("re-resolving an unchanged version skips the artifact download (mount cache hit)", async () => {
    const artifact = buildZip([
      { name: "SKILL.md", content: "# Cached" },
      { name: "references/guide.md", content: "guide" },
    ]);
    const getSkillByReference = vi.fn().mockResolvedValue(
      makeSkillProto({
        name: "cached-skill",
        slug: "cached-skill",
        skillMd: "# Cached",
        artifactStorageKey: "artifacts/cached.zip",
        versionHash: "hash-v1",
      }),
    );
    const getSkillArtifactDownloadUrl = vi.fn().mockResolvedValue(mintedDownload(artifact));

    const { result, platformDir, client, resolveAgain } = await resolveWithMockClient(
      [makeRef("cached-skill")],
      { getSkillByReference, getSkillArtifactDownloadUrl },
    );

    try {
      expect(result).toHaveLength(1);
      expect(client.getSkillArtifactDownloadUrl).toHaveBeenCalledTimes(1);

      const second = await resolveAgain();
      expect(second).toHaveLength(1);
      expect(second[0].metadata.name).toBe("cached-skill");
      // Metadata was re-fetched (latest-version freshness)...
      expect(client.getSkillByReference).toHaveBeenCalledTimes(2);
      // ...but the artifact transfer and rewrite were skipped.
      expect(client.getSkillArtifactDownloadUrl).toHaveBeenCalledTimes(1);

      const skillDir = join(platformDir, "skills", "cached-skill");
      expect(readFileSync(join(skillDir, "references", "guide.md"), "utf-8")).toBe("guide");
    } finally {
      cleanupPlatformDir(platformDir);
    }
  });

  it("re-downloads on version change and clears stale files from the old mount", async () => {
    const v1 = makeSkillProto({
      name: "evolving-skill",
      slug: "evolving-skill",
      skillMd: "# V1",
      artifactStorageKey: "artifacts/v1.zip",
      versionHash: "hash-v1",
    });
    const v2 = makeSkillProto({
      name: "evolving-skill",
      slug: "evolving-skill",
      skillMd: "# V2",
      artifactStorageKey: "artifacts/v2.zip",
      versionHash: "hash-v2",
    });
    const artifactV1 = buildZip([{ name: "references/removed-in-v2.md", content: "old" }]);
    const artifactV2 = buildZip([{ name: "references/new-in-v2.md", content: "new" }]);

    const getSkillByReference = vi.fn().mockResolvedValueOnce(v1).mockResolvedValueOnce(v2);
    const getSkillArtifactDownloadUrl = vi
      .fn()
      .mockResolvedValueOnce(mintedDownload(artifactV1))
      .mockResolvedValueOnce(mintedDownload(artifactV2));

    const { platformDir, client, resolveAgain } = await resolveWithMockClient(
      [makeRef("evolving-skill")],
      { getSkillByReference, getSkillArtifactDownloadUrl },
    );

    try {
      const skillDir = join(platformDir, "skills", "evolving-skill");
      expect(readFileSync(join(skillDir, "references", "removed-in-v2.md"), "utf-8")).toBe("old");

      await resolveAgain();
      expect(client.getSkillArtifactDownloadUrl).toHaveBeenCalledTimes(2);
      expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toBe("# V2");
      expect(readFileSync(join(skillDir, "references", "new-in-v2.md"), "utf-8")).toBe("new");
      // The v1-only file must not linger in the v2 mount (the stale-file leak).
      expect(existsSync(join(skillDir, "references", "removed-in-v2.md"))).toBe(false);
    } finally {
      cleanupPlatformDir(platformDir);
    }
  });

  it("does not cache a SKILL.md-only fallback — the next execution retries the download", async () => {
    const proto = makeSkillProto({
      name: "retry-skill",
      slug: "retry-skill",
      skillMd: "# Retry",
      artifactStorageKey: "artifacts/retry.zip",
      versionHash: "hash-v1",
    });
    const artifact = buildZip([{ name: "references/late.md", content: "finally" }]);
    const getSkillByReference = vi.fn().mockResolvedValue(proto);
    const getSkillArtifactDownloadUrl = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValueOnce(mintedDownload(artifact));

    const { result, platformDir, client, resolveAgain } = await resolveWithMockClient(
      [makeRef("retry-skill")],
      { getSkillByReference, getSkillArtifactDownloadUrl },
    );

    try {
      // First pass degraded to SKILL.md only.
      expect(result).toHaveLength(1);
      const skillDir = join(platformDir, "skills", "retry-skill");
      expect(existsSync(join(skillDir, "references"))).toBe(false);

      // Second pass retries and completes the mount.
      await resolveAgain();
      expect(client.getSkillArtifactDownloadUrl).toHaveBeenCalledTimes(2);
      expect(readFileSync(join(skillDir, "references", "late.md"), "utf-8")).toBe("finally");

      // Third pass is a cache hit.
      await resolveAgain();
      expect(client.getSkillArtifactDownloadUrl).toHaveBeenCalledTimes(2);
    } finally {
      cleanupPlatformDir(platformDir);
    }
  });

  it("treats a corrupted mount marker as stale and remounts", async () => {
    const artifact = buildZip([{ name: "references/guide.md", content: "guide" }]);
    const getSkillByReference = vi.fn().mockResolvedValue(
      makeSkillProto({
        name: "tampered-skill",
        slug: "tampered-skill",
        skillMd: "# Tampered",
        artifactStorageKey: "artifacts/tampered.zip",
        versionHash: "hash-v1",
      }),
    );
    const getSkillArtifactDownloadUrl = vi.fn().mockResolvedValue(mintedDownload(artifact));

    const { platformDir, client, resolveAgain } = await resolveWithMockClient(
      [makeRef("tampered-skill")],
      { getSkillByReference, getSkillArtifactDownloadUrl },
    );

    try {
      const skillDir = join(platformDir, "skills", "tampered-skill");
      writeFileSync(join(skillDir, ".stigmer-mount.json"), "not json {");

      await resolveAgain();
      expect(client.getSkillArtifactDownloadUrl).toHaveBeenCalledTimes(2);
      expect(readFileSync(join(skillDir, "references", "guide.md"), "utf-8")).toBe("guide");
    } finally {
      cleanupPlatformDir(platformDir);
    }
  });

  it("SKILL.md from spec takes precedence over ZIP copy", async () => {
    const specContent = "# Authoritative SKILL.md from spec";
    const zipContent = "# Stale SKILL.md from ZIP";

    const artifact = buildZip([
      { name: "SKILL.md", content: zipContent },
      { name: "references/data.md", content: "data" },
    ]);

    const { result, platformDir } = await resolveWithMockClient(
      [makeRef("precedence-test")],
      {
        getSkillByReference: vi.fn().mockResolvedValue(
          makeSkillProto({
            name: "precedence-test",
            slug: "precedence-test",
            skillMd: specContent,
            artifactStorageKey: "artifacts/test.zip",
          }),
        ),
        getSkillArtifactDownloadUrl: vi.fn().mockResolvedValue(mintedDownload(artifact)),
      },
    );

    try {
      expect(result).toHaveLength(1);

      const skillDir = join(platformDir, "skills", "precedence-test");
      expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toBe(specContent);
      expect(readFileSync(join(skillDir, "references", "data.md"), "utf-8")).toBe("data");
    } finally {
      cleanupPlatformDir(platformDir);
    }
  });
});

// downloadArtifact's transfer-lane routing tests moved with the code to
// shared/__tests__/skill-mount.test.ts (issue #337 extraction).
