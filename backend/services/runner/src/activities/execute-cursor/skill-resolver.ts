/**
 * Resolves skill resources and writes them to the platform-managed directory.
 *
 * - Fetches skills via gRPC (by reference)
 * - Mounts each skill via the shared skill-mount mechanics (SKILL.md +
 *   extracted artifact, hash-keyed cache — see shared/skill-mount.ts)
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

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { StigmerClient } from "../../client/stigmer-client.js";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { SkillMetadata } from "./prompt-builder.js";
import { getPlatformDir } from "../../shared/workspace/platform-dir.js";
import {
  SKILLS_SUBDIR,
  mountIsFresh,
  downloadArtifact,
  writeSkillMount,
} from "../../shared/skill-mount.js";
import { ensureStigmerSymlink, STIGMER_LOCAL_STATE_DIR } from "../../shared/workspace/stigmer-link.js";

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
          artifactBytes = await downloadArtifact(client, skill.status!.artifactStorageKey);
        } catch (err) {
          // Deliberate degradation, but LOUD (#675): the session still gets
          // SKILL.md (better than a dead run), yet a skill silently missing
          // its scripts/references was exactly how oversized artifacts hid.
          console.error(
            `[resolveSkills] artifact download FAILED for ${ref.org || "(default)"}/${ref.slug} ` +
            `(key=${skill.status!.artifactStorageKey}) — mounting SKILL.md WITHOUT the skill's ` +
            `supporting files (scripts/references will be missing): ${err instanceof Error ? err.message : err}`,
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
