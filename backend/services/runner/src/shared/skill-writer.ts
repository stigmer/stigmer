/**
 * Skill mounting and prompt generation for the deep-agent execution path.
 *
 * Follows the Agent Skills specification progressive disclosure model:
 *
 * 1. Metadata (startup) — skill name + description injected into
 *    the system prompt so the agent knows which skills are available.
 * 2. Instructions (activation) — the agent reads SKILL.md from the
 *    filesystem when it decides to activate a skill.
 * 3. Resources (on demand) — scripts, references, and assets are
 *    loaded by the agent only when required.
 *
 * Skills physically live in the session's platform directory
 * (`{platformDir}/skills/{name}/` — the SAME location the Cursor harness
 * mounts into), and the agent sees them as `.stigmer/skills/{name}/`
 * through the per-turn workspace symlink (see workspace/stigmer-link.ts).
 * Returned paths are the agent-visible `.stigmer/…` form.
 *
 * Mounts are cached by the skill's content-addressed version hash via the
 * shared skill-mount mechanics (issue #337, mirroring the Cursor harness's
 * #672 fix): metadata is fetched every execution — a pushed skill update
 * still lands on the very next message — but an unchanged skill skips the
 * artifact download and rewrite entirely.
 */

import { join } from "node:path";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { StigmerClient } from "../client/stigmer-client.js";
import {
  SKILLS_SUBDIR,
  mountIsFresh,
  downloadArtifact,
  writeSkillMount,
} from "./skill-mount.js";
import { STIGMER_LOCAL_STATE_DIR } from "./workspace/stigmer-link.js";

/** Agent-visible base of the skills tree (via the workspace `.stigmer` symlink). */
const SKILLS_RELATIVE_BASE = `${STIGMER_LOCAL_STATE_DIR}/${SKILLS_SUBDIR}`;

// ─── Types ───────────────────────────────────────────────────────────────

export interface SkillPathMap {
  /** Map from skill metadata ID to workspace-relative directory path. */
  readonly paths: ReadonlyMap<string, string>;
}

// ─── Fetch ───────────────────────────────────────────────────────────────

/**
 * Merge skill refs from agent and session specs (union, dedup by slug,
 * session wins on collision).
 */
export function mergeSkillRefs(
  agentRefs: readonly ApiResourceReference[],
  sessionRefs: readonly ApiResourceReference[],
): ApiResourceReference[] {
  const bySlug = new Map<string, ApiResourceReference>();
  for (const ref of agentRefs) {
    if (ref.slug) bySlug.set(ref.slug, ref);
  }
  for (const ref of sessionRefs) {
    if (ref.slug) bySlug.set(ref.slug, ref);
  }
  return [...bySlug.values()];
}

/**
 * Fetch all skills by their ApiResourceReference. Failures for individual
 * skills are logged and skipped (non-fatal).
 */
