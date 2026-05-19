/**
 * Skill writing and prompt generation for the deep-agent execution path.
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
 * Skills live under `.stigmer/skills/{name}/` relative to the workspace root.
 * Returned paths are workspace-relative so that the agent's sandbox backend
 * resolves them correctly regardless of mount strategy.
 */

import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";
import type { WorkspaceBackend } from "./workspace/types.js";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { StigmerClient } from "../client/stigmer-client.js";

const SKILLS_RELATIVE_BASE = ".stigmer/skills";
const SCRIPT_EXTENSIONS = new Set([".sh", ".py", ".js", ".ts", ".rb", ".pl"]);

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

// ─── Write ───────────────────────────────────────────────────────────────

/**
 * Write skill artifacts to the workspace. Returns a map of
 * skill-id -> workspace-relative directory path.
 *
 * For each skill:
 * - If a ZIP artifact is available, extract it to .stigmer/skills/{name}/
 * - Otherwise, write just the SKILL.md from the spec
 * - Make scripts executable
 */
export async function writeSkills(
  skills: readonly Skill[],
  workspaceBackend: WorkspaceBackend,
  artifacts: ReadonlyMap<string, Uint8Array>,
): Promise<SkillPathMap> {
  const paths = new Map<string, string>();

  for (const skill of skills) {
    const name = skill.spec?.name || skill.metadata?.slug || "unknown";
    const skillId = skill.metadata?.id ?? name;
    const relativeDir = `${SKILLS_RELATIVE_BASE}/${name}`;
    paths.set(skillId, relativeDir);

    const artifactBytes = artifacts.get(skillId);
    if (artifactBytes && artifactBytes.length > 0) {
      await extractZipToWorkspace(artifactBytes, relativeDir, workspaceBackend);
    } else if (skill.spec?.skillMd) {
      const skillMdPath = `${relativeDir}/SKILL.md`;
      await workspaceBackend.writeFile(skillMdPath, skill.spec.skillMd);
    }

    await makeScriptsExecutable(relativeDir, workspaceBackend);
  }

  return { paths };
}

/**
 * Compute skill paths without writing anything (for resume integrity checks).
 */
export function computeSkillPaths(skills: readonly Skill[]): Map<string, string> {
  const paths = new Map<string, string>();
  for (const skill of skills) {
    const name = skill.spec?.name || skill.metadata?.slug || "unknown";
    const skillId = skill.metadata?.id ?? name;
    paths.set(skillId, `${SKILLS_RELATIVE_BASE}/${name}`);
  }
  return paths;
}

/**
 * Check workspace integrity for resume fast-path.
 * Returns true if the sentinel SKILL.md file exists for the first skill.
 */
export async function checkSkillIntegrity(
  skills: readonly Skill[],
  workspaceBackend: WorkspaceBackend,
): Promise<boolean> {
  if (skills.length === 0) return true;

  const paths = computeSkillPaths(skills);
  const firstPath = paths.values().next().value;
  if (!firstPath) return true;

  const sentinel = `${firstPath}/SKILL.md`;
  return workspaceBackend.exists(sentinel);
}

// ─── ZIP extraction ──────────────────────────────────────────────────────

/**
 * Extract a ZIP archive into the specified workspace directory.
 *
 * Uses a minimal, dependency-free ZIP parser that handles the local file
 * header format. Supports both stored (method 0) and deflated (method 8) entries.
 */
async function extractZipToWorkspace(
  zipBytes: Uint8Array,
  targetDir: string,
  backend: WorkspaceBackend,
): Promise<void> {
  const entries = parseZipEntries(zipBytes);
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const targetPath = `${targetDir}/${entry.name}`;
    const content = await decompressEntry(entry);
    await backend.writeFile(targetPath, content);
  }
}

interface ZipEntry {
  name: string;
  isDirectory: boolean;
  compressedData: Uint8Array;
  compressionMethod: number;
  uncompressedSize: number;
}

function parseZipEntries(data: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  while (offset < data.length - 4) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break; // Local file header signature

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraFieldLength = view.getUint16(offset + 28, true);

    const fileNameStart = offset + 30;
    const fileName = new TextDecoder().decode(
      data.subarray(fileNameStart, fileNameStart + fileNameLength),
    );

    const dataStart = fileNameStart + fileNameLength + extraFieldLength;
    const compressedData = data.subarray(dataStart, dataStart + compressedSize);

    entries.push({
      name: fileName,
      isDirectory: fileName.endsWith("/"),
      compressedData,
      compressionMethod,
      uncompressedSize,
    });

    offset = dataStart + compressedSize;
  }

  return entries;
}

async function decompressEntry(entry: ZipEntry): Promise<string> {
  if (entry.compressionMethod === 0) {
    return new TextDecoder().decode(entry.compressedData);
  }

  if (entry.compressionMethod === 8) {
    return new Promise<string>((resolve, reject) => {
      const inflate = createInflateRaw();
      const chunks: Buffer[] = [];
      inflate.on("data", (chunk: Buffer) => chunks.push(chunk));
      inflate.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      inflate.on("error", reject);
      inflate.end(Buffer.from(entry.compressedData));
    });
  }

  throw new Error(`Unsupported ZIP compression method: ${entry.compressionMethod}`);
}

async function makeScriptsExecutable(
  relativeDir: string,
  backend: WorkspaceBackend,
): Promise<void> {
  const extensions = [...SCRIPT_EXTENSIONS].map(ext => `-name '*${ext}'`).join(" -o ");
  const cmd = `find ${relativeDir} -type f \\( ${extensions} \\) -exec chmod +x {} \\; 2>/dev/null || true`;
  try {
    await backend.execute(cmd);
  } catch {
    // Non-fatal: scripts may not be executable in all environments
  }
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

// ─── Artifact fetching ───────────────────────────────────────────────────

/**
 * Download skill artifacts for all skills that have a storage key.
 * Returns a map from skill ID to artifact bytes.
 */
export async function fetchSkillArtifacts(
  client: StigmerClient,
  skills: readonly Skill[],
): Promise<Map<string, Uint8Array>> {
  const artifacts = new Map<string, Uint8Array>();

  const fetches = skills
    .filter(s => s.status?.artifactStorageKey)
    .map(async (skill) => {
      const key = skill.status!.artifactStorageKey;
      const skillId = skill.metadata?.id ?? skill.spec?.name ?? "unknown";
      try {
        const response = await client.getSkillArtifact(key);
        if (response.artifact && response.artifact.length > 0) {
          artifacts.set(skillId, response.artifact);
        }
      } catch (err) {
        console.warn(
          `[skill-writer] Failed to download artifact for ${skill.spec?.name}: ` +
          `${err instanceof Error ? err.message : String(err)}. Falling back to SKILL.md only.`,
        );
      }
    });

  await Promise.all(fetches);
  return artifacts;
}
