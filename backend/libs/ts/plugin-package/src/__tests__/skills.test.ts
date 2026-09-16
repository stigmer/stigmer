/**
 * Pins skill discovery across the dialects (the fixed `skills/` children,
 * declared paths that are a skill or a directory of skills, Claude's root
 * single skill) and the frontmatter check's relaxations (name defaulted to
 * the directory, name differing from the directory, description missing),
 * plus the per-skill file listing the installer builds archives from.
 */

import { describe, expect, it } from "vitest";

import { claudePlugin, cursorPlugin, openPlugin, withFile } from "../testing.js";
import { accepted, kindsOf, read } from "../__test-utils__/read.js";

describe("discovery", () => {
  it("reads the immediate children of skills/ that hold SKILL.md, and lists each skill's files", () => {
    const files = openPlugin({
      skills: [
        { name: "alpha", description: "A", files: { "scripts/run.sh": "echo", "references/REF.md": "ref" } },
        { name: "beta", description: "B" },
      ],
    });
    files.set("skills/not-a-skill/README.md", "no SKILL.md here");
    files.set("skills/alpha/nested/deeper/SKILL.md", "---\nname: deeper\ndescription: d\n---\nbody");
    const plugin = accepted(read(files));
    expect(plugin.skills.map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(plugin.skills[0]).toMatchObject({
      dir: "skills/alpha",
      files: ["skills/alpha/SKILL.md", "skills/alpha/nested/deeper/SKILL.md", "skills/alpha/references/REF.md", "skills/alpha/scripts/run.sh"],
    });
  });

  it("reads a declared directory of skills and a declared path that is itself a skill", () => {
    const files = claudePlugin({ manifest: { skills: ["./extra/", "./solo"] } });
    files.set("extra/one/SKILL.md", "---\nname: one\ndescription: d\n---\nbody");
    files.set("solo/SKILL.md", "---\nname: solo\ndescription: d\n---\nbody");
    files.set("skills/base/SKILL.md", "---\nname: base\ndescription: d\n---\nbody");
    const plugin = accepted(read(files));
    expect(plugin.skills.map((s) => s.dir)).toEqual(["extra/one", "skills/base", "solo"]);
  });

  it("reads a root SKILL.md as a single skill when nothing else declares skills", () => {
    const files = claudePlugin({ name: "solo-skill" });
    files.set("SKILL.md", "---\nname: solo-skill\ndescription: d\n---\nbody");
    files.set("README.md", "readme");
    const plugin = accepted(read(files));
    expect(plugin.skills).toHaveLength(1);
    expect(plugin.skills[0]).toMatchObject({ name: "solo-skill", dir: "" });
    expect(plugin.skills[0]?.files).toContain("README.md");
  });

  it("does not read a root SKILL.md when skills/ exists", () => {
    const files = openPlugin({ skills: [{ name: "a", description: "d" }] });
    files.set("SKILL.md", "---\nname: root\ndescription: d\n---\nbody");
    expect(accepted(read(files)).skills.map((s) => s.name)).toEqual(["a"]);
  });

  it("warns on a declared skills path that names nothing", () => {
    const outcome = read(cursorPlugin({ manifest: { skills: "./missing/" } }));
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["path-missing"] });
  });
});

describe("frontmatter", () => {
  it("accepts optional and vendor frontmatter keys silently", () => {
    const files = openPlugin({
      skills: [{ name: "a", description: "d", frontmatter: { license: "MIT", metadata: { author: "x" }, "allowed-tools": "Bash", "disable-model-invocation": true, icon: "bulb" } }],
    });
    expect(kindsOf(read(files))).toEqual({ errors: [], warnings: [] });
  });

  it("names a skill after its directory when the frontmatter has no name, with a warning", () => {
    const files = withFile(openPlugin(), "skills/from-dir/SKILL.md", "---\ndescription: d\n---\nbody");
    const outcome = read(files);
    expect(kindsOf(outcome).warnings).toEqual(["skill-name-defaulted"]);
    expect(accepted(outcome).skills[0]?.name).toBe("from-dir");
  });

  it("warns when the name differs from the directory and when the description is missing", () => {
    const files = openPlugin({ skills: [{ name: "real-name", dir: "other-dir" }] });
    const outcome = read(files);
    expect(kindsOf(outcome).warnings).toEqual(["skill-description-missing", "skill-name-differs-from-directory"]);
    expect(accepted(outcome).skills[0]).toMatchObject({ name: "real-name", dir: "skills/other-dir" });
  });

  it("accepts Stigmer's dot-scoped names, a superset of the Agent Skills rule", () => {
    const plugin = accepted(read(openPlugin({ skills: [{ name: "platform.my-skill", description: "d" }] })));
    expect(plugin.skills[0]?.name).toBe("platform.my-skill");
  });
});
