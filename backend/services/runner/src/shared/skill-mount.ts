/**
 * Skill mount mechanics — the ONE shape a skill's files take on disk, shared
 * by both harnesses, for a conversation with a computer, whose commands may
 * run a skill's scripts.
 *
 * A skill "mount" is `{platformDir}/skills/{name}`: SKILL.md plus the
 * artifact's supporting files, as a tree out of the agent's reach where the
 * runner separates, and held to the archive at every turn start elsewhere
 * (`archive-tree.ts`); the archive is cached, verified by its SHA-256, under
 * `{platformDir}/archives/` (`archive-tree.ts` `cachedArchive`). Metadata is
 * fetched every execution (push a skill update and the very next message
 * picks it up); the download is skipped while the cached archive still
 * verifies. Every harness reads the same physical location: the Claude
 * engine through the workspace link, the shell too; the Stigmer engine's
 * file tools read a skill's text from the store instead
 * (`execute-deep-agent/store-content-backend.ts`).
 *
 * This module owns the tree's contents ({@link skillTreeEntries}): SKILL.md
 * from the spec, the archive's other files, a plugin root skill's eval suite
 * left out. Orchestration — which skills to mount, prompt metadata,
 * degradation logging — stays with the resolver (`skill-resolver.ts`).
 *
 * Also the one statement of where a skill's files live under the platform
 * dir ({@link SKILL_CONTENT_PATTERN}), which both harnesses' confined reads
 * consult when a turn's tool lists deny `Skill`, each by the real path the
 * read would open ({@link skillContentReadCheck}).
 */

import { agentFs } from "./agent-fs.js";
import * as fs from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import type { StigmerClient } from "../client/stigmer-client.js";
import type { Skill } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { extractZipFileEntries, type ZipFileEntry } from "./zip-extract.js";
import { downloadArchive } from "./archive-mount.js";
import { holdsPluginManifest, manifestEvalDir, withoutEvalSuite } from "./plugin-mount.js";
import { STIGMER_LOCAL_STATE_DIR } from "./workspace/stigmer-link.js";

/** Subdirectory of the platform dir where skill mounts live. */
export const SKILLS_SUBDIR = "skills";

/**
 * A skill's files, as a path relative to the platform dir in posix form: a
 * mounted skill (`skills/<name>/…`), anything under `plugins/`, a mounted
 * plugin's tree (`plugin-mount.ts`), or a cached archive of either
 * (`archives/`, `archive-tree.ts`). The
 * whole tree counts because a manifest may declare its skills anywhere in
 * the package and a root skill is the package itself; the tree is there
 * for the plugin's hooks, which run it as processes, never for the agent
 * to read. A turn whose tool lists deny `Skill` is refused a read of any of
 * them, on both engines. Matched without regard to case: on a case-insensitive filesystem
 * `Skills/a/SKILL.md` is the same file, and on any other the platform dir
 * holds no such name to over-refuse.
 */
export const SKILL_CONTENT_PATTERN = /^(?:skills|plugins|archives)(?:\/|$)/i;

/** The Stigmer harness's virtual prefix for the platform dir. */
const PLATFORM_PREFIX = `/${STIGMER_LOCAL_STATE_DIR}/`;

/** Whether a canonical virtual path (`/.stigmer/…`, the Stigmer harness's) names a skill's files. */
export function isSkillContentPath(virtualPath: string): boolean {
  const normalized = posix.normalize(virtualPath);
  return normalized.toLowerCase().startsWith(PLATFORM_PREFIX) && SKILL_CONTENT_PATTERN.test(normalized.slice(PLATFORM_PREFIX.length));
}

