// Unit tests for the skill packaging layer: SKILL.md frontmatter parsing, the
// ignore-filtered zip walk, dry-run analysis, and byte/hash formatting.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { Stigmer } from "@stigmer/sdk";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classify, ExitCode } from "../errors/index.js";
import {
  analyzeDryRun,
  createSkillZip,
  formatBytes,
  hasSkillFile,
  parseSkillMetadata,
  parseVisibility,
  pushSkill,
  shortHash,
} from "./skill.js";

const SKILL_MD = ["---", "name: my-skill", "description: a test skill", "---", "# My Skill", "", "Body."].join("\n");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "skill-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("parseSkillMetadata", () => {
  it("parses a valid kebab-case name from frontmatter", () => {
    writeFileSync(join(dir, "SKILL.md"), SKILL_MD);
    expect(parseSkillMetadata(dir)).toEqual({ name: "my-skill" });
  });

  it("rejects a missing name with a usage error", () => {
    writeFileSync(join(dir, "SKILL.md"), "---\ndescription: no name\n---\n");
    const err = (() => {
      try {
        parseSkillMetadata(dir);
      } catch (e) {
        return e;
      }
    })();
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
  });

  it("rejects a non-kebab-case name", () => {
    writeFileSync(join(dir, "SKILL.md"), "---\nname: My_Skill\n---\n");
    expect(() => parseSkillMetadata(dir)).toThrow(/kebab-case/);
  });

  it("accepts a dot-scoped namespace name", () => {
    writeFileSync(join(dir, "SKILL.md"), "---\nname: platform.planton-architecture\n---\n");
    expect(parseSkillMetadata(dir)).toEqual({ name: "platform.planton-architecture" });
  });

  it("rejects consecutive separators in a dotted name", () => {
    writeFileSync(join(dir, "SKILL.md"), "---\nname: platform..architecture\n---\n");
    expect(() => parseSkillMetadata(dir)).toThrow(/kebab-case/);
  });

  it("rejects content without frontmatter", () => {
    writeFileSync(join(dir, "SKILL.md"), "# No frontmatter here\n");
    expect(() => parseSkillMetadata(dir)).toThrow(/frontmatter/);
  });

  it("parses a declared visibility from frontmatter", () => {
    writeFileSync(join(dir, "SKILL.md"), "---\nname: my-skill\nvisibility: public\n---\n");
    expect(parseSkillMetadata(dir)).toEqual({
      name: "my-skill",
      visibility: ApiResourceVisibility.visibility_public,
    });
  });

  it("leaves visibility undefined when not declared", () => {
    writeFileSync(join(dir, "SKILL.md"), SKILL_MD);
    expect(parseSkillMetadata(dir).visibility).toBeUndefined();
  });
});

describe("parseVisibility", () => {
  it("maps the four short forms", () => {
    expect(parseVisibility("private")).toBe(ApiResourceVisibility.visibility_private);
    expect(parseVisibility("public")).toBe(ApiResourceVisibility.visibility_public);
    expect(parseVisibility("org")).toBe(ApiResourceVisibility.visibility_org);
    expect(parseVisibility("platform")).toBe(ApiResourceVisibility.visibility_platform);
  });

  it("accepts canonical enum names and is case/whitespace insensitive", () => {
    expect(parseVisibility(" Visibility_Public ")).toBe(ApiResourceVisibility.visibility_public);
    expect(parseVisibility("PUBLIC")).toBe(ApiResourceVisibility.visibility_public);
  });

  it("treats omitted/unspecified as not declared (undefined)", () => {
    expect(parseVisibility(undefined)).toBeUndefined();
    expect(parseVisibility(null)).toBeUndefined();
    expect(parseVisibility("")).toBeUndefined();
    expect(parseVisibility("unspecified")).toBeUndefined();
  });

  it("throws on an unknown value", () => {
    expect(() => parseVisibility("everyone")).toThrow(/invalid 'visibility'/);
  });

  it("throws on a non-string value", () => {
    expect(() => parseVisibility(42)).toThrow(/expected a string/);
  });
});

// A minimal fake of the SDK surface pushSkill touches: skill.push + skill.updateVisibility.
function fakeClient(pushMeta: { id?: string; visibility?: ApiResourceVisibility }) {
  const calls = { push: 0, updateVisibility: [] as Array<{ resourceId: string; visibility: ApiResourceVisibility }> };
  const skillMessage = { metadata: { ...pushMeta } };
  const client = {
    skill: {
      async push() {
        calls.push++;
        return skillMessage;
      },
      async updateVisibility(input: { resourceId: string; visibility: ApiResourceVisibility }) {
        calls.updateVisibility.push({ resourceId: input.resourceId, visibility: input.visibility });
        return { metadata: { ...pushMeta, visibility: input.visibility } };
      },
    },
  } as unknown as Stigmer;
  return { client, calls };
}

