import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mergeSkillRefs,
  fetchSkillsByRefs,
  writeSkills,
  computeSkillPaths,
  checkSkillIntegrity,
  generatePromptSection,
  generateAlsoAvailableSection,
  fetchSkillArtifacts,
} from "../skill-writer.js";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { WorkspaceBackend } from "../workspace/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeSkill(overrides: {
  id?: string;
  name?: string;
  slug?: string;
  description?: string;
  skillMd?: string;
  artifactStorageKey?: string;
} = {}): Skill {
  return {
    metadata: {
      id: overrides.id ?? "skill-id-1",
      name: overrides.name ?? overrides.slug ?? "test-skill",
      slug: overrides.slug ?? "test-skill",
      org: "test-org",
    },
    spec: {
      name: overrides.name ?? "test-skill",
      description: overrides.description ?? "A test skill",
      skillMd: overrides.skillMd ?? "# Test Skill\n\nDoes testing.",
      tag: "",
    },
    status: {
      artifactStorageKey: overrides.artifactStorageKey ?? "",
      versionHash: "abc123",
      state: "active",
    },
  } as any;
}

function makeRef(slug: string, org = "test-org"): ApiResourceReference {
  return { slug, org, kind: 43 } as any;
}

function makeMockClient(overrides: Record<string, unknown> = {}) {
  return {
    getSkillByReference: vi.fn().mockImplementation((ref: any) =>
      Promise.resolve(makeSkill({ slug: ref.slug, name: ref.slug })),
    ),
    getSkillArtifact: vi.fn().mockResolvedValue({ artifact: new Uint8Array(0) }),
    ...overrides,
  } as any;
}

function makeMockBackend(): WorkspaceBackend & {
  writtenFiles: Map<string, string>;
  executedCommands: string[];
  existingFiles: Set<string>;
} {
  const writtenFiles = new Map<string, string>();
  const executedCommands: string[] = [];
  const existingFiles = new Set<string>();
  return {
    rootDir: "/workspace",
    writtenFiles,
    executedCommands,
    existingFiles,
    async writeFile(path: string, content: string) {
      writtenFiles.set(path, content);
    },
    async writeFileBuffer(path: string, content: Buffer) {
      writtenFiles.set(path, content.toString("utf-8"));
    },
    async readFile(path: string) {
      return writtenFiles.get(path) ?? "";
    },
    async exists(path: string) {
      return writtenFiles.has(path) || existingFiles.has(path);
    },
    async execute(command: string) {
      executedCommands.push(command);
      return "";
    },
  };
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

// ─── writeSkills ─────────────────────────────────────────────────────────

describe("writeSkills", () => {
  it("writes SKILL.md from spec when no artifact", async () => {
    const backend = makeMockBackend();
    const skills = [makeSkill({ name: "calculator", skillMd: "# Calculator\n\nAdds numbers." })];
    const result = await writeSkills(skills, backend, new Map());

    expect(result.paths.get("skill-id-1")).toBe(".stigmer/skills/calculator");
    expect(backend.writtenFiles.has(".stigmer/skills/calculator/SKILL.md")).toBe(true);
    expect(backend.writtenFiles.get(".stigmer/skills/calculator/SKILL.md"))
      .toBe("# Calculator\n\nAdds numbers.");
  });

  it("runs chmod on script extensions", async () => {
    const backend = makeMockBackend();
    const skills = [makeSkill({ name: "runner" })];
    await writeSkills(skills, backend, new Map());
    expect(backend.executedCommands.length).toBeGreaterThan(0);
    expect(backend.executedCommands[0]).toContain("chmod");
  });

  it("handles multiple skills", async () => {
    const backend = makeMockBackend();
    const skills = [
      makeSkill({ id: "id-1", name: "skill-a", skillMd: "# A" }),
      makeSkill({ id: "id-2", name: "skill-b", skillMd: "# B" }),
    ];
    const result = await writeSkills(skills, backend, new Map());
    expect(result.paths.size).toBe(2);
    expect(result.paths.get("id-1")).toBe(".stigmer/skills/skill-a");
    expect(result.paths.get("id-2")).toBe(".stigmer/skills/skill-b");
  });

  it("skips write when skill has no skillMd and no artifact", async () => {
    const backend = makeMockBackend();
    const skills = [makeSkill({ skillMd: "" })];
    (skills[0] as any).spec.skillMd = "";
    await writeSkills(skills, backend, new Map());
    expect(backend.writtenFiles.size).toBe(0);
  });
});

// ─── computeSkillPaths ───────────────────────────────────────────────────

describe("computeSkillPaths", () => {
  it("computes paths without side effects", () => {
    const skills = [
      makeSkill({ id: "id-1", name: "calculator" }),
      makeSkill({ id: "id-2", name: "web-scraper" }),
    ];
    const paths = computeSkillPaths(skills);
    expect(paths.get("id-1")).toBe(".stigmer/skills/calculator");
    expect(paths.get("id-2")).toBe(".stigmer/skills/web-scraper");
  });

  it("returns empty map for empty skills", () => {
    expect(computeSkillPaths([])).toEqual(new Map());
  });
});

// ─── checkSkillIntegrity ─────────────────────────────────────────────────

describe("checkSkillIntegrity", () => {
  it("returns true when sentinel exists", async () => {
    const backend = makeMockBackend();
    backend.existingFiles.add(".stigmer/skills/calculator/SKILL.md");
    const skills = [makeSkill({ id: "id-1", name: "calculator" })];
    expect(await checkSkillIntegrity(skills, backend)).toBe(true);
  });

  it("returns false when sentinel is missing", async () => {
    const backend = makeMockBackend();
    const skills = [makeSkill({ id: "id-1", name: "calculator" })];
    expect(await checkSkillIntegrity(skills, backend)).toBe(false);
  });

  it("returns true for empty skills list", async () => {
    const backend = makeMockBackend();
    expect(await checkSkillIntegrity([], backend)).toBe(true);
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

// ─── fetchSkillArtifacts ─────────────────────────────────────────────────

describe("fetchSkillArtifacts", () => {
  it("returns empty map when no skills have artifacts", async () => {
    const client = makeMockClient();
    const skills = [makeSkill({ artifactStorageKey: "" })];
    const result = await fetchSkillArtifacts(client, skills);
    expect(result.size).toBe(0);
    expect(client.getSkillArtifact).not.toHaveBeenCalled();
  });

  it("fetches artifacts for skills with storage keys", async () => {
    const artifactData = new Uint8Array([80, 75, 3, 4]); // ZIP magic bytes
    const client = makeMockClient({
      getSkillArtifact: vi.fn().mockResolvedValue({ artifact: artifactData }),
    });
    const skills = [makeSkill({ id: "id-1", artifactStorageKey: "artifacts/key.zip" })];
    const result = await fetchSkillArtifacts(client, skills);
    expect(result.size).toBe(1);
    expect(result.get("id-1")).toEqual(artifactData);
  });

  it("handles partial failures gracefully", async () => {
    const client = makeMockClient({
      getSkillArtifact: vi.fn()
        .mockResolvedValueOnce({ artifact: new Uint8Array([1, 2, 3]) })
        .mockRejectedValueOnce(new Error("Network error")),
    });
    const skills = [
      makeSkill({ id: "id-1", name: "good", artifactStorageKey: "key1" }),
      makeSkill({ id: "id-2", name: "bad", artifactStorageKey: "key2" }),
    ];
    const result = await fetchSkillArtifacts(client, skills);
    expect(result.size).toBe(1);
    expect(result.has("id-1")).toBe(true);
  });
});
