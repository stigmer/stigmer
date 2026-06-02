import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveSkills } from "../skill-resolver.js";

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Build a minimal stored (method 0) ZIP archive for testing.
 */
function buildStoredZip(files: { name: string; content: string }[]): Uint8Array {
  const parts: Uint8Array[] = [];

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const contentBytes = new TextEncoder().encode(file.content);
    const isDir = file.name.endsWith("/");

    const header = new ArrayBuffer(30);
    const view = new DataView(header);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, 0, true);
    view.setUint32(18, isDir ? 0 : contentBytes.length, true);
    view.setUint32(22, isDir ? 0 : contentBytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);

    parts.push(new Uint8Array(header));
    parts.push(nameBytes);
    if (!isDir) parts.push(contentBytes);
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function makeSkillProto(overrides: {
  name?: string;
  slug?: string;
  description?: string;
  skillMd?: string;
  artifactStorageKey?: string;
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
      versionHash: "abc",
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
    const { getPlatformDir } = await import("../../../shared/workspace/platform-dir.js");
    const platformDir = getPlatformDir(sessionId);

    const client = {
      getSkillByReference: vi.fn(),
      getSkillArtifact: vi.fn().mockResolvedValue({ artifact: new Uint8Array(0) }),
      ...clientOverrides,
    } as any;

    try {
      const result = await resolveSkills(client, refs, {
        sessionId,
        primaryWorkspaceDir: workspaceDir,
      });
      return { result, platformDir, client };
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

    const artifact = buildStoredZip([
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
        getSkillArtifact: vi.fn().mockResolvedValue({ artifact }),
      },
    );

    try {
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("garden-design-makeover");

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
      expect(client.getSkillArtifact).not.toHaveBeenCalled();

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
        getSkillArtifact: vi.fn().mockRejectedValue(new Error("Network timeout")),
      },
    );

    try {
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("flaky-skill");

      const skillDir = join(platformDir, "skills", "flaky-skill");
      expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toBe("# Flaky");
    } finally {
      cleanupPlatformDir(platformDir);
    }
  });

  it("SKILL.md from spec takes precedence over ZIP copy", async () => {
    const specContent = "# Authoritative SKILL.md from spec";
    const zipContent = "# Stale SKILL.md from ZIP";

    const artifact = buildStoredZip([
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
        getSkillArtifact: vi.fn().mockResolvedValue({ artifact }),
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
