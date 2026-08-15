import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConnectError, Code } from "@connectrpc/connect";
import {
  mergeSkillRefs,
  fetchSkillsByRefs,
  mountSkills,
  generatePromptSection,
  generateAlsoAvailableSection,
} from "../skill-writer.js";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { buildZip } from "../../__test-utils__/zip-fixtures.js";

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeSkill(overrides: {
  id?: string;
  name?: string;
  slug?: string;
  org?: string;
  description?: string;
  skillMd?: string;
  artifactStorageKey?: string;
  versionHash?: string;
} = {}): Skill {
  return {
    metadata: {
      id: overrides.id ?? "skill-id-1",
      name: overrides.name ?? overrides.slug ?? "test-skill",
      slug: overrides.slug ?? "test-skill",
      org: overrides.org ?? "test-org",
    },
    spec: {
      name: overrides.name ?? "test-skill",
      description: overrides.description ?? "A test skill",
      skillMd: overrides.skillMd ?? "# Test Skill\n\nDoes testing.",
      tag: "",
    },
    status: {
      artifactStorageKey: overrides.artifactStorageKey ?? "",
      versionHash: overrides.versionHash ?? "abc123",
      state: "active",
    },
  } as any;
}

function makeRef(slug: string, org = "test-org"): ApiResourceReference {
  return { slug, org, kind: 43 } as any;
}

/** A server that predates the transfer lane (#675) answers the mint RPC
 * with UNIMPLEMENTED, pinning these tests to the unary fallback. */
function makeMockClient(overrides: Record<string, unknown> = {}) {
  return {
    getSkillByReference: vi.fn().mockImplementation((ref: any) =>
      Promise.resolve(makeSkill({ slug: ref.slug, name: ref.slug })),
    ),
    getSkillArtifact: vi.fn().mockResolvedValue({ artifact: new Uint8Array(0) }),
    getSkillArtifactDownloadUrl: vi.fn().mockRejectedValue(
      new ConnectError("unimplemented", Code.Unimplemented),
    ),
    ...overrides,
  } as any;
}

// ─── mergeSkillRefs ──────────────────────────────────────────────────────

describe("mergeSkillRefs", () => {
  it("returns empty for no refs", () => {
    expect(mergeSkillRefs([], [])).toEqual([]);
  });

  it("returns agent refs when no session refs", () => {
    const refs = [makeRef("skill-a"), makeRef("skill-b")];
    const result = mergeSkillRefs(refs, []);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.slug)).toEqual(["skill-a", "skill-b"]);
  });

  it("deduplicates by slug with session winning", () => {
    const agentRefs = [makeRef("skill-a", "org1")];
    const sessionRefs = [makeRef("skill-a", "org2")];
    const result = mergeSkillRefs(agentRefs, sessionRefs);
    expect(result).toHaveLength(1);
    expect(result[0].org).toBe("org2");
  });

  it("unions unique skills from both sources", () => {
    const agentRefs = [makeRef("skill-a")];
    const sessionRefs = [makeRef("skill-b")];
    const result = mergeSkillRefs(agentRefs, sessionRefs);
    expect(result).toHaveLength(2);
  });
});

// ─── fetchSkillsByRefs ───────────────────────────────────────────────────

describe("fetchSkillsByRefs", () => {
  it("returns empty for no refs", async () => {
    const client = makeMockClient();
    const result = await fetchSkillsByRefs(client, []);
    expect(result).toEqual([]);
    expect(client.getSkillByReference).not.toHaveBeenCalled();
  });

  it("fetches all skills by reference", async () => {
    const client = makeMockClient();
    const refs = [makeRef("skill-a"), makeRef("skill-b")];
    const result = await fetchSkillsByRefs(client, refs);
    expect(result).toHaveLength(2);
    expect(client.getSkillByReference).toHaveBeenCalledTimes(2);
  });

  it("skips failed fetches gracefully", async () => {
    const client = makeMockClient({
      getSkillByReference: vi.fn()
        .mockResolvedValueOnce(makeSkill({ name: "good", slug: "good" }))
        .mockRejectedValueOnce(new Error("Not found")),
    });
    const refs = [makeRef("good"), makeRef("bad")];
    const result = await fetchSkillsByRefs(client, refs);
    expect(result).toHaveLength(1);
    expect(result[0].spec!.name).toBe("good");
  });
});

// ─── mountSkills ─────────────────────────────────────────────────────────

