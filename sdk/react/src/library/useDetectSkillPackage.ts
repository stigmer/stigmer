"use client";

import { useMemo } from "react";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { useArtifactContent } from "../execution/useArtifactContent";
import {
  detectSkillPackage,
  isSkillPackage,
  type SkillPackageDetection,
} from "./detect-skill-package";

const NOT_DETECTED: SkillPackageDetection = { detected: false } as const;

/** Return value of {@link useDetectSkillPackage}. */
export interface UseDetectSkillPackageReturn {
  /** The detection result — check `detection.detected` to narrow the type. */
  readonly detection: SkillPackageDetection;

  /**
   * `true` while the SKILL.md content is being fetched from the archive.
   * Only relevant when the artifact is a skill package — `false` immediately
   * for non-skill artifacts.
   */
  readonly isLoading: boolean;

  /** Error message from the SKILL.md fetch, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Detects whether an execution artifact is a skill package and extracts
 * its metadata from SKILL.md.
 *
 * Combines the synchronous `isSkillPackage()` check (via `entries`) with
 * a lazy content fetch of the SKILL.md file from the ZIP archive. The
 * SKILL.md content is fetched via the `getArtifactContent` RPC with
 * `entry_path`, so no ZIP download reaches the browser.
 *
 * Pass `null` for either parameter to skip detection entirely.
 *
 * Detection only triggers a network call when the artifact looks like a
 * skill package (`kind === DIRECTORY` with `SKILL.md` in `entries`).
 * For all other artifacts, returns `{ detected: false }` immediately.
 *
 * @param artifact - The execution artifact to inspect, or `null` to skip.
 * @param executionId - Execution that produced the artifact, or `null` to skip.
 *
 * @example
 * ```tsx
 * const { detection, isLoading } = useDetectSkillPackage(artifact, executionId);
 *
 * if (isLoading) return <Spinner />;
 *
 * if (detection.detected) {
 *   return (
 *     <div>
 *       <Badge>Skill Package</Badge>
 *       <span>{detection.skillName}</span>
 *       <span>{detection.fileCount} files</span>
 *     </div>
 *   );
 * }
 * ```
 *
 * @see {@link isSkillPackage} for the synchronous check (no content needed)
 * @see {@link detectSkillPackage} for the pure function (non-React usage)
 */
export function useDetectSkillPackage(
  artifact: ExecutionArtifact | null,
  executionId: string | null,
): UseDetectSkillPackageReturn {
  const isPackage = artifact ? isSkillPackage(artifact) : false;

  const { content, isLoading, error } = useArtifactContent(
    isPackage && executionId ? executionId : null,
    isPackage && artifact ? artifact.storageKey : null,
    isPackage ? "SKILL.md" : null,
  );

  const detection = useMemo<SkillPackageDetection>(() => {
    if (!artifact || !isPackage || !content) {
      return NOT_DETECTED;
    }
    return detectSkillPackage(artifact, content);
  }, [artifact, isPackage, content]);

  return {
    detection,
    isLoading: isPackage && isLoading,
    error: isPackage ? error : null,
  };
}
