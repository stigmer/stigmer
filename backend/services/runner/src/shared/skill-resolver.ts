/**
 * Resolves skill resources: their metadata for the prompt, the exact
 * version the turn reads, and, for a conversation with a computer, their
 * files on disk.
 *
 * - Fetches skills via gRPC (by reference), on every execution, which keeps
 *   latest-version freshness
 * - Returns metadata for prompt injection, each beside a reference to the
 *   exact version loaded (the run's record of what it loaded) and the
 *   source the turn's reader serves its files from (`archive-reader.ts`)
 * - With a computer (`mount` given), mounts each skill as a tree
 *   (`skill-mount.ts`, `archive-tree.ts`): out of the agent's reach where
 *   the runner separates, held to its archive at every turn start
 *   elsewhere, the archive cached and verified by its SHA-256 so a turn
 *   downloads it only when the cache no longer verifies; and ensures the
 *   workspace `.stigmer` link (`workspace/stigmer-link.ts`)
 * - Without one, writes nothing: nothing in such a conversation can run a
 *   skill's scripts, and its file tools read the skill from the store
 *
 * A turn-runtime phase (`harness/turn-context.ts` `mountSkills`): it reads
 * the control plane, which only the runtime holds, and writes under the
 * platform dir the runtime owns; the harness renders the returned metadata
 * into its prompt in its own placement (#1070). This is the one skills path
 * for every harness.
 */

import { agentFs } from "./agent-fs.js";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import type { StigmerClient } from "../client/stigmer-client.js";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import type { Skill } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { getPlatformDir } from "./workspace/platform-dir.js";
import { SKILLS_SUBDIR, downloadArtifact, skillTreeEntries } from "./skill-mount.js";
import { cachedArchive, keepArchive, placeArchiveTree, sha256Hex, skillTreeKey } from "./archive-tree.js";
import type { ArchiveSource } from "./archive-reader.js";
import { ensureStigmerSymlink, STIGMER_LOCAL_STATE_DIR } from "./workspace/stigmer-link.js";

/** One mounted skill as a prompt renders it: its name, its description, and the workspace-relative path of its SKILL.md. */
export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
}

/**
 * One resolved skill: what the prompt renders, the skill by id at the
 * version hash resolved (empty for a skill whose last version failed to
 * archive), where the turn's reader serves its files from, and, when it was
 * mounted, its tree's key and cached archive (the platform hold keeps them).
 * A skill that did not resolve yields none of them.
 */
export interface ResolvedSkill {
  readonly metadata: SkillMetadata;
  readonly loaded: ApiResourceReference;
  readonly source: ArchiveSource;
  readonly mounted?: { readonly treeKey: string; readonly archive: string | undefined };
}

export interface SkillResolverOptions {
  sessionId: string;
  primaryWorkspaceDir: string;
  /** Whether to put the skills on disk: a conversation with a computer (`computer.ts` `hasComputer`). */
  mount: boolean;
}

/**
 * Resolve skill references into prompt metadata and reader sources, and,
 * with `mount`, trees under
 * ~/.stigmer/sessions/{sessionId}/platform/skills/{name}
 * with a symlink from {workspace}/.stigmer -> the platform dir.
 */
