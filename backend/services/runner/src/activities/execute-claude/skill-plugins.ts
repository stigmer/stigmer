/**
 * The agent's skills as the Claude engine loads them: skills-only local
 * plugins this adapter writes for each invocation, under the invocation's
 * own home (`engine-env.ts`), which the turn removes when it ends.
 *
 * The engine knows a skill only as a file, and with no settings source read
 * (`settingSources: []`, `engine-options.ts`) only a plugin supplies one,
 * named `<plugin>:<skill>`. So every skill of the turn rides a plugin:
 *
 *  - a Stigmer plugin's skills ride a plugin of that plugin's name, so they
 *    read `<plugin>:<skill>`, exactly the name every engine gives them;
 *  - the agent's own and the session's skills ride one plugin named
 *    {@link OWN_SKILLS_PLUGIN}, so they read `agent:<skill>`. A plain name
 *    would need the engine's user source, which reads a settings file the
 *    agent's own processes can write (hooks, an environment that redirects
 *    model calls, a key-helper command); no settings file is ever read.
 *
 * Each skill's directory holds a `SKILL.md` this adapter writes: a header of
 * the skill's name and description as the control plane holds them (what
 * every engine shows), then the mounted file's body with its own header cut
 * off, so a header's hooks, tool grants, model or forked context never act:
 * a skill is text the model follows, as on every engine. Its other entries
 * are links to the mounted ones, so its references and scripts read as
 * authored. The engine reads each skill once, when it starts (measured on
 * SDK 0.3.310), so a file changed while it works never reaches the model;
 * its switches back the rewrite all the same (`engine-options.ts`): a
 * body's inline commands and every plugin and skill hook are off.
 *
 * Names, measured on SDK 0.3.310: the engine's id for a skill is its
 * directory name with every `.` made `-`, which is the skill's own slug
 * (`apis/ai/stigmer/agentic/skill/v1/spec.proto`), and the header's name is
 * an alias it answers to as well; the `skills` allowlist is matched on the
 * id alone. So a dotted name lists as `agent:platform-x (agent:platform.x)`
 * and a call by either spelling loads it ({@link EngineSkill}).
 *
 * A turn whose skills cannot all be named apart is refused, naming them
 * ({@link SkillNameClash}): two Stigmer plugins of one name, a Stigmer
 * plugin named like the own-skills plugin, or two skills whose ids meet.
 */

import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import type { SdkPluginConfig } from "@anthropic-ai/claude-agent-sdk";

import { MOUNT_MARKER_FILE } from "../../shared/skill-mount.js";
import type { SkillMetadata } from "../../shared/skill-resolver.js";
import { PLUGINS_SUBDIR } from "../../shared/plugin-mount.js";

/** The plugin the agent's own and the session's skills ride (the header). */
export const OWN_SKILLS_PLUGIN = "agent";

/** Where the generated plugins live in the invocation's home. */
export const SKILL_PLUGINS_SUBDIR = "plugins";

/** One skill of the turn as the engine loads it. */
export interface EngineSkill {
  /** The engine's id, `<plugin>:<slug>`: the allowlist's form. */
  readonly id: string;
  /** The skill's own name under its plugin, `<plugin>:<name>`: the alias the engine answers to, and the name every engine shows. */
  readonly name: string;
  readonly plugin: string;
  /** The directory name the engine derives the id from. */
  readonly slug: string;
  readonly description: string;
  /** The mounted skill's directory, reached through the workspace's `.stigmer` link. */
  readonly sourceDir: string;
  /** What the skill came from, to tell two plugins of one name apart: `own`, or the plugin's digest. */
  readonly origin: string;
}

/** A turn whose skills cannot be named apart (the header); refused `actionable`. */
export class SkillNameClash extends Error {}

/** Every spelling a call may name a skill by: its id and its own name. */
export function spellingsOf(skill: EngineSkill): readonly string[] {
  return skill.id === skill.name ? [skill.id] : [skill.id, skill.name];
}

/** A mounted skill as the engine names it: a plugin's `<plugin>:<skill>` keeps its plugin, any other rides {@link OWN_SKILLS_PLUGIN}. */
export function engineSkillOf(skill: SkillMetadata, primaryDir: string): EngineSkill {
  const colon = skill.name.indexOf(":");
  const plugin = colon < 0 ? OWN_SKILLS_PLUGIN : skill.name.slice(0, colon);
  const own = colon < 0 ? skill.name : skill.name.slice(colon + 1);
  const slug = own.replace(/\./g, "-");
  return {
    id: `${plugin}:${slug}`,
    name: `${plugin}:${own}`,
    plugin,
    slug,
    description: skill.description,
    sourceDir: dirname(join(primaryDir, skill.path)),
    origin: colon < 0 ? "own" : digestOf(skill.path),
  };
}

