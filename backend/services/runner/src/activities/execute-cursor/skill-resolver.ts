/**
 * Resolves skill resources and writes them to the platform-managed directory.
 *
 * - Fetches skills via gRPC (by reference)
 * - Writes SKILL.md to .stigmer/skills/{name}/SKILL.md
 * - Downloads and extracts ZIP artifacts (references/, scripts/, etc.)
 * - Uses a platform-managed directory outside the workspace
 * - Ensures the workspace `.stigmer` symlink (see stigmer-link.ts)
 * - Returns metadata for prompt injection
 */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { StigmerClient } from "../../client/stigmer-client.js";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { SkillMetadata } from "./prompt-builder.js";
import { getPlatformDir } from "../../shared/workspace/platform-dir.js";
import { extractZipFileEntries } from "../../shared/zip-extract.js";
import { ensureStigmerSymlink, STIGMER_LOCAL_STATE_DIR } from "../../shared/workspace/stigmer-link.js";

const SKILLS_SUBDIR = "skills";

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

      let artifactBytes: Uint8Array | undefined;
      if (skill.status?.artifactStorageKey) {
        try {
          const resp = await client.getSkillArtifact(skill.status.artifactStorageKey);
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

      const meta = await writeSkill(skill, skillsDir, options.primaryWorkspaceDir, artifactBytes);
      if (meta) {
        results.push(meta);
        console.log(`[resolveSkills] wrote skill: ${meta.name} -> ${meta.path}`);
      } else {
        console.warn(`[resolveSkills] skill ${ref.org}/${ref.slug} fetched but had no skillMd content`);
      }
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

async function writeSkill(
  skill: Skill,
  skillsDir: string,
  workspaceDir: string,
  artifactBytes?: Uint8Array,
): Promise<SkillMetadata | null> {
  const spec = skill.spec;
  if (!spec?.skillMd) return null;

  const name = spec.name || skill.metadata?.slug || "unknown";
  const skillDir = join(skillsDir, name);
  await mkdir(skillDir, { recursive: true });

  const skillMdPath = join(skillDir, "SKILL.md");
  await writeFile(skillMdPath, spec.skillMd, "utf-8");

  if (artifactBytes && artifactBytes.length > 0) {
    const entries = await extractZipFileEntries(artifactBytes, { exclude: ["SKILL.md"] });
    for (const entry of entries) {
      const filePath = join(skillDir, entry.path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, entry.content, "utf-8");
    }
  }

  const relativePath = join(STIGMER_LOCAL_STATE_DIR, SKILLS_SUBDIR, name, "SKILL.md");

  return {
    name,
    description: spec.description || `Skill: ${name}`,
    path: relativePath,
  };
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
