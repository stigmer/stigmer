/**
 * Sub-agent files (`agents/*.md`) into the shape `SubAgent` takes.
 *
 * Cursor and Claude Code define this component; the open format does not,
 * so `agents/` is read only when a vendor manifest is present (`detect.ts`
 * decides) and recorded as ignored otherwise. Files come from the default
 * `agents/` directory or, when any manifest declares `agents`, from the
 * declared paths only (Claude's "replaces the default"), each of which may
 * be one `.md` file or a directory of them.
 *
 * The body of the file is the sub-agent's prompt. A body under
 * `SUB_AGENT_INSTRUCTIONS_MIN` characters is refused, because that is the
 * proto's floor for `SubAgent.instructions` and a parser that let it through
 * would add a second silent path after the runner's own (which drops a
 * sub-agent whose model is unregistered). Frontmatter is optional (a bare
 * prompt is named after its file, Claude's rule) but must parse when
 * present: Claude degrades an unparseable header to a file-named agent with
 * every field ignored, and a faithful install is better refused than
 * quietly stripped.
 *
 * `model` is classified into an alias, never a model id (see `ModelHint`).
 * Claude `skills:` names are matched against the plugin's own skills. Every
 * other frontmatter field (`tools`, `disallowedTools`, `effort`, `maxTurns`,
 * `readonly`, `is_background`, `memory`, `isolation`, ...) is a warning,
 * once per field per agent: they configure the IDE's loop, not the
 * sub-agent's prompt.
 */

import type { ManifestSet } from "../detect.js";
import { readText } from "../documents.js";
import { basename, comparePaths, joinPath, type PluginFileIndex } from "../files.js";
import { extractFrontmatter, parseFrontmatter } from "../frontmatter.js";
import type { Findings } from "../messages.js";
import type { ModelAlias, ModelHint, PluginSkill, PluginSubAgent } from "../types.js";

export const DEFAULT_AGENTS_DIR = "agents";

/** The proto's `SubAgent.instructions` `min_len`. */
export const SUB_AGENT_INSTRUCTIONS_MIN = 10;

const READ_FIELDS: ReadonlySet<string> = new Set(["name", "description", "model", "skills"]);

export function normaliseSubAgents(
  index: PluginFileIndex,
  set: ManifestSet,
  skills: readonly PluginSkill[],
  findings: Findings,
): readonly PluginSubAgent[] {
  if (!set.readsAgents) return [];
  const skillNames = new Set(skills.map((skill) => skill.name));
  const agents: PluginSubAgent[] = [];
  const seen = new Set<string>();
  for (const path of discoverAgentFiles(index, set, findings)) {
    const agent = readSubAgent(index, path, skillNames, findings);
    if (agent === undefined) continue;
    if (seen.has(agent.name)) {
      findings.error("sub-agent-name-duplicate", { subject: agent.name, path });
      continue;
    }
    seen.add(agent.name);
    agents.push(agent);
  }
  return agents;
}

function discoverAgentFiles(index: PluginFileIndex, set: ManifestSet, findings: Findings): readonly string[] {
  const files = new Set<string>();
  const addMarkdownUnder = (dir: string): void => {
    for (const name of index.childFiles(dir)) {
      if (name.endsWith(".md")) files.add(joinPath(dir, name));
    }
  };

  const declared = set.manifests.flatMap((m) => m.agentPaths ?? []);
  if (set.manifests.every((m) => m.agentPaths === undefined)) {
    addMarkdownUnder(DEFAULT_AGENTS_DIR);
  }
  for (const { path, manifest } of declared) {
    if (path !== "" && index.has(path) && path.endsWith(".md")) {
      files.add(path);
    } else if (index.isDirectory(path)) {
      addMarkdownUnder(path);
    } else {
      findings.warn("path-missing", { path: manifest, subject: path === "" ? "." : `./${path}` });
    }
  }
  return [...files].sort(comparePaths);
}

function readSubAgent(
  index: PluginFileIndex,
  path: string,
  skillNames: ReadonlySet<string>,
  findings: Findings,
): PluginSubAgent | undefined {
  const text = readText(index, path, "subAgent", findings);
  if (text === undefined) return undefined;

  const extracted = extractFrontmatter(text);
  let fieldsMap: Readonly<Record<string, unknown>> = {};
  let body = text;
  if (extracted.ok) {
    const parsed = parseFrontmatter(extracted.yaml);
    if (!parsed.ok) {
      findings.error("sub-agent-frontmatter-unreadable", { path, detail: parsed.detail });
      return undefined;
    }
    fieldsMap = parsed.fields;
    body = extracted.body;
  } else if (extracted.reason === "unclosed") {
    findings.error("sub-agent-frontmatter-unreadable", { path, detail: "the frontmatter is not closed (missing the closing '---')" });
    return undefined;
  }

  const stem = basename(path).replace(/\.md$/, "");
  let name: string;
  if (typeof fieldsMap["name"] === "string" && fieldsMap["name"] !== "") {
    name = fieldsMap["name"];
  } else {
    name = stem;
    findings.warn("sub-agent-name-defaulted", { path, subject: name });
  }

  const instructions = body.trim();
  if (instructions.length < SUB_AGENT_INSTRUCTIONS_MIN) {
    findings.error("sub-agent-instructions-short", { path, subject: name, detail: String(SUB_AGENT_INSTRUCTIONS_MIN) });
    return undefined;
  }

  const description = fieldsMap["description"];
  const requested = fieldsMap["skills"];
  const matchedSkills: string[] = [];
  if (Array.isArray(requested)) {
    for (const skill of requested) {
      if (typeof skill !== "string") continue;
      if (skillNames.has(skill)) matchedSkills.push(skill);
      else findings.warn("sub-agent-skill-unknown", { path, subject: name, detail: skill });
    }
  }

  let modelHint: ModelHint | undefined;
  const model = fieldsMap["model"];
  if (typeof model === "string" && model.trim() !== "") {
    modelHint = classifyModel(model);
    if (modelHint.alias === "unknown") findings.warn("sub-agent-model-unknown", { path, subject: name, detail: model });
  }

  for (const field of Object.keys(fieldsMap)) {
    if (!READ_FIELDS.has(field)) findings.warn("sub-agent-field-ignored", { path, subject: name, detail: field });
  }

  return {
    name,
    ...(typeof description === "string" && description !== "" && { description }),
    instructions,
    skillNames: matchedSkills,
    ...(modelHint !== undefined && { modelHint }),
    path,
  };
}

/**
 * A dialect's `model` value to an alias. Cursor writes `fast` and
 * `inherit`; Claude writes `sonnet`, `opus`, `haiku`, `inherit` or a full
 * model id, which contains one of those family names. Anything else
 * (Cursor's `grok-4.6[effort=xhigh]`, a vendor id Stigmer does not serve)
 * is `unknown` with the raw text kept for the installer's warning.
 */
export function classifyModel(raw: string): ModelHint {
  const value = raw.trim().toLowerCase();
  const alias: ModelAlias =
    value === "inherit"
      ? "inherit"
      : value === "fast"
        ? "fast"
        : value.includes("haiku")
          ? "haiku"
          : value.includes("sonnet")
            ? "sonnet"
            : value.includes("opus")
              ? "opus"
              : "unknown";
  return { raw, alias };
}
