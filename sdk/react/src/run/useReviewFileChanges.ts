"use client";

import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { ReviewFileChangesInputSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** What a decision does to a turn's changes: keep them, or put them back. */
export type FileReviewAction = "keep" | "undo";

/** Options narrowing a file-review decision to one file and binding its digest. */
export interface ReviewFileChangesOptions {
  /**
   * `"file"` decides the one {@link fileChangeId}; `"change_set"` decides every
   * file of the set. Defaults to `"file"` when {@link fileChangeId} is set,
   * else `"change_set"`.
   */
  readonly scope?: "change_set" | "file";
  /** The file this decision targets (`FileReviewFile.fileChangeId`); required for `"file"`. */
  readonly fileChangeId?: string;
  /**
   * The digest of what the person saw: the file's `digest` for a file, the
   * set's `aggregateDigest` for the whole set. A decision against a change
   * that differs is refused, so what is kept is what was reviewed.
   */
  readonly expectedDigest: string;
  /** An optional reason, kept with the decision. */
  readonly reason?: string;
  /**
   * Set on a keep to keep a binary change consciously: it has no text diff,
   * but its exact bytes can be put back. Ignored on an undo, and it never
   * relaxes the digest.
   */
  readonly acknowledgeUnreviewable?: boolean;
}

/** Return value of {@link useReviewFileChanges}. */
export interface UseReviewFileChangesReturn {
  /**
   * Keep or undo a turn's changes (one file, or the whole set) through the
   * session's `reviewFileChanges`. Resolves when the server recorded the
   * decision; the session's events then carry it, and an undo's outcome
   * once the files are put back. Rejects with the server's error.
   */
  readonly reviewFileChanges: (
    sessionId: string,
    changeSetId: string,
    action: FileReviewAction,
    options: ReviewFileChangesOptions,
  ) => Promise<void>;
  /**
   * Decision keys in flight ({@link fileDecisionKey}: the set's id for a
   * whole-set decision, `setId:fileChangeId` for one file), so each control
   * of a review card carries its own spinner.
   */
  readonly submittingDecisionKeys: ReadonlySet<string>;
  /** Each decision's last failure, keyed like {@link submittingDecisionKeys}. */
  readonly decisionErrors: ReadonlyMap<string, Error>;
  /** Clear the error for one decision key (e.g. before a retry of that target). */
  readonly clearDecisionError: (key: string) => void;
  /** The most recent failure, or `null`: a single value for a headless consumer. */
  readonly error: Error | null;
  /** Reset every decision error (both {@link decisionErrors} and {@link error}). */
  readonly clearError: () => void;
}

/**
 * The loading-state key for a file-review decision: the change set's id for a
 * whole-set decision, `changeSetId:fileChangeId` for one file.
 */
export function fileDecisionKey(changeSetId: string, fileChangeId?: string): string {
  return fileChangeId ? `${changeSetId}:${fileChangeId}` : changeSetId;
}

/** A stable empty map so an error-free hook keeps a constant `decisionErrors` ref. */
const NO_DECISION_ERRORS: ReadonlyMap<string, Error> = new Map();

/**
 * Behavior hook that decides a turn's file changes, through the session's
 * `reviewFileChanges`, with per-decision loading and error state. A turn's
 * edits are reviewed as a set (keep or undo every file, or each file on its
 * own), not as tool-call approvals; what is decided is read back from the
 * session's events (`FileReviewSet`).
 *
 * Platform builders who render their own review UI use this hook directly;
 * {@link FileReviewCard} takes the decision callback it produces.
 *
 * @example
 * ```tsx
 * const { reviewFileChanges } = useReviewFileChanges();
 *
 * await reviewFileChanges(sessionId, set.changeSetId, "keep", {
 *   expectedDigest: set.aggregateDigest,
 * });
 * ```
 */
export function useReviewFileChanges(): UseReviewFileChangesReturn {
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

  const reviewFileChanges = useCallback(
    async (
      sessionId: string,
      changeSetId: string,
      action: FileReviewAction,
      options: ReviewFileChangesOptions,
    ): Promise<void> => {
      const fileChangeId = options.fileChangeId ?? "";
      const scope = options.scope ?? (fileChangeId ? "file" : "change_set");
      const key = fileDecisionKey(changeSetId, fileChangeId || undefined);

      setSubmittingKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      // A retry starts clean: this target's failure and the scalar mirror
      // are cleared together.
      clearDecisionError(key);
      setError(null);

      try {
        await stigmer.session.reviewFileChanges(
          create(ReviewFileChangesInputSchema, {
            sessionId,
            changeSetId,
            scope,
            fileChangeId,
            action,
            expectedDigest: options.expectedDigest,
            reason: options.reason ?? "",
            acknowledgeUnreviewable: options.acknowledgeUnreviewable ?? false,
          }),
        );
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
      reviewFileChanges,
      submittingDecisionKeys: submittingKeys,
      decisionErrors,
      clearDecisionError,
      error,
      clearError,
    }),
    [reviewFileChanges, submittingKeys, decisionErrors, clearDecisionError, error, clearError],
  );
}