/**
 * Whether a Stigmer-harness `read_file` of this canonical virtual path would open a
 * skill's files: by its text ({@link isSkillContentPath}), or, for a path
 * under `.stigmer/`, by the real path it resolves to: inside the platform
 * dir, where {@link SKILL_CONTENT_PATTERN} names it, or inside `treesDir`,
 * the session's runner-owned trees (`archive-tree.ts` `sessionTreesDir`),
 * which hold nothing but skills and plugins, so any path there is one. The
 * Stigmer harness's route follows a link that stays inside the platform dir
 * (`execute-deep-agent/platform-route.ts`), so a link a plugin's hook leaves
 * under `plugin-data/` pointing into `skills/` reads the skill unless its
 * real path is judged; a mounted skill is itself a link into `treesDir`
 * where the runner separates.
 * Compared without regard to case, as the pattern is. A path that does not
 * resolve (nothing there, a dangling link) opens nothing and is not
 * refused here. Costs a few `realpath` calls, and only on a turn that denies
 * `Skill`. Without a platform dir there is nothing to resolve against.
 */
export function skillContentReadCheck(platformDir: string | undefined, treesDir?: string): (virtualPath: string) => Promise<boolean> {
  return async (virtualPath) => {
    if (isSkillContentPath(virtualPath)) return true;
    const normalized = posix.normalize(virtualPath);
    if (platformDir === undefined || !normalized.toLowerCase().startsWith(PLATFORM_PREFIX)) return false;
    let target: string;
    try {
      target = (await agentFs().realpath(join(platformDir, normalized.slice(PLATFORM_PREFIX.length)))).toLowerCase();
    } catch {
      return false;
    }
    const root = await agentFs().realpath(platformDir).catch(() => undefined);
    if (root !== undefined) {
      const inside = relative(root.toLowerCase(), target).split(sep).join("/");
      if (!inside.startsWith("../") && inside !== ".." && SKILL_CONTENT_PATTERN.test(inside)) return true;
    }
    if (treesDir === undefined) return false;
    const trees = await fs.realpath(treesDir).catch(() => undefined);
    return trees !== undefined && target.startsWith(`${trees.toLowerCase()}${sep}`);
  };
}

/**
 * Download a skill artifact's ZIP bytes over the shared archive transport
 * (`archive-mount.ts` `downloadArchive`: the URL lane). Runs only when the
 * session's cached archive is missing or no longer verifies.
 */
export async function downloadArtifact(
  client: StigmerClient,
  artifactStorageKey: string,
): Promise<Uint8Array | undefined> {
  return downloadArchive(
    { mintDownloadUrl: (key) => client.getSkillArtifactDownloadUrl(key) },
    artifactStorageKey,
  );
}

/**
 * A skill's tree, as entries: SKILL.md from `spec.skillMd` — the server's
 * authoritative copy, which the push guarantees is non-empty — never from
 * the zip, then the artifact's other files, when it has any.
 *
 * A plugin's root skill mounts nothing under the archive's `evals/`, or
 * under the directory the archive's own manifest moves the suite to
 * (`experimental.evals`), matched by its cleaned, root-relative name as the
 * plugin mount matches it (`plugin-mount.ts` `withoutEvalSuite`,
 * `manifestEvalDir`). Its archive is the whole plugin, one stored before
 * the install left the suite out still carries it, and an agent under test
 * must not read the cases it is graded on. A root skill's archive is told
 * by the plugin manifest it always holds (`holdsPluginManifest`). Any other
 * skill keeps its own `evals/`: a skill pushed on its own may keep its
 * tests there (skill-creator's `evals/evals.json`), and a plugin's other
 * skills never hold the plugin's suite, since the install refuses a suite
 * directory that overlaps a skill and leaves each skill's own `evals/` out
 * of its archive. `cacheable` is false when the suite was left out: the
 * cache must be the whole archive, and a command could unzip it.
 */
export async function skillTreeEntries(
  skill: Skill,
  artifactBytes: Uint8Array | undefined,
): Promise<{ readonly entries: readonly ZipFileEntry[]; readonly cacheable: boolean }> {
  const skillMd: ZipFileEntry = { path: "SKILL.md", content: new TextEncoder().encode(skill.spec?.skillMd ?? "") };
  if (artifactBytes === undefined || artifactBytes.length === 0) return { entries: [skillMd], cacheable: true };
  const extracted = await extractZipFileEntries(artifactBytes, { exclude: ["SKILL.md"] });
  const entries = holdsPluginManifest(extracted) ? withoutEvalSuite(extracted, manifestEvalDir(extracted)) : extracted;
  return { entries: [skillMd, ...entries], cacheable: entries.length === extracted.length };
}
