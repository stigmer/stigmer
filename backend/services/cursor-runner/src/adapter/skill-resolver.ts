/**
 * Resolves skill resources and writes them to the platform-managed directory.
 *
 * Replicates the Python agent-runner's SkillWriter pattern:
 * - Fetches skills via gRPC (by reference)
 * - Writes SKILL.md to .stigmer/skills/{name}/SKILL.md
 * - Uses a platform-managed directory outside the workspace
 * - Creates a symlink from the workspace to the platform dir
 * - Returns metadata for prompt injection
 */

import { mkdir, writeFile, symlink, readlink, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import type { StigmerClient } from "../client/stigmer-client.js";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { SkillMetadata } from "./prompt-builder.js";

const STIGMER_LOCAL_STATE_DIR = ".stigmer";
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
  if (skillRefs.length === 0) return [];

  const platformDir = getPlatformDir(options.sessionId);
  const skillsDir = join(platformDir, SKILLS_SUBDIR);
  await mkdir(skillsDir, { recursive: true });

  await ensureStigmerSymlink(options.primaryWorkspaceDir, platformDir);

  const results: SkillMetadata[] = [];

  for (const ref of skillRefs) {
    try {
      const skill = await client.getSkillByReference(ref);
      const meta = await writeSkill(skill, skillsDir, options.primaryWorkspaceDir);
      if (meta) results.push(meta);
    } catch (err) {
      console.warn(
        `Failed to resolve skill ${ref.org}/${ref.slug}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return results;
}

async function writeSkill(
  skill: Skill,
  skillsDir: string,
  workspaceDir: string,
): Promise<SkillMetadata | null> {
  const spec = skill.spec;
  if (!spec?.skillMd) return null;

  const name = spec.name || skill.metadata?.slug || "unknown";
  const skillDir = join(skillsDir, name);
  await mkdir(skillDir, { recursive: true });

  const skillMdPath = join(skillDir, "SKILL.md");
  await writeFile(skillMdPath, spec.skillMd, "utf-8");

  const relativePath = join(STIGMER_LOCAL_STATE_DIR, SKILLS_SUBDIR, name, "SKILL.md");

  return {
    name,
    description: spec.description || `Skill: ${name}`,
    path: relativePath,
  };
}

/**
 * Ensure .stigmer symlink in the workspace points to the platform dir.
 *
 * The Cursor SDK reads files from the workspace CWD, so we need the
 * .stigmer directory to be accessible there. Unlike the Python runner
 * which intercepts file paths, Cursor reads directly from the filesystem.
 */
async function ensureStigmerSymlink(
  workspaceDir: string,
  platformDir: string,
): Promise<void> {
  const linkPath = join(workspaceDir, STIGMER_LOCAL_STATE_DIR);

  try {
    const existing = await readlink(linkPath);
    if (existing === platformDir) return;
    await unlink(linkPath);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      // No existing symlink
    } else if (err.code === "EINVAL") {
      // Exists but is not a symlink — remove the directory
      await rm(linkPath, { recursive: true, force: true });
    } else {
      throw err;
    }
  }

  await symlink(platformDir, linkPath, "dir");
}

function getPlatformDir(sessionId: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  return join(home, ".stigmer", "sessions", sessionId, "platform");
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
