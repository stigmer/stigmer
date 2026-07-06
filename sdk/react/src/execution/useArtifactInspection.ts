"use client";

import { useCallback, useMemo, useState } from "react";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { useArtifactContent } from "./useArtifactContent.js";
import { isTextArtifact } from "./artifact-utils.js";
import { useDetectStigmerResource } from "../library/useDetectStigmerResource.js";
import { useDetectSkillPackage } from "../library/useDetectSkillPackage.js";
import type { SkillPackageDetection } from "../library/detect-skill-package.js";
import {
  useApplyResource,
  type ApplyResourceResult,
} from "../library/useApplyResource.js";

const COPIED_FEEDBACK_MS = 2000;

/** Options for {@link useArtifactInspection}. */
export interface UseArtifactInspectionOptions {
  /**
   * Cross-mount cache key for the content fetch (DD-014). Set it so a remount
   * with the same key renders the previously-fetched content instantly and
   * refetches in the background — the artifact document passes it so switching
   * back to a recently-viewed tab is instant. Omit for fetch-on-mount (the
   * modal, which resets on every open).
   */
  readonly cacheKey?: string;
  /**
   * Called after a resource is successfully applied or a skill package pushed.
   * The consumer uses it for post-apply behavior (toast, navigate to Library).
   */
  readonly onApplied?: (result: ApplyResourceResult) => void;
}

/**
 * Everything a chrome (the modal action bar, the document toolbar, the content
 * body) needs to inspect and act on one artifact: fetched content, resource
 * detection, the Apply/Push action, and clipboard copy.
 */
export interface ArtifactInspection {
  /** Decoded text content, or `null` (directory / binary / loading / error). */
  readonly content: string | null;
  /** Server-detected content type, or `null`. */
  readonly contentType: string | null;
  /** Whether the fetched content was truncated by the server's size cap. */
  readonly isTruncated: boolean;
  /** `true` while the content request is in-flight (first load). */
  readonly isLoading: boolean;
  /** Content-fetch error, or `null`. */
  readonly error: Error | null;
  /** Re-fetch the artifact content. */
  readonly refetch: () => void;

  /** Whether the artifact is a directory (skill package candidate). */
  readonly isDirectory: boolean;
  /** Skill-package detection for directory artifacts. */
  readonly skillDetection: SkillPackageDetection;

  /** `true` when the artifact is a recognized Stigmer resource or skill. */
  readonly isDetected: boolean;
  /** `true` while detection is still resolving (content / skill fetch). */
  readonly isDetecting: boolean;
  /** Detection badge label (`"Agent detected"`, `"Skill · N files"`), or `null`. */
  readonly detectionLabel: string | null;

  /** Apply/Push CTA label (`"Apply to org"`, `"Push Skill to org"`), or `null`. */
  readonly ctaLabel: string | null;
  /** Apply the detected resource / push the detected skill. */
  readonly apply: () => Promise<void>;
  /** `true` while an apply/push is in-flight. */
  readonly isApplying: boolean;
  /** The successful apply result, or `null`. */
  readonly applyResult: ApplyResourceResult | null;
  /** Apply/push error, or `null`. */
  readonly applyError: Error | null;

  /** Copy the in-memory content to the clipboard. No-op without content. */
  readonly copy: () => void;
  /** `true` for a short window after a successful copy. */
  readonly copied: boolean;
}

/**
 * Headless behavior hook consolidating the artifact inspect-and-act pipeline
 * that was previously inlined per artifact surface: content fetch,
 * Agent/McpServer YAML detection, skill-package detection, the Apply/Push
 * mutation, and in-memory clipboard copy.
 *
 * It is the single writer of this pipeline's derived state, consumed by every
 * artifact chrome — the modal action bar and the editor-area
 * `ArtifactDocument` toolbar (DD-003 headless-first). Because there is exactly
 * one place computing `detectionLabel` / `ctaLabel` / the apply flow, the two
 * surfaces cannot drift.
 *
 * All four underlying hooks are called unconditionally with null-gated
 * arguments (their documented skip contract), so this composition is
 * React-rules-clean regardless of the artifact kind.
 *
 * @param artifact - The artifact to inspect.
 * @param executionId - Execution that produced it (content + skill fetching).
 * @param org - Organization for the "Apply to [org]" / "Push Skill to [org]" CTA.
 * @param options - {@link UseArtifactInspectionOptions}.
 */
