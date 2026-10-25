/**
 * Pins how the agent's skills reach the Claude engine (`skill-plugins.ts`):
 * the names each skill loads under, the turns refused for skills that
 * cannot be named apart, and the plugin tree written for the engine.
 *
 * Why it matters: the engine acts on a skill file's header (its hooks, tool
 * grants, model), so the file it reads must be the one written here, header
 * rewritten to the control plane's name and description; and the engine's
 * id is the allowlist's form, so a name computed wrong is a skill silently
 * missing. Each name is the one measured on the engine (SDK 0.3.310): a
 * plugin's `<plugin>:<skill>`, the own-skills plugin's `agent:<skill>`, a
 * dotted name's slug as its id and its own spelling as an alias.
 */

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MOUNT_MARKER_FILE } from "../../../shared/skill-mount.js";
import type { SkillMetadata } from "../../../shared/skill-resolver.js";
import { OWN_SKILLS_PLUGIN, SKILL_PLUGINS_SUBDIR, SkillNameClash, bodyOf, engineSkillOf, skillFileOf, spellingsOf, turnSkillsOf, writeSkillPlugins } from "../skill-plugins.js";

const WORKSPACE = "/work/repo";

function own(name: string, description = `About ${name}.`): SkillMetadata {
  return { name, description, path: `.stigmer/skills/${name}/SKILL.md` };
}

function pluginSkill(plugin: string, skill: string, digest = "d1", path = `skills/${skill}`): SkillMetadata {
  return { name: `${plugin}:${skill}`, description: `About ${skill}.`, path: `.stigmer/plugins/${digest}/${path}/SKILL.md` };
}

describe("engineSkillOf", () => {
  it("names an own skill under the own-skills plugin, its id and its alias one", () => {
    const skill = engineSkillOf(own("review"), WORKSPACE);
    expect(skill).toEqual({
      id: "agent:review",
      name: "agent:review",
      plugin: OWN_SKILLS_PLUGIN,
      slug: "review",
      description: "About review.",
      sourceDir: `${WORKSPACE}/.stigmer/skills/review`,
      origin: "own",
    });
    expect(spellingsOf(skill)).toEqual(["agent:review"]);
  });

  it("names a dotted skill by its slug, the engine's id, and keeps its own spelling as an alias", () => {
    const skill = engineSkillOf(own("platform.planton-architecture"), WORKSPACE);
    expect([skill.id, skill.name, skill.slug]).toEqual(["agent:platform-planton-architecture", "agent:platform.planton-architecture", "platform-planton-architecture"]);
    expect(spellingsOf(skill)).toEqual(["agent:platform-planton-architecture", "agent:platform.planton-architecture"]);
  });

  it("keeps a plugin's skill under its plugin, with the plugin's digest as its origin", () => {
    const skill = engineSkillOf(pluginSkill("acme", "lint", "abc123"), WORKSPACE);
    expect([skill.id, skill.plugin, skill.origin, skill.sourceDir]).toEqual(["acme:lint", "acme", "abc123", `${WORKSPACE}/.stigmer/plugins/abc123/skills/lint`]);
  });
});

describe("turnSkillsOf", () => {
  const of = (...skills: SkillMetadata[]) => skills.map((skill) => engineSkillOf(skill, WORKSPACE));

  it("counts a skill several agents have once, keeping the first agent's order", () => {
    const turn = turnSkillsOf([of(own("review"), pluginSkill("acme", "lint")), of(pluginSkill("acme", "lint"), own("ci"))]);
    expect(turn.map((skill) => skill.id)).toEqual(["agent:review", "acme:lint", "agent:ci"]);
  });

  it("refuses two skills that load under one id from different places", () => {
    expect(() => turnSkillsOf([of(own("notes.style")), of(own("notes-style"))])).toThrow(SkillNameClash);
    expect(() => turnSkillsOf([of(own("notes.style"), own("notes-style"))])).toThrow("The skills 'agent:notes.style' and 'agent:notes-style' both load on Claude as 'agent:notes-style'.");
  });

  it("refuses two plugins of one name, even when their skills differ", () => {
    expect(() => turnSkillsOf([of(pluginSkill("acme", "lint", "d1"), pluginSkill("acme", "format", "d2"))])).toThrow("Two plugins are named 'acme'");
  });

  it("refuses a plugin named like the own-skills plugin", () => {
    expect(() => turnSkillsOf([of(pluginSkill(OWN_SKILLS_PLUGIN, "x"))])).toThrow(`A plugin is named '${OWN_SKILLS_PLUGIN}'`);
  });
});

