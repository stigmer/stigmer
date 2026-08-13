/**
 * Resolves skill resources and writes them to the platform-managed directory.
 *
 * - Fetches skills via gRPC (by reference)
 * - Writes SKILL.md to .stigmer/skills/{name}/SKILL.md
 * - Downloads and extracts ZIP artifacts (references/, scripts/, etc.)
 * - Uses a platform-managed directory outside the workspace
 * - Ensures the workspace `.stigmer` symlink (see stigmer-link.ts)
 * - Returns metadata for prompt injection
 *
 * The mount is cached by the skill's content-addressed version hash
 * (stigmer/stigmer#672): metadata is fetched on every execution (that keeps
 * latest-version freshness), but the artifact download and file rewrite are
 * skipped when the mounted content's hash already matches. The session's
 * platform dir survives across executions, so on an active session every
 * message after the first pays a metadata read instead of a full artifact
 * transfer.
 */

import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { StigmerClient } from "../../client/stigmer-client.js";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { SkillMetadata } from "./prompt-builder.js";
import { getPlatformDir } from "../../shared/workspace/platform-dir.js";
import { extractZipFileEntries } from "../../shared/zip-extract.js";
import { ensureStigmerSymlink, STIGMER_LOCAL_STATE_DIR } from "../../shared/workspace/stigmer-link.js";

const SKILLS_SUBDIR = "skills";

/**
 * Marker recording what a skill's mount directory currently holds. Written
 * LAST, after every file of the mount landed — a crash mid-write leaves no
 * marker, so the next execution remounts instead of trusting a partial tree.
 */
const MOUNT_MARKER_FILE = ".stigmer-mount.json";

interface MountMarker {
  /** Content-addressed version hash (`Skill.status.version_hash`) of the mounted content. */
  versionHash: string;
  /**
   * Whether the artifact's files are part of the mount. `false` when the
   * skill has no artifact OR when the download failed and the mount fell
   * back to SKILL.md only — the latter makes the next execution retry the
   * download rather than cache the degraded mount.
   */
  artifactMounted: boolean;
}

export interface SkillResolverOptions {
  sessionId: string;
  primaryWorkspaceDir: string;
}

/**
 * Resolve skill references into written SKILL.md files and prompt metadata.
 *
 * Platform mount pattern: skills are written to
 * ~/.stigmer/sessions/{sessionId}/platform/skills/{name}/SKILL.md
 * with a symlink from {workspace}/.stigmer -> the platform dir.
 */