export function useArtifactInspection(
  artifact: ExecutionArtifact,
  executionId: string,
  org: string,
  options?: UseArtifactInspectionOptions,
): ArtifactInspection {
  const isDirectory = artifact.kind === ExecutionArtifactKind.DIRECTORY;
  const canFetchContent = !isDirectory && isTextArtifact(artifact);

  const {
    content,
    contentType,
    isTruncated,
    isLoading,
    error,
    refetch,
  } = useArtifactContent(
    canFetchContent ? executionId : null,
    canFetchContent ? artifact.storageKey : null,
    undefined,
    artifact.contentHash || undefined,
    options?.cacheKey,
  );

  const yamlDetection = useDetectStigmerResource(
    canFetchContent ? content : null,
  );

  const { detection: skillDetection, isLoading: isSkillLoading } =
    useDetectSkillPackage(
      isDirectory ? artifact : null,
      isDirectory ? executionId : null,
    );

  const isDetected = yamlDetection.detected || skillDetection.detected;
  const isDetecting =
    (canFetchContent && isLoading) || (isDirectory && isSkillLoading);

  let detectionLabel: string | null = null;
  if (yamlDetection.detected) {
    detectionLabel = `${yamlDetection.displayName} detected`;
  } else if (skillDetection.detected) {
    const count = skillDetection.fileCount;
    detectionLabel = `Skill \u00B7 ${count} ${count === 1 ? "file" : "files"}`;
  }

  let ctaLabel: string | null = null;
  if (yamlDetection.detected) {
    ctaLabel = `Apply to ${org}`;
  } else if (skillDetection.detected) {
    ctaLabel = `Push Skill to ${org}`;
  }

  // --- Apply / Push ---------------------------------------------------------

  const { applyYamlResource, pushSkillPackage, isApplying, error: applyError, clearError } =
    useApplyResource();
  const [applyResult, setApplyResult] = useState<ApplyResourceResult | null>(
    null,
  );
  const onApplied = options?.onApplied;

  const apply = useCallback(async () => {
    clearError();
    try {
      let result: ApplyResourceResult;
      if (yamlDetection.detected && content) {
        result = await applyYamlResource(content, org);
      } else if (skillDetection.detected) {
        result = await pushSkillPackage({
          org,
          executionId,
          storageKey: artifact.storageKey,
        });
      } else {
        return;
      }
      setApplyResult(result);
      onApplied?.(result);
    } catch {
      // error state is owned by useApplyResource
    }
  }, [
    yamlDetection.detected,
    skillDetection.detected,
    content,
    org,
    executionId,
    artifact.storageKey,
    applyYamlResource,
    pushSkillPackage,
    clearError,
    onApplied,
  ]);

  // --- Copy -----------------------------------------------------------------

  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    if (!content) return;
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    });
  }, [content]);

  return useMemo(
    () => ({
      content,
      contentType,
      isTruncated,
      isLoading,
      error,
      refetch,
      isDirectory,
      skillDetection,
      isDetected,
      isDetecting,
      detectionLabel,
      ctaLabel,
      apply,
      isApplying,
      applyResult,
      applyError,
      copy,
      copied,
    }),
    [
      content,
      contentType,
      isTruncated,
      isLoading,
      error,
      refetch,
      isDirectory,
      skillDetection,
      isDetected,
      isDetecting,
      detectionLabel,
      ctaLabel,
      apply,
      isApplying,
      applyResult,
      applyError,
      copy,
      copied,
    ],
  );
}