describe("bodyOf and skillFileOf", () => {
  it("cut a skill's header, a byte-order mark and the blank lines after it, and keep the body as written", () => {
    expect(bodyOf("---\nname: x\nhooks:\n  PreToolUse: []\n---\n\n# Body\n\nText.\n")).toBe("# Body\n\nText.\n");
    expect(bodyOf("﻿---\r\nname: x\r\n---\r\nBody\r\n")).toBe("Body\r\n");
    expect(bodyOf("# No header\n")).toBe("# No header\n");
    expect(bodyOf("---\nname: x\n---")).toBe("");
  });

  it("write the control plane's name and description as the only header, each one quoted value", () => {
    const skill = engineSkillOf({ name: "acme:lint", description: 'Says "hi": twice\nthen stops.', path: ".stigmer/plugins/d1/skills/lint/SKILL.md" }, WORKSPACE);
    const text = skillFileOf(skill, "---\nname: lint\nmodel: haiku\nallowed-tools: Bash\n---\nLint it.\n");
    expect(text).toBe('---\nname: "lint"\ndescription: "Says \\"hi\\": twice\\nthen stops."\n---\n\nLint it.\n');
    expect(text).not.toContain("model:");
    expect(text).not.toContain("allowed-tools");
  });
});

describe("writeSkillPlugins", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "claude-skill-plugins-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function mount(relative: string, files: Record<string, string>): void {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(root, "ws", relative, name, ".."), { recursive: true });
      writeFileSync(join(root, "ws", relative, name), text);
    }
  }

  it("writes one skills-only plugin per plugin name, each skill's file rewritten and every other entry linked", async () => {
    mount(".stigmer/skills/platform.x", {
      "SKILL.md": "---\nname: platform.x\nhooks: {}\n---\nUse the reference.\n",
      "references/a.md": "A",
      [MOUNT_MARKER_FILE]: "{}",
    });
    mount(".stigmer/plugins/d1/skills/lint", { "SKILL.md": "Lint.\n", "run.sh": "#!/bin/sh\n" });
    const workspace = join(root, "ws");
    const skills = turnSkillsOf([[engineSkillOf(own("platform.x"), workspace), engineSkillOf(pluginSkill("acme", "lint"), workspace)]]);
    const home = join(root, "home");

    const plugins = await writeSkillPlugins(home, skills);

    expect(plugins).toEqual([
      { type: "local", path: join(home, SKILL_PLUGINS_SUBDIR, "agent"), skipMcpDiscovery: true },
      { type: "local", path: join(home, SKILL_PLUGINS_SUBDIR, "acme"), skipMcpDiscovery: true },
    ]);
    expect(JSON.parse(readFileSync(join(home, "plugins/agent/.claude-plugin/plugin.json"), "utf8"))).toEqual({ name: "agent" });
    const ownDir = join(home, "plugins/agent/skills/platform-x");
    expect(readFileSync(join(ownDir, "SKILL.md"), "utf8")).toBe('---\nname: "platform.x"\ndescription: "About platform.x."\n---\n\nUse the reference.\n');
    expect(lstatSync(join(ownDir, "references")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(ownDir, "references"))).toBe(join(workspace, ".stigmer/skills/platform.x/references"));
    expect(readFileSync(join(ownDir, "references/a.md"), "utf8")).toBe("A");
    expect(existsSync(join(ownDir, MOUNT_MARKER_FILE)), "the mount's own marker is not the skill's").toBe(false);
    expect(readFileSync(join(home, "plugins/acme/skills/lint/SKILL.md"), "utf8")).toBe('---\nname: "lint"\ndescription: "About lint."\n---\n\nLint.\n');
    expect(readlinkSync(join(home, "plugins/acme/skills/lint/run.sh"))).toBe(join(workspace, ".stigmer/plugins/d1/skills/lint/run.sh"));
  });

  it("writes nothing for a turn with no skills", async () => {
    expect(await writeSkillPlugins(join(root, "home"), [])).toEqual([]);
    expect(existsSync(join(root, "home"))).toBe(false);
  });
});
