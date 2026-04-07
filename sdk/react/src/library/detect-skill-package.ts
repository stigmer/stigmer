import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { parse as parseYaml } from "yaml";

/**
 * Result of detecting whether an execution artifact is a pushable skill package.
 *
 * Uses a discriminated union on the `detected` field — identical pattern
 * to {@link StigmerResourceDetection} — so consumers can narrow with a
 * simple `if (result.detected)` check.
 *
 * Skill detection is a **parallel** path to YAML resource detection:
 *
 * - **YAML detection** (`detectStigmerResource`): Agents, MCP Servers — applied via `apply()`
 * - **Package detection** (`detectSkillPackage`): Skill packages (directory with SKILL.md) — pushed via `pushFromExecutionArtifact()`
 */
export type SkillPackageDetection =
  | {
      /** Discriminant — `false` when no skill package was detected. */
      readonly detected: false;
    }
  | {
      /** Discriminant — always `true` when a skill package was detected. */
      readonly detected: true;
      /** Skill name extracted from SKILL.md YAML frontmatter. */
      readonly skillName: string;
      /** Optional description from SKILL.md frontmatter. */
      readonly skillDescription: string | undefined;
      /** Number of files in the package archive. */
      readonly fileCount: number;
      /** Relative file paths within the archive (from `ExecutionArtifact.entries`). */
      readonly entries: readonly string[];
    };

const NOT_DETECTED: SkillPackageDetection = { detected: false } as const;

const SKILL_MD_ENTRY = "SKILL.md";

/**
 * Checks whether an execution artifact is a skill package (directory
 * artifact whose archive contains `SKILL.md`).
 *
 * This is a pure, synchronous check that requires no network call — it
 * inspects the `entries` field populated by the agent runner at ZIP
 * creation time.
 *
 * Returns `false` for:
 * - FILE artifacts (regardless of name)
 * - DIRECTORY artifacts without `entries` (older artifacts before this field was added)
 * - DIRECTORY artifacts whose entries do not include `SKILL.md`
 *
 * @param artifact - Artifact from `execution.status.artifacts`.
 *
 * @example
 * ```ts
 * if (isSkillPackage(artifact)) {
 *   // Show "Push Skill" CTA
 * }
 * ```
 */
export function isSkillPackage(artifact: ExecutionArtifact): boolean {
  return (
    artifact.kind === ExecutionArtifactKind.DIRECTORY &&
    artifact.entries.includes(SKILL_MD_ENTRY)
  );
}

/**
 * Detects a skill package and extracts metadata from its SKILL.md content.
 *
 * Call this after fetching the SKILL.md content from the ZIP via
 * `useArtifactContent(executionId, storageKey, "SKILL.md")`. The function
 * parses the YAML frontmatter to extract `name` and `description`.
 *
 * **Resilient by design** — any parse failure, missing field, or unexpected
 * structure returns `{ detected: false }`. This function never throws.
 *
 * @param artifact - The execution artifact (must be a DIRECTORY with SKILL.md in entries).
 * @param skillMdContent - Raw text content of SKILL.md fetched from the archive.
 * @returns A discriminated union with skill metadata when detection succeeds.
 *
 * @example
 * ```ts
 * const { content } = useArtifactContent(executionId, storageKey, "SKILL.md");
 * const detection = detectSkillPackage(artifact, content);
 *
 * if (detection.detected) {
 *   console.log(`Skill: ${detection.skillName} (${detection.fileCount} files)`);
 * }
 * ```
 *
 * @see {@link isSkillPackage} for the lightweight check (no content needed)
 * @see {@link useDetectSkillPackage} for the React hook that automates the full flow
 */
export function detectSkillPackage(
  artifact: ExecutionArtifact,
  skillMdContent: string,
): SkillPackageDetection {
  if (!isSkillPackage(artifact)) {
    return NOT_DETECTED;
  }

  const frontmatter = parseSkillFrontmatter(skillMdContent);
  if (!frontmatter) {
    return NOT_DETECTED;
  }

  return {
    detected: true,
    skillName: frontmatter.name,
    skillDescription: frontmatter.description,
    fileCount: artifact.entries.length,
    entries: artifact.entries,
  };
}

interface SkillFrontmatter {
  readonly name: string;
  readonly description: string | undefined;
}

/**
 * Parses YAML frontmatter from a SKILL.md file.
 *
 * Expects the standard frontmatter format:
 * ```markdown
 * ---
 * name: my-skill-name
 * description: Optional description
 * ---
 * ```
 *
 * Returns `null` when the content has no valid frontmatter or the `name`
 * field is missing/empty.
 */
function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  const fenceMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fenceMatch) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(fenceMatch[1]);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  const name = obj.name;
  if (typeof name !== "string" || name.length === 0) {
    return null;
  }

  const description = typeof obj.description === "string" && obj.description.length > 0
    ? obj.description
    : undefined;

  return { name, description };
}