describe("mountSkills", () => {
  let platformDir: string;

  beforeEach(() => {
    platformDir = mkdtempSync(join(tmpdir(), "skill-writer-platform-"));
  });

  afterEach(() => {
    rmSync(platformDir, { recursive: true, force: true });
  });

  it("writes SKILL.md and returns agent-visible paths keyed by skill id", async () => {
    const client = makeMockClient();
    const skills = [makeSkill({ name: "calculator", skillMd: "# Calculator\n\nAdds numbers." })];
    const result = await mountSkills(client, skills, platformDir);

    expect(result.paths.get("skill-id-1")).toBe(".stigmer/skills/calculator");
    expect(readFileSync(join(platformDir, "skills", "calculator", "SKILL.md"), "utf-8"))
      .toBe("# Calculator\n\nAdds numbers.");
  });

  it("extracts artifact files alongside SKILL.md", async () => {
    const artifact = buildZip([
      { name: "SKILL.md", content: "# Stale zip copy" },
      { name: "references/schema.md", content: "schema" },
    ]);
    const client = makeMockClient({
      getSkillArtifact: vi.fn().mockResolvedValue({ artifact }),
    });
    const skills = [makeSkill({
      name: "db-skill",
      skillMd: "# Authoritative",
      artifactStorageKey: "artifacts/db.zip",
    })];
    await mountSkills(client, skills, platformDir);

    const skillDir = join(platformDir, "skills", "db-skill");
    expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toBe("# Authoritative");
    expect(readFileSync(join(skillDir, "references", "schema.md"), "utf-8")).toBe("schema");
  });

  it("handles multiple skills", async () => {
    const client = makeMockClient();
    const skills = [
      makeSkill({ id: "id-1", name: "skill-a", skillMd: "# A" }),
      makeSkill({ id: "id-2", name: "skill-b", skillMd: "# B" }),
    ];
    const result = await mountSkills(client, skills, platformDir);
    expect(result.paths.size).toBe(2);
    expect(result.paths.get("id-1")).toBe(".stigmer/skills/skill-a");
    expect(result.paths.get("id-2")).toBe(".stigmer/skills/skill-b");
    expect(existsSync(join(platformDir, "skills", "skill-a", "SKILL.md"))).toBe(true);
    expect(existsSync(join(platformDir, "skills", "skill-b", "SKILL.md"))).toBe(true);
  });

  it("skips the artifact download when the mounted hash matches (cache hit)", async () => {
    const artifact = buildZip([{ name: "references/guide.md", content: "guide" }]);
    const client = makeMockClient({
      getSkillArtifact: vi.fn().mockResolvedValue({ artifact }),
    });
    const skill = makeSkill({
      name: "cached-skill",
      artifactStorageKey: "artifacts/cached.zip",
      versionHash: "hash-v1",
    });

    await mountSkills(client, [skill], platformDir);
    expect(client.getSkillArtifact).toHaveBeenCalledTimes(1);

    // Second execution of the same session: same hash, no transfer.
    const second = await mountSkills(client, [skill], platformDir);
    expect(client.getSkillArtifact).toHaveBeenCalledTimes(1);
    expect(second.paths.get("skill-id-1")).toBe(".stigmer/skills/cached-skill");
    expect(readFileSync(
      join(platformDir, "skills", "cached-skill", "references", "guide.md"), "utf-8",
    )).toBe("guide");
  });

  it("remounts on version change and clears stale files from the old mount", async () => {
    const artifactV1 = buildZip([{ name: "references/removed-in-v2.md", content: "old" }]);
    const artifactV2 = buildZip([{ name: "references/new-in-v2.md", content: "new" }]);
    const client = makeMockClient({
      getSkillArtifact: vi.fn()
        .mockResolvedValueOnce({ artifact: artifactV1 })
        .mockResolvedValueOnce({ artifact: artifactV2 }),
    });

    await mountSkills(client, [makeSkill({
      name: "evolving-skill",
      skillMd: "# V1",
      artifactStorageKey: "artifacts/v1.zip",
      versionHash: "hash-v1",
    })], platformDir);

    await mountSkills(client, [makeSkill({
      name: "evolving-skill",
      skillMd: "# V2",
      artifactStorageKey: "artifacts/v2.zip",
      versionHash: "hash-v2",
    })], platformDir);

    const skillDir = join(platformDir, "skills", "evolving-skill");
    expect(client.getSkillArtifact).toHaveBeenCalledTimes(2);
    expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toBe("# V2");
    expect(readFileSync(join(skillDir, "references", "new-in-v2.md"), "utf-8")).toBe("new");
    // The v1-only file must not linger in the v2 mount (the stale-file leak).
    expect(existsSync(join(skillDir, "references", "removed-in-v2.md"))).toBe(false);
  });

  it("does not cache a degraded SKILL.md-only mount — the next execution retries", async () => {
    const artifact = buildZip([{ name: "references/late.md", content: "finally" }]);
    const client = makeMockClient({
      getSkillArtifact: vi.fn()
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockResolvedValueOnce({ artifact }),
    });
    const skill = makeSkill({
      name: "retry-skill",
      artifactStorageKey: "artifacts/retry.zip",
      versionHash: "hash-v1",
    });

    // First pass degrades to SKILL.md only — never throws.
    const first = await mountSkills(client, [skill], platformDir);
    const skillDir = join(platformDir, "skills", "retry-skill");
    expect(first.paths.get("skill-id-1")).toBe(".stigmer/skills/retry-skill");
    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillDir, "references"))).toBe(false);

    // Second pass retries and completes the mount.
    await mountSkills(client, [skill], platformDir);
    expect(client.getSkillArtifact).toHaveBeenCalledTimes(2);
    expect(readFileSync(join(skillDir, "references", "late.md"), "utf-8")).toBe("finally");

    // Third pass is a cache hit.
    await mountSkills(client, [skill], platformDir);
    expect(client.getSkillArtifact).toHaveBeenCalledTimes(2);
  });

  it("mounts only the first claimant when two skills resolve to the same directory", async () => {
    const client = makeMockClient();
    const skills = [
      makeSkill({ id: "id-1", org: "org-a", slug: "shared-a", name: "shared-name", skillMd: "# First" }),
      makeSkill({ id: "id-2", org: "org-b", slug: "shared-b", name: "shared-name", skillMd: "# Second" }),
    ];
    const result = await mountSkills(client, skills, platformDir);

    // Both ids resolve to the (single) directory; the first claimant's content wins.
    expect(result.paths.get("id-1")).toBe(".stigmer/skills/shared-name");
    expect(result.paths.get("id-2")).toBe(".stigmer/skills/shared-name");
    expect(readFileSync(join(platformDir, "skills", "shared-name", "SKILL.md"), "utf-8"))
      .toBe("# First");
  });

  it("skips skills with no skillMd content", async () => {
    const client = makeMockClient();
    const skill = makeSkill({ name: "broken", skillMd: "" });
    (skill as any).spec.skillMd = "";
    const result = await mountSkills(client, [skill], platformDir);

    // The path entry exists (naming is total) but nothing was mounted.
    expect(result.paths.get("skill-id-1")).toBe(".stigmer/skills/broken");
    expect(existsSync(join(platformDir, "skills", "broken"))).toBe(false);
  });
});

