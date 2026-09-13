/**
 * The "also available" note (`shared/skill-writer.ts`), the one renderer the
 * module keeps since S3 M2b. Its former arms — ref merging, fetching,
 * mounting, the `## Skills` section from `Skill` protos — moved with their
 * code: merging to `blueprint-resolver.test.ts`, mounting to
 * `skill-mount.test.ts` / `skill-resolver.test.ts` / `harness/__tests__/mount-skills.test.ts`,
 * the section to `execute-deep-agent/__tests__/prompt-builder.test.ts`
 * (`renderSkillsSection`).
 */

import { describe, it, expect } from "vitest";
import { generateAlsoAvailableSection } from "../skill-writer.js";

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
