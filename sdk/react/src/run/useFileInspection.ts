"use client";

/**
 * The inspect-and-act pipeline over one output File, shared by every chrome
 * that shows one (the preview modal, the editor-area document): its text,
 * Stigmer resource detection, the Apply action, and clipboard copy.
 *
 * Trade-offs:
 * - One writer of the derived state, so the modal and the document cannot
 *   drift on labels or the apply flow.
 * - Only text Files are read (`isTextFile`); anything else shows its
 *   download, never a byte read through the API.
 * - A File's bytes never change, so the read is cached by its id and a
 *   reopened tab renders at once.
 */

import { useCallback, useMemo, useState } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { useFileContent } from "../file/useFileContent.js";
import { isTextFile } from "./artifact-utils.js";
import { useDetectStigmerResource } from "../library/useDetectStigmerResource.js";
import {
  useApplyResource,
  type ApplyResourceResult,
} from "../library/useApplyResource.js";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";
import { useOrgSlugForId } from "../organization/useOrgRefs.js";

/** Options for {@link useFileInspection}. */
export interface UseFileInspectionOptions {
  /**
   * Called after a resource is successfully applied. The consumer uses it for
   * post-apply behavior (toast, navigate to Library).
   */
  readonly onApplied?: (result: ApplyResourceResult) => void;
}

/**
 * Everything a chrome (the modal action bar, the document toolbar, the content
 * body) needs to inspect and act on one output File: fetched content, resource
 * detection, the Apply action, and clipboard copy.
 */
export interface FileInspection {
  /** Decoded text content, or `null` (binary / loading / error). */
  readonly content: string | null;
  /** The File's media type, or `null` when it has none. */
  readonly contentType: string | null;
  /** Whether the fetched content was truncated by the server's size cap. */
  readonly isTruncated: boolean;
  /** `true` while the content request is in-flight (first load). */
  readonly isLoading: boolean;
  /** Content-fetch error, or `null`. */
  readonly error: Error | null;
  /** Re-fetch the content. */
  readonly refetch: () => void;

  /** `true` when the File is a recognized Stigmer resource. */
  readonly isDetected: boolean;
  /** `true` while detection is still resolving (content fetch). */
  readonly isDetecting: boolean;
  /** Detection badge label (`"Agent detected"`), or `null`. */
  readonly detectionLabel: string | null;

  /** Apply CTA label (`"Apply to org"`), or `null`. */
  readonly ctaLabel: string | null;
  /** Apply the detected resource. */
  readonly apply: () => Promise<void>;
  /** `true` while an apply is in-flight. */
  readonly isApplying: boolean;
  /** The successful apply result, or `null`. */
  readonly applyResult: ApplyResourceResult | null;
  /** Apply error, or `null`. */
  readonly applyError: Error | null;

  /** Copy the in-memory content to the clipboard. No-op without content. */
  readonly copy: () => void;
  /** `true` for a short window after a successful copy. */
  readonly copied: boolean;
}

/**
 * Headless behavior hook over one output File: content fetch, Agent YAML
 * detection, the Apply mutation, and in-memory clipboard copy.
 *
 * @param file - The File to inspect.
 * @param org - Organization for the "Apply to [org]" CTA.
 * @param options - {@link UseFileInspectionOptions}.
 */
export function useFileInspection(
  file: StigmerFile,
  org: string,
  options?: UseFileInspectionOptions,
): FileInspection {
  const slugForOrg = useOrgSlugForId();
  const canFetchContent = isTextFile(file);
  const contentType = file.spec?.mimeType || null;

  const { content, isTruncated, isLoading, error, refetch } = useFileContent(
    canFetchContent ? file.metadata?.id ?? null : null,
  );

  const yamlDetection = useDetectStigmerResource(canFetchContent ? content : null);

  const isDetected = yamlDetection.detected;
  const isDetecting = canFetchContent && isLoading;
  const detectionLabel = yamlDetection.detected ? `${yamlDetection.displayName} detected` : null;
  const ctaLabel = yamlDetection.detected ? `Apply to ${slugForOrg(org)}` : null;

  // --- Apply ----------------------------------------------------------------

  const { applyYamlResource, isApplying, error: applyError, clearError } = useApplyResource();
  const [applyResult, setApplyResult] = useState<ApplyResourceResult | null>(null);
  const onApplied = options?.onApplied;

  const apply = useCallback(async () => {
    clearError();
    if (!yamlDetection.detected || !content) return;
    try {
      const result = await applyYamlResource(content, org);
      setApplyResult(result);
      onApplied?.(result);
    } catch {
      // error state is owned by useApplyResource
    }
  }, [yamlDetection.detected, content, org, applyYamlResource, clearError, onApplied]);

  // --- Copy -----------------------------------------------------------------

  const { copy: copyToClipboard, copied } = useCopyFeedback();
  const copy = useCallback(() => {
    if (!content) return;
    void copyToClipboard(content);
  }, [content, copyToClipboard]);

  return useMemo(
    () => ({
      content,
      contentType,
      isTruncated,
      isLoading,
      error,
      refetch,
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