export async function resolveSkills(
  client: StigmerClient,
  skillRefs: ApiResourceReference[],
  options: SkillResolverOptions,
): Promise<SkillMetadata[]> {
  console.log(
    `[resolveSkills] sessionId=${options.sessionId}, ` +
    `primaryWorkspaceDir=${options.primaryWorkspaceDir ?? "(undefined)"}, ` +
    `skillRefCount=${skillRefs.length}, ` +
    `refs=[${skillRefs.map(r => `${r.org || "(default)"}/${r.slug}`).join(", ")}]`,
  );

  if (skillRefs.length === 0) return [];

  const platformDir = getPlatformDir(options.sessionId);
  const skillsDir = join(platformDir, SKILLS_SUBDIR);
  await mkdir(skillsDir, { recursive: true });

  await ensureStigmerSymlink(options.primaryWorkspaceDir, platformDir);
  console.log(
    `[resolveSkills] symlink created: ${join(options.primaryWorkspaceDir, STIGMER_LOCAL_STATE_DIR)} -> ${platformDir}`,
  );

  const results: SkillMetadata[] = [];

  for (const ref of skillRefs) {
    try {
      const skill = await client.getSkillByReference(ref);
      const spec = skill.spec;
      if (!spec?.skillMd) {
        console.warn(`[resolveSkills] skill ${ref.org}/${ref.slug} fetched but had no skillMd content`);
        continue;
      }

      const name = spec.name || skill.metadata?.slug || "unknown";
      const skillDir = join(skillsDir, name);
      const versionHash = skill.status?.versionHash ?? "";
      const wantsArtifact = Boolean(skill.status?.artifactStorageKey);
      const meta: SkillMetadata = {
        name,
        description: spec.description || `Skill: ${name}`,
        path: join(STIGMER_LOCAL_STATE_DIR, SKILLS_SUBDIR, name, "SKILL.md"),
      };

      if (versionHash !== "" && (await mountIsFresh(skillDir, versionHash, wantsArtifact))) {
        results.push(meta);
        console.log(
          `[resolveSkills] mount cache hit: ${name} (version ${versionHash.slice(0, 12)}) — skipping artifact transfer`,
        );
        continue;
      }

      let artifactBytes: Uint8Array | undefined;
      if (wantsArtifact) {
        try {
          const resp = await client.getSkillArtifact(skill.status!.artifactStorageKey);
          if (resp.artifact && resp.artifact.length > 0) {
            artifactBytes = resp.artifact;
          }
        } catch (err) {
          console.warn(
            `[resolveSkills] artifact download failed for ${ref.slug}, ` +
            `falling back to SKILL.md only: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      await writeSkillMount(skill, skillDir, artifactBytes);
      results.push(meta);
      console.log(`[resolveSkills] wrote skill: ${name} -> ${meta.path}`);
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
 * Whether the mount at `skillDir` already holds this version's content.
 *
 * Fresh means: the marker's hash matches AND the mount isn't a degraded
 * SKILL.md-only fallback when the skill does carry an artifact. Any read or
 * parse failure counts as stale — the remount is the safe default.
 */
async function mountIsFresh(skillDir: string, versionHash: string, wantsArtifact: boolean): Promise<boolean> {
  try {
    const raw = await readFile(join(skillDir, MOUNT_MARKER_FILE), "utf-8");
    const marker = JSON.parse(raw) as Partial<MountMarker>;
    return marker.versionHash === versionHash && (marker.artifactMounted === true || !wantsArtifact);
  } catch {
    return false;
  }
}

/**
 * (Re)write a skill's mount directory from scratch.
 *
 * The directory is removed first so files deleted between versions don't
 * linger in the mount, then SKILL.md and the artifact files are written, and
 * the marker is stamped LAST (see MOUNT_MARKER_FILE for the crash-safety
 * contract). SKILL.md always comes from `spec.skillMd` — the server's
 * authoritative copy — never from the zip; both the zip's SKILL.md and any
 * stray marker-named entry are excluded from extraction so the mount's
 * ownership of those two files is unconditional.
 */
async function writeSkillMount(
  skill: Skill,
  skillDir: string,
  artifactBytes: Uint8Array | undefined,
): Promise<void> {
  await rm(skillDir, { recursive: true, force: true });
  await mkdir(skillDir, { recursive: true });

  await writeFile(join(skillDir, "SKILL.md"), skill.spec!.skillMd, "utf-8");

  const artifactMounted = artifactBytes !== undefined && artifactBytes.length > 0;
  if (artifactMounted) {
    const entries = await extractZipFileEntries(artifactBytes, { exclude: ["SKILL.md", MOUNT_MARKER_FILE] });
    for (const entry of entries) {
      const filePath = join(skillDir, entry.path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, entry.content);
    }
  }

  const versionHash = skill.status?.versionHash ?? "";
  if (versionHash !== "") {
    const marker: MountMarker = { versionHash, artifactMounted };
    await writeFile(join(skillDir, MOUNT_MARKER_FILE), JSON.stringify(marker), "utf-8");
  }
}

/**
 * Clean up platform-managed skill directory for a session.
 */
export async function cleanupSkills(sessionId: string): Promise<void> {
  const platformDir = getPlatformDir(sessionId);
  try {
    await rm(platformDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}
