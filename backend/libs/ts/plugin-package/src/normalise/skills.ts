/**
 * Skill discovery and the `SKILL.md` frontmatter check.
 *
 * Discovery follows the union of the dialects' rules: the immediate child
 * directories of `skills/` that hold a `SKILL.md` (the open format's fixed
 * location, no recursion), plus every path a manifest declared (Claude adds
 * to the default; Cursor's value is the default in practice), where a
 * declared path is a skill when it holds `SKILL.md` directly and a directory
 * of skills otherwise, plus Claude's single-skill layout (a root `SKILL.md`
 * with no `skills/` and no declaration). A declared path that names nothing
 * is a warning: Cursor's own tooling does not refuse it, and refusing would
 * turn a stale manifest line into a failed install.
 *
 * The frontmatter check is a discovery check, not the push gate: it asks
 * that the block be present and closed, that it parse, and that `name`
 * satisfy `SKILL_NAME_PATTERN`. A missing `name` falls back to the directory
 * name (Claude's rule) with a warning; the Agent Skills rules Stigmer relaxes
 * (`name` equal to the directory, `description` present) are warnings.
 * Optional frontmatter (`license`, `compatibility`, `metadata`,
 * `allowed-tools`) and vendor keys ride inside the skill untouched. Every
 * file under the skill directory is listed for the installer's per-skill
 * archive; only `SKILL.md` is ever read.
 */

import type { ManifestSet } from "../detect.js";
import { readText } from "../documents.js";
import { basename, comparePaths, joinPath, type PluginFileIndex } from "../files.js";
import { extractFrontmatter, parseFrontmatter, SKILL_NAME_PATTERN } from "../frontmatter.js";
import type { Findings } from "../messages.js";
import type { PluginSkill } from "../types.js";

export const SKILL_FILE = "SKILL.md";
export const DEFAULT_SKILLS_DIR = "skills";

export function normaliseSkills(index: PluginFileIndex, set: ManifestSet, findings: Findings): readonly PluginSkill[] {
  const skills: PluginSkill[] = [];
  const seenNames = new Map<string, string>();

  for (const dir of discoverSkillDirs(index, set, findings)) {
    const skill = readSkill(index, dir, set, findings);
    if (skill === undefined) continue;
    const previous = seenNames.get(skill.name);
    if (previous !== undefined) {
      findings.error("skill-name-duplicate", { subject: skill.name, path: joinPath(dir, SKILL_FILE) });
      continue;
    }
    seenNames.set(skill.name, dir);
    skills.push(skill);
  }
  return skills;
}

/** Skill directories, deduplicated, in path order; the root skill is `""`. */
function discoverSkillDirs(index: PluginFileIndex, set: ManifestSet, findings: Findings): readonly string[] {
  const dirs = new Set<string>();
  const addSkillsUnder = (parent: string): void => {
    for (const child of index.childDirectories(parent)) {
      const dir = joinPath(parent, child);
      if (index.has(joinPath(dir, SKILL_FILE))) dirs.add(dir);
    }
  };

  addSkillsUnder(DEFAULT_SKILLS_DIR);

  const declared = set.manifests.flatMap((m) => m.skillPaths);
  for (const { path, manifest } of declared) {
    if (index.has(joinPath(path, SKILL_FILE))) {
      dirs.add(path);
    } else if (index.isDirectory(path)) {
      addSkillsUnder(path);
    } else {
      findings.warn("path-missing", { path: manifest, subject: path === "" ? "." : `./${path}` });
    }
  }

  if (declared.length === 0 && !index.isDirectory(DEFAULT_SKILLS_DIR) && index.has(SKILL_FILE)) {
    dirs.add("");
  }

  return [...dirs].sort(comparePaths);
}

function readSkill(index: PluginFileIndex, dir: string, set: ManifestSet, findings: Findings): PluginSkill | undefined {
  const path = joinPath(dir, SKILL_FILE);
  const text = readText(index, path, "skillMd", findings);
  if (text === undefined) return undefined;

  const extracted = extractFrontmatter(text);
  if (!extracted.ok) {
    findings.error(extracted.reason === "missing" ? "skill-frontmatter-missing" : "skill-frontmatter-unclosed", { path });
    return undefined;
  }
  const parsed = parseFrontmatter(extracted.yaml);
  if (!parsed.ok) {
    findings.error("skill-frontmatter-unreadable", { path, detail: parsed.detail });
    return undefined;
  }

  const directoryName = dir === "" ? (set.name ?? "skill") : basename(dir);
  let name: string;
  if (typeof parsed.fields["name"] === "string" && parsed.fields["name"] !== "") {
    name = parsed.fields["name"];
  } else {
    name = directoryName;
    findings.warn("skill-name-defaulted", { path, subject: name });
  }
  if (!SKILL_NAME_PATTERN.test(name)) {
    findings.error("skill-name-invalid", { path, subject: name });
    return undefined;
  }
  if (dir !== "" && name !== directoryName) {
    findings.warn("skill-name-differs-from-directory", { path, subject: name, detail: directoryName });
  }

  const description = parsed.fields["description"];
  if (typeof description !== "string" || description === "") {
    findings.warn("skill-description-missing", { path, subject: name });
  }

  return {
    name,
    ...(typeof description === "string" && description !== "" && { description }),
    dir,
    files: index.filesUnder(dir),
  };
}