export async function fetchSkillsByRefs(
  client: StigmerClient,
  refs: readonly ApiResourceReference[],
): Promise<Skill[]> {
  if (refs.length === 0) return [];

  const results: Skill[] = [];
  const fetches = refs.map(async (ref) => {
    try {
      return await client.getSkillByReference(ref);
    } catch (err) {
      console.warn(
        `[skill-writer] Failed to fetch skill ${ref.org}/${ref.slug}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  });

  const settled = await Promise.all(fetches);
  for (const skill of settled) {
    if (skill) results.push(skill);
  }
  return results;
}

// ─── Mount ───────────────────────────────────────────────────────────────

/**
 * Mount skills into the session's platform directory, downloading each
 * skill's artifact only on a version-hash cache miss (see skill-mount.ts
 * for the marker mechanics). Returns a map of skill-id -> agent-visible
 * directory path.
 *
 * The returned map is a NAMING function, not a success record: every skill
 * gets its path entry so prompt generation stays total, while mount
 * failures degrade that one skill (loud log, no throw) — one broken skill
 * must never kill the run.
 *
 * Skills mount in parallel (each owns an independent directory), EXCEPT
 * when two skills resolve to the same directory name (same `spec.name`
 * from different orgs): concurrent remove-and-rewrite passes on one
 * directory would corrupt the mount, so only the first claimant mounts and
 * the collision is logged loudly. (The sequential code this replaced
 * silently let the last writer win — no better, just quieter.)
 */
export async function mountSkills(
  client: StigmerClient,
  skills: readonly Skill[],
  platformDir: string,
): Promise<SkillPathMap> {
  const paths = new Map<string, string>();
  const claims = new Map<string, Skill>();

  for (const skill of skills) {
    const name = skill.spec?.name || skill.metadata?.slug || "unknown";
    const skillId = skill.metadata?.id ?? name;
    paths.set(skillId, `${SKILLS_RELATIVE_BASE}/${name}`);

    // Impossible through the push pipeline (push.go hard-fails a ZIP
    // without an extractable SKILL.md and always populates spec.skill_md),
    // so an empty skillMd means a broken resource — skip, same as Cursor.
    if (!skill.spec?.skillMd) {
      console.warn(
        `[skill-writer] skill ${name} (${skillId}) has no skillMd content — skipping mount`,
      );
      continue;
    }

    const prev = claims.get(name);
    if (prev) {
      console.warn(
        `[skill-writer] mount directory collision on '${name}': ` +
        `${prev.metadata?.org}/${prev.metadata?.slug} already claims it, ` +
        `skipping ${skill.metadata?.org}/${skill.metadata?.slug}`,
      );
      continue;
    }
    claims.set(name, skill);
  }

  await Promise.all([...claims.entries()].map(async ([name, skill]) => {
    const skillDir = join(platformDir, SKILLS_SUBDIR, name);
    try {
      const versionHash = skill.status?.versionHash ?? "";
      const wantsArtifact = Boolean(skill.status?.artifactStorageKey);

      if (versionHash !== "" && (await mountIsFresh(skillDir, versionHash, wantsArtifact))) {
        console.log(
          `[skill-writer] mount cache hit: ${name} (version ${versionHash.slice(0, 12)}) — skipping artifact transfer`,
        );
        return;
      }

      let artifactBytes: Uint8Array | undefined;
      if (wantsArtifact) {
        try {
          artifactBytes = await downloadArtifact(client, skill.status!.artifactStorageKey);
        } catch (err) {
          // Deliberate degradation, but LOUD (#675): the run still gets
          // SKILL.md, and the marker records artifactMounted=false so the
          // next execution retries the download.
          console.error(
            `[skill-writer] artifact download FAILED for ${name} ` +
            `(key=${skill.status!.artifactStorageKey}) — mounting SKILL.md WITHOUT the skill's ` +
            `supporting files (scripts/references will be missing): ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      await writeSkillMount(skill, skillDir, artifactBytes);
      console.log(`[skill-writer] wrote skill mount: ${name}`);
    } catch (err) {
      console.warn(
        `[skill-writer] failed to mount skill ${name}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }));

  return { paths };
}

// ─── Prompt generation ───────────────────────────────────────────────────

/**
 * Generate the system prompt section following the Agent Skills spec
 * progressive disclosure model.
 *
 * Only metadata (name + description + location) is injected. The agent
 * reads SKILL.md on demand via filesystem tools.
 */
export function generatePromptSection(
  skills: readonly Skill[],
  skillPaths: ReadonlyMap<string, string>,
): string {
  if (skills.length === 0) return "";

  const lines: string[] = [
    "",
    "",
    "## Skills",
    "",
    "You have access to the following skills. Each skill provides specialized " +
    "knowledge or capabilities.",
    "",
    "**Activation protocol**: To use a skill, read its SKILL.md file " +
    "using the `read` tool. The SKILL.md contains detailed instructions, " +
    "available tools, and usage examples.",
    "",
    "**Usage pattern**:",
    "",
    "1. Review the skill description below to determine relevance",
    "2. Read `{location}/SKILL.md` for full instructions",
    "3. Follow the skill's documented operations:",
    "",
    "`read {location}/references/schema.md`",
    '`execute("python3 {location}/scripts/run.py")`',
    "",
  ];

  for (const skill of skills) {
    const name = skill.spec?.name || skill.metadata?.slug || "unknown";
    const skillId = skill.metadata?.id ?? name;
    const skillDir = skillPaths.get(skillId) ?? `${SKILLS_RELATIVE_BASE}/${name}`;
    const description = skill.spec?.description || "(no description)";

    lines.push(`### ${name}`);
    lines.push(`**Description**: ${description}`);
    lines.push(`**Location**: \`${skillDir}/\``);
    lines.push(`**Activate**: \`read ${skillDir}/SKILL.md\``);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate a brief note listing skills excluded by relevance filtering.
 *
 * The agent can still request these skills by name if it determines
 * they are needed mid-conversation.
 */
export function generateAlsoAvailableSection(
  excludedNames: readonly string[],
): string {
  if (excludedNames.length === 0) return "";

  const namesStr = excludedNames.map(n => `\`${n}\``).join(", ");
  return (
    "\n### Also Available\n\n" +
    `These skills are installed but were not highlighted above: ${namesStr}. ` +
    "If you determine one of them is relevant to your task, " +
    "read its SKILL.md at `.stigmer/skills/<name>/SKILL.md` to activate it.\n"
  );
}
