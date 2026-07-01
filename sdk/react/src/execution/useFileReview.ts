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
  /**
   * Set on an APPROVE to consciously KEEP a change whose diff could not be fully
   * reviewed. Honored only for a binary file at `FILE` scope (a binary has no
   * text diff, but its exact bytes are captured and reconcilable). It never
   * relaxes the digest gate, and is ignored for other incompleteness. See DD-16.
   */
  readonly acknowledgeUnreviewable?: boolean;
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
  /**
   * Per-decision failures, keyed exactly like {@link submittingDecisionKeys}
   * (via {@link fileDecisionKey}). This is the per-target parallel of the
   * in-flight Set: a review card has many decision targets (the whole set plus
   * each file), so a failure must be attributable to the *one* control that
   * failed — a single scalar cannot say which file. {@link FileReviewCard}
   * consumes this map to render the error in-card, beside the failed control.
   */
  readonly decisionErrors: ReadonlyMap<string, Error>;
  /** Clear the error for one decision key (e.g. before a retry of that target). */
  readonly clearDecisionError: (key: string) => void;
  /**
   * The most-recent decision failure, or `null` when healthy — a convenience
   * mirror of {@link decisionErrors} for a headless consumer that wants a single
   * error value (a banner). The map is authoritative for per-control surfacing.
   */
  readonly error: Error | null;
  /** Reset every decision error (both {@link decisionErrors} and {@link error}). */
  readonly clearError: () => void;
}

/**
 * The loading-state key for a file decision: the change set id for a whole-set
 * (CHANGE_SET) decision, or `changeSetId:fileChangeId` for a per-file one.
 */
export function fileDecisionKey(changeSetId: string, fileChangeId?: string): string {
  return fileChangeId ? `${changeSetId}:${fileChangeId}` : changeSetId;
}

/** A stable empty map so an error-free hook keeps a constant `decisionErrors` ref. */
const NO_DECISION_ERRORS: ReadonlyMap<string, Error> = new Map();

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
  const [decisionErrors, setDecisionErrors] =
    useState<ReadonlyMap<string, Error>>(NO_DECISION_ERRORS);
  const [error, setError] = useState<Error | null>(null);

  const clearDecisionError = useCallback((key: string) => {
    setDecisionErrors((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const clearError = useCallback(() => {
    setDecisionErrors(NO_DECISION_ERRORS);
    setError(null);
  }, []);

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
      // Clear this target's prior failure (and the scalar mirror) so a retry
      // starts clean — the map and `error` are updated together, never drift.
      clearDecisionError(key);
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
          acknowledgeUnreviewable: options?.acknowledgeUnreviewable ?? false,
        });
        await stigmer.agentExecution.submitFileDecision(input);
      } catch (err) {
        const e = toError(err);
        setDecisionErrors((prev) => new Map(prev).set(key, e));
        setError(e);
        throw err;
      } finally {
        setSubmittingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [stigmer, clearDecisionError],
  );

  return useMemo(
    () => ({
      submitFileDecision,
      submittingDecisionKeys: submittingKeys,
      decisionErrors,
      clearDecisionError,
      error,
      clearError,
    }),
    [submitFileDecision, submittingKeys, decisionErrors, clearDecisionError, error, clearError],
  );
}