// ─── generatePromptSection ───────────────────────────────────────────────

describe("generatePromptSection", () => {
  it("returns empty string for no skills", () => {
    expect(generatePromptSection([], new Map())).toBe("");
  });

  it("generates progressive disclosure format", () => {
    const skills = [makeSkill({ name: "calculator", description: "Arithmetic operations" })];
    const paths = new Map([["skill-id-1", ".stigmer/skills/calculator"]]);
    const section = generatePromptSection(skills, paths);

    expect(section).toContain("## Skills");
    expect(section).toContain("### calculator");
    expect(section).toContain("**Description**: Arithmetic operations");
    expect(section).toContain("**Location**: `.stigmer/skills/calculator/`");
    expect(section).toContain("**Activate**: `read .stigmer/skills/calculator/SKILL.md`");
  });

  it("includes activation protocol instructions", () => {
    const skills = [makeSkill()];
    const paths = new Map([["skill-id-1", ".stigmer/skills/test-skill"]]);
    const section = generatePromptSection(skills, paths);

    expect(section).toContain("Activation protocol");
    expect(section).toContain("read its SKILL.md");
  });

  it("handles multiple skills", () => {
    const skills = [
      makeSkill({ id: "id-1", name: "skill-a", description: "Desc A" }),
      makeSkill({ id: "id-2", name: "skill-b", description: "Desc B" }),
    ];
    const paths = new Map([
      ["id-1", ".stigmer/skills/skill-a"],
      ["id-2", ".stigmer/skills/skill-b"],
    ]);
    const section = generatePromptSection(skills, paths);

    expect(section).toContain("### skill-a");
    expect(section).toContain("### skill-b");
    expect(section).toContain("Desc A");
    expect(section).toContain("Desc B");
  });

  it("falls back to (no description) when empty", () => {
    const skills = [makeSkill({ description: "" })];
    (skills[0] as any).spec.description = "";
    const paths = new Map([["skill-id-1", ".stigmer/skills/test-skill"]]);
    const section = generatePromptSection(skills, paths);
    expect(section).toContain("(no description)");
  });
});

// ─── generateAlsoAvailableSection ────────────────────────────────────────

describe("generateAlsoAvailableSection", () => {
  it("returns empty for no excluded names", () => {
    expect(generateAlsoAvailableSection([])).toBe("");
  });

  it("lists excluded skills with backtick formatting", () => {
    const section = generateAlsoAvailableSection(["alpha", "beta", "gamma"]);
    expect(section).toContain("### Also Available");
    expect(section).toContain("`alpha`");
    expect(section).toContain("`beta`");
    expect(section).toContain("`gamma`");
  });

  it("includes activation instructions", () => {
    const section = generateAlsoAvailableSection(["some-skill"]);
    expect(section).toContain(".stigmer/skills/<name>/SKILL.md");
    expect(section).toContain("relevant to your task");
  });
});