const NO_IGNORE = { respectGitignore: true, extraIgnore: [], extraInclude: [] };

describe("pushSkill visibility propagation", () => {
  it("issues an UpdateVisibility RPC when the SKILL.md declares a non-matching visibility", async () => {
    writeFileSync(join(dir, "SKILL.md"), "---\nname: my-skill\nvisibility: public\n---\n");
    const { client, calls } = fakeClient({ id: "skill-123", visibility: ApiResourceVisibility.visibility_private });

    const result = await pushSkill(client, dir, "stigmer", "latest", "", NO_IGNORE);

    expect(calls.push).toBe(1);
    expect(calls.updateVisibility).toEqual([
      { resourceId: "skill-123", visibility: ApiResourceVisibility.visibility_public },
    ]);
    expect(result.visibility).toBe(ApiResourceVisibility.visibility_public);
  });

  it("does not touch visibility when the SKILL.md omits it", async () => {
    writeFileSync(join(dir, "SKILL.md"), SKILL_MD);
    const { client, calls } = fakeClient({ id: "skill-123", visibility: ApiResourceVisibility.visibility_private });

    await pushSkill(client, dir, "stigmer", "latest", "", NO_IGNORE);

    expect(calls.updateVisibility).toHaveLength(0);
  });

  it("skips the RPC when the server already matches the declared visibility", async () => {
    writeFileSync(join(dir, "SKILL.md"), "---\nname: my-skill\nvisibility: public\n---\n");
    const { client, calls } = fakeClient({ id: "skill-123", visibility: ApiResourceVisibility.visibility_public });

    await pushSkill(client, dir, "stigmer", "latest", "", NO_IGNORE);

    expect(calls.updateVisibility).toHaveLength(0);
  });
});

describe("createSkillZip", () => {
  it("includes survivors and excludes ignored files/dirs", () => {
    writeFileSync(join(dir, "SKILL.md"), SKILL_MD);
    writeFileSync(join(dir, "main.py"), "print('hi')\n");
    writeFileSync(join(dir, ".env"), "SECRET=1\n"); // default-ignored
    writeFileSync(join(dir, "notes.log"), "log\n"); // default-ignored (*.log)
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules", "dep.js"), "x\n"); // dir skipped
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "util.py"), "u\n");

    const decisions: string[] = [];
    const { bytes, stats } = createSkillZip(
      dir,
      { respectGitignore: true, extraIgnore: [], extraInclude: [] },
      (line) => decisions.push(line),
    );

    const entries = Object.keys(unzipSync(bytes)).sort();
    expect(entries).toEqual(["SKILL.md", "main.py", "src/util.py"]);
    expect(stats.filesIncluded).toBe(3);
    expect(stats.dirsSkipped).toBe(1);
    expect(stats.filesIgnored).toBeGreaterThanOrEqual(2);
    expect(decisions.some((l) => l.includes("SKIP DIR") && l.includes("node_modules"))).toBe(true);
  });

  it("force-include overrides a default ignore", () => {
    writeFileSync(join(dir, "SKILL.md"), SKILL_MD);
    writeFileSync(join(dir, ".env"), "SECRET=1\n");
    const { bytes } = createSkillZip(dir, { respectGitignore: true, extraIgnore: [], extraInclude: [".env"] });
    expect(Object.keys(unzipSync(bytes))).toContain(".env");
  });
});

describe("analyzeDryRun", () => {
  it("reports counts and pattern sources without producing bytes", () => {
    writeFileSync(join(dir, "SKILL.md"), SKILL_MD);
    writeFileSync(join(dir, "keep.py"), "k\n");
    writeFileSync(join(dir, ".env"), "S=1\n");
    const analysis = analyzeDryRun(dir, { respectGitignore: true, extraIgnore: [], extraInclude: [] });
    expect(analysis.stats.filesIncluded).toBe(2);
    expect(analysis.stats.filesIgnored).toBeGreaterThanOrEqual(1);
    expect(analysis.patternSources.some((s) => s.startsWith("defaults"))).toBe(true);
    expect(analysis.sampleIncluded).toContain("keep.py");
  });
});

describe("hasSkillFile", () => {
  it("detects SKILL.md presence", () => {
    expect(hasSkillFile(dir)).toBe(false);
    writeFileSync(join(dir, "SKILL.md"), SKILL_MD);
    expect(hasSkillFile(dir)).toBe(true);
  });
});

describe("formatBytes / shortHash", () => {
  it("formats byte sizes 1024-based", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  it("truncates hashes for display", () => {
    expect(shortHash("")).toBe("sha256:(none)");
    expect(shortHash("abcdef1234567890")).toBe("sha256:abcdef123456");
    expect(shortHash("abc")).toBe("sha256:abc");
  });
});
