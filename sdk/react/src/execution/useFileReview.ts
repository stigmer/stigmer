"use client";

import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import {
  FileDecisionAction,
  FileDecisionScope,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SubmitFileDecisionInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Options narrowing a file decision to a single file and binding its digest. */
export interface FileDecisionOptions {
  /**
   * Decision scope. Defaults to `FILE` when {@link fileChangeId} is set, else
   * `CHANGE_SET` (the whole-set decision that covers every file).
   */
  readonly scope?: FileDecisionScope;
  /** The captured file this decision targets; required for `FILE` scope. */
  readonly fileChangeId?: string;
  /**
   * The digest the reviewer saw (`aggregate_digest` for CHANGE_SET,
   * `file_digest` for FILE). The server enforces it at decision time and the
   * runner re-verifies it at reconcile — "what you approve is what gets applied".
   */
  readonly expectedDigest?: string;
  /** Optional free-text comment recorded on the decision (audit trail). */
  readonly reason?: string;
}

/** Return value of {@link useFileReview}. */
export interface UseFileReviewReturn {
  /**
   * Submit an approve/reject decision for a change set (or one file within it).
   * Resolves when the backend accepts the decision; the execution stream will
   * deliver the updated `file_change_sets` projection.
   */
  readonly submitFileDecision: (
    executionId: string,
    changeSetId: string,
    action: FileDecisionAction,
    options?: FileDecisionOptions,
  ) => Promise<void>;
  /**
   * Keys (`changeSetId` for a whole-set decision, `changeSetId:fileChangeId` for
   * a per-file one) currently being submitted — drives per-button loading state
   * when a reviewer decides files independently. Build a key with
   * {@link fileDecisionKey}.
   */
  readonly submittingDecisionKeys: ReadonlySet<string>;
  /** Error from the last failed decision submission, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * The loading-state key for a file decision: the change set id for a whole-set
 * (CHANGE_SET) decision, or `changeSetId:fileChangeId` for a per-file one.
 */
export function fileDecisionKey(changeSetId: string, fileChangeId?: string): string {
  return fileChangeId ? `${changeSetId}:${fileChangeId}` : changeSetId;
}

/**
 * Behavior hook that wraps `agentExecution.submitFileDecision()` with per-decision
 * loading state and error management — the file-review sibling of
 * {@link useSubmitApproval}.
 *
 * File edits are reviewed as a captured change set (the `file_change_sets`
 * projection), NOT as tool-call approvals. Platform builders who want full
 * control over the review UI use this hook directly; those who prefer a drop-in
 * surface use {@link FileReviewCard}, which accepts the callback shape this
 * hook produces.
 *
 * @example
 * ```tsx
 * const { submitFileDecision, submittingDecisionKeys } = useFileReview();
 *
 * // Approve the whole change set:
 * await submitFileDecision(executionId, changeSet.id, FileDecisionAction.APPROVE, {
 *   expectedDigest: changeSet.aggregateDigest,
 * });
 * ```
 */
export function useFileReview(): UseFileReviewReturn {
  const stigmer = useStigmer();
  const [submittingKeys, setSubmittingKeys] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const submitFileDecision = useCallback(
    async (
      executionId: string,
      changeSetId: string,
      action: FileDecisionAction,
      options?: FileDecisionOptions,
    ): Promise<void> => {
      const fileChangeId = options?.fileChangeId ?? "";
      const scope =
        options?.scope ??
        (fileChangeId ? FileDecisionScope.FILE : FileDecisionScope.CHANGE_SET);
      const key = fileDecisionKey(changeSetId, fileChangeId || undefined);

      setSubmittingKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      setError(null);

      try {
        const input = create(SubmitFileDecisionInputSchema, {
          agentExecutionId: executionId,
          changeSetId,
          scope,
          fileChangeId,
          action,
          expectedDigest: options?.expectedDigest ?? "",
          reason: options?.reason ?? "",
        });
        await stigmer.agentExecution.submitFileDecision(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setSubmittingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [stigmer],
  );

  return useMemo(
    () => ({ submitFileDecision, submittingDecisionKeys: submittingKeys, error, clearError }),
    [submitFileDecision, submittingKeys, error, clearError],
  );
}