/** The mounted plugin's digest in a plugin skill's path (`.stigmer/plugins/<digest>/…`, `harness/turn-context.ts`). */
function digestOf(path: string): string {
  const parts = path.split(sep);
  const at = parts.indexOf(PLUGINS_SUBDIR);
  return at < 0 ? path : (parts[at + 1] ?? path);
}

/**
 * The turn's distinct skills, from every agent's lists (the root's, then each
 * sub-agent's): one per id, a skill several agents have counted once.
 * Throws {@link SkillNameClash} for a turn the header refuses.
 */
export function turnSkillsOf(lists: readonly (readonly EngineSkill[])[]): EngineSkill[] {
  const byId = new Map<string, EngineSkill>();
  const originsByPlugin = new Map<string, Set<string>>();
  for (const skill of lists.flat()) {
    if (skill.origin !== "own") {
      if (skill.plugin === OWN_SKILLS_PLUGIN) {
        throw new SkillNameClash(
          `A plugin is named '${OWN_SKILLS_PLUGIN}', which Claude keeps for the agent's own skills, so its skill '${skill.name}' cannot load. Rename the plugin, or run this agent on another engine.`,
        );
      }
      const origins = originsByPlugin.get(skill.plugin) ?? new Set<string>();
      origins.add(skill.origin);
      originsByPlugin.set(skill.plugin, origins);
      if (origins.size > 1) {
        throw new SkillNameClash(`Two plugins are named '${skill.plugin}', so Claude cannot tell their skills apart. Rename one, or run this agent on another engine.`);
      }
    }
    const seen = byId.get(skill.id);
    if (seen === undefined) {
      byId.set(skill.id, skill);
    } else if (seen.sourceDir !== skill.sourceDir) {
      throw new SkillNameClash(`The skills '${seen.name}' and '${skill.name}' both load on Claude as '${skill.id}'. Rename one, or run this agent on another engine.`);
    }
  }
  return [...byId.values()];
}

/** Write the turn's skills as skills-only plugins under `home` (the header); the engine's `plugins` option. */
export async function writeSkillPlugins(home: string, skills: readonly EngineSkill[]): Promise<SdkPluginConfig[]> {
  const plugins = new Map<string, EngineSkill[]>();
  for (const skill of skills) plugins.set(skill.plugin, [...(plugins.get(skill.plugin) ?? []), skill]);
  const configs: SdkPluginConfig[] = [];
  for (const [plugin, members] of plugins) {
    const dir = join(home, SKILL_PLUGINS_SUBDIR, plugin);
    await mkdir(join(dir, ".claude-plugin"), { recursive: true });
    await writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: plugin }));
    for (const skill of members) await writeSkillDir(join(dir, "skills", skill.slug), skill);
    configs.push({ type: "local", path: dir, skipMcpDiscovery: true });
  }
  return configs;
}

/** One skill's directory: the rewritten `SKILL.md`, and a link for every other mounted entry. */
async function writeSkillDir(dir: string, skill: EngineSkill): Promise<void> {
  await mkdir(dir, { recursive: true });
  const mounted = await readFile(join(skill.sourceDir, "SKILL.md"), "utf8");
  await writeFile(join(dir, "SKILL.md"), skillFileOf(skill, mounted));
  for (const entry of await readdir(skill.sourceDir)) {
    if (entry === "SKILL.md" || entry === MOUNT_MARKER_FILE) continue;
    await symlink(join(skill.sourceDir, entry), join(dir, entry));
  }
}

/** A `SKILL.md` as the engine reads it: the control plane's name and description, then the mounted body without its header. */
export function skillFileOf(skill: Pick<EngineSkill, "name" | "plugin" | "description">, mounted: string): string {
  const name = skill.name.slice(skill.plugin.length + 1);
  // JSON strings are YAML's double-quoted scalars, so any text is one value.
  return `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${bodyOf(mounted)}`;
}

/** A skill file's body: everything after its header, when it opens with one. */
export function bodyOf(text: string): string {
  const unmarked = text.replace(/^﻿/, "");
  const header = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(unmarked);
  return (header === null ? unmarked : unmarked.slice(header[0].length)).replace(/^(?:[ \t]*\r?\n)+/, "");
}
