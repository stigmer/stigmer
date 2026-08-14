// Unit tests for the skill packaging layer: SKILL.md frontmatter parsing, the
// ignore-filtered zip walk, dry-run analysis, and byte/hash formatting.

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { Stigmer } from "@stigmer/sdk";
import { unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classify, ExitCode } from "../errors/index.js";
import {
  analyzeDryRun,
  createSkillZip,
  formatBytes,
  hasSkillFile,
  parseSkillMetadata,
  parseVisibility,
  pushSkill,
  pushSkillFromArchive,
  readSkillArchive,
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
  const calls = {
    push: 0,
    pushedArtifacts: [] as Uint8Array[],
    updateVisibility: [] as Array<{ resourceId: string; visibility: ApiResourceVisibility }>,
  };
  const skillMessage = { metadata: { ...pushMeta } };
  const client = {
    skill: {
      async push(request?: { artifact?: Uint8Array }) {
        calls.push++;
        if (request?.artifact !== undefined) calls.pushedArtifacts.push(request.artifact);
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

describe("createSkillZip determinism", () => {
  // Version identity is the server-side SHA-256 of the zip bytes, so identical
  // content must produce identical bytes no matter when or where it was
  // checked out (stigmer/stigmer#671). Distinct source mtimes model the fresh
  // CI checkout; distinct wall-clock runs are inherent to running twice.
  it("produces byte-identical zips for identical content across mtimes and wall-clock time", () => {
    const otherDir = mkdtempSync(join(tmpdir(), "skill-test-b-"));
    vi.useFakeTimers();
    try {
      for (const d of [dir, otherDir]) {
        writeFileSync(join(d, "SKILL.md"), SKILL_MD);
        mkdirSync(join(d, "references"));
        writeFileSync(join(d, "references", "guide.md"), "# Guide\n");
      }
      // Backdate one copy: same content, different filesystem timestamps
      // (models a fresh CI checkout).
      const past = new Date("2020-06-15T12:00:00Z");
      utimesSync(join(otherDir, "SKILL.md"), past, past);
      utimesSync(join(otherDir, "references", "guide.md"), past, past);

      // Advance the clock between runs: without a pinned mtime, fflate stamps
      // zip-creation time into every entry (DOS 2-second granularity), so two
      // pushes minutes apart would differ even from the same directory.
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const a = createSkillZip(dir, NO_IGNORE).bytes;
      vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));
      const b = createSkillZip(otherDir, NO_IGNORE).bytes;
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    } finally {
      vi.useRealTimers();
      rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it("changes bytes when content changes", () => {
    writeFileSync(join(dir, "SKILL.md"), SKILL_MD);
    const before = createSkillZip(dir, NO_IGNORE).bytes;
    writeFileSync(join(dir, "extra.md"), "new content\n");
    const after = createSkillZip(dir, NO_IGNORE).bytes;
    expect(Buffer.from(before).equals(Buffer.from(after))).toBe(false);
  });
});

describe("readSkillArchive", () => {
  function writeArchive(files: Record<string, string>): string {
    const zipped = zipSync(
      Object.fromEntries(Object.entries(files).map(([p, c]) => [p, new TextEncoder().encode(c)])),
    );
    const archivePath = join(dir, "skill.zip");
    writeFileSync(archivePath, zipped);
    return archivePath;
  }

  it("accepts an archive with a root SKILL.md and reports entry stats", () => {
    const archivePath = writeArchive({
      "SKILL.md": SKILL_MD,
      "references/guide.md": "# Guide\n",
    });
    const archive = readSkillArchive(archivePath);
    expect(archive.meta.name).toBe("my-skill");
    expect(archive.fileCount).toBe(2);
    expect(archive.totalSize).toBeGreaterThan(0);
  });

  it("rejects an archive whose SKILL.md is only nested (root-only contract, DD-018)", () => {
    const archivePath = writeArchive({ "my-skill/SKILL.md": SKILL_MD });
    expect(() => readSkillArchive(archivePath)).toThrow(/root of/);
  });

  it("rejects a file that is not a ZIP archive", () => {
    const archivePath = join(dir, "not-a-zip.zip");
    writeFileSync(archivePath, "plain text");
    expect(() => readSkillArchive(archivePath)).toThrow(/not a valid ZIP/);
  });

  it("rejects a missing file with a usage error", () => {
    const err = (() => {
      try {
        readSkillArchive(join(dir, "absent.zip"));
      } catch (e) {
        return e;
      }
    })();
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
  });
});

describe("pushSkillFromArchive", () => {
  it("uploads the archive bytes untouched (checksum parity) and applies declared visibility", async () => {
    const zipped = zipSync({
      "SKILL.md": new TextEncoder().encode("---\nname: my-skill\nvisibility: public\n---\n# S\n"),
    });
    const archivePath = join(dir, "skill.zip");
    writeFileSync(archivePath, zipped);
    const { client, calls } = fakeClient({ id: "skill-123", visibility: ApiResourceVisibility.visibility_private });

    const result = await pushSkillFromArchive(client, archivePath, "stigmer", "", "release v1.2.3");

    expect(calls.push).toBe(1);
    expect(Buffer.from(calls.pushedArtifacts[0]).equals(Buffer.from(zipped))).toBe(true);
    expect(calls.updateVisibility).toEqual([
      { resourceId: "skill-123", visibility: ApiResourceVisibility.visibility_public },
    ]);
    expect(result.skillName).toBe("my-skill");
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

// The transfer-lane size routing moved down into the SDK (stigmer#701):
// its pins live in sdk/typescript/src/__tests__/skill.test.ts, exercised
// through the REAL generated client and error wrapping — the fake client
// this file previously used threw raw ConnectError, which the SDK's
// wrapError makes unreachable on the real path.