export async function resolveSkills(
  client: StigmerClient,
  skillRefs: ApiResourceReference[],
  options: SkillResolverOptions,
): Promise<ResolvedSkill[]> {
  console.log(
    `[resolveSkills] sessionId=${options.sessionId}, mount=${options.mount}, ` +
    `skillRefCount=${skillRefs.length}, ` +
    `refs=[${skillRefs.map(r => `${r.org || "(default)"}/${r.slug}`).join(", ")}]`,
  );

  if (skillRefs.length === 0) return [];

  const platformDir = getPlatformDir(options.sessionId);
  if (options.mount) {
    await agentFs().mkdir(join(platformDir, SKILLS_SUBDIR), { recursive: true });
    await ensureStigmerSymlink(options.primaryWorkspaceDir, platformDir);
  }

  const results: ResolvedSkill[] = [];

  for (const ref of skillRefs) {
    try {
      const skill = await client.getSkillByReference(ref);
      const spec = skill.spec;
      if (!spec?.skillMd) {
        console.warn(`[resolveSkills] skill ${ref.org}/${ref.slug} fetched but had no skillMd content`);
        continue;
      }

      const name = spec.name || skill.metadata?.slug || "unknown";
      const versionHash = skill.status?.versionHash ?? "";
      const storageKey = skill.status?.artifactStorageKey ?? "";
      const resolved: ResolvedSkill = {
        metadata: {
          name,
          description: spec.description || `Skill: ${name}`,
          path: join(STIGMER_LOCAL_STATE_DIR, SKILLS_SUBDIR, name, "SKILL.md"),
        },
        loaded: create(ApiResourceReferenceSchema, {
          org: skill.metadata?.org ?? "",
          kind: ApiResourceKind.skill,
          id: skill.metadata?.id ?? "",
          version: versionHash,
        }),
        source: {
          kind: "skill",
          dir: `${SKILLS_SUBDIR}/${name}`,
          id: skill.metadata?.id ?? "",
          version: versionHash,
          hasArchive: storageKey !== "",
          skillMd: spec.skillMd,
        },
      };

      if (!options.mount) {
        results.push(resolved);
        continue;
      }
      const mounted = await mountSkill(client, skill, name, platformDir, options.sessionId);
      results.push({ ...resolved, mounted });
      console.log(`[resolveSkills] mounted skill: ${name} -> ${resolved.metadata.path}`);
    } catch (err) {
      console.warn(
        `[resolveSkills] failed to resolve skill ${ref.org}/${ref.slug}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.log(
    `[resolveSkills] completed: ${results.length}/${skillRefs.length} skills resolved`,
  );

  return results;
}

/**
 * One skill's tree at `skills/<name>`, from its cached archive or a fresh
 * download. A download that fails degrades, LOUD (#675), to SKILL.md alone:
 * the session still gets the skill's instructions (better than a dead run),
 * and the next turn retries the download, since nothing was cached.
 */
async function mountSkill(
  client: StigmerClient,
  skill: Skill,
  name: string,
  platformDir: string,
  sessionId: string,
): Promise<{ readonly treeKey: string; readonly archive: string | undefined }> {
  const storageKey = skill.status?.artifactStorageKey ?? "";
  const archiveSha = archiveHashOf(storageKey);
  let artifact: Uint8Array | undefined;
  if (storageKey !== "") {
    try {
      artifact =
        archiveSha === undefined
          ? await downloadArtifact(client, storageKey)
          : await cachedArchive(platformDir, archiveSha, () => downloadArtifact(client, storageKey));
    } catch (err) {
      console.error(
        `[resolveSkills] artifact download FAILED for ${skill.metadata?.org ?? "(default)"}/${skill.metadata?.slug ?? name} ` +
        `(key=${storageKey}) — mounting SKILL.md WITHOUT the skill's ` +
        `supporting files (scripts/references will be missing): ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  const { entries, cacheable } = await skillTreeEntries(skill, artifact);
  const kept = artifact !== undefined && archiveSha !== undefined ? archiveSha : undefined;
  if (kept !== undefined) await keepArchive(platformDir, kept, artifact!, cacheable);
  const tree = await placeArchiveTree({
    linkPath: join(platformDir, SKILLS_SUBDIR, name),
    sessionId,
    key: skillTreeKey(artifact === undefined ? undefined : (archiveSha ?? sha256Hex(artifact)), skill.spec?.skillMd ?? ""),
    entries,
    label: "skill artifact",
  });
  return { treeKey: tree.key, archive: cacheable ? kept : undefined };
}

/** The content hash a skill's storage key names (`skills/<sha256>.zip`), which its cached archive must match. */
function archiveHashOf(storageKey: string): string | undefined {
  return /(?:^|\/)([0-9a-f]{64})\.zip$/.exec(storageKey)?.[1];
}
