import { createContext, useCallback, useContext } from "react";
import type { ToolUse } from "@stigmer/client";
import type { ToolUseAnswer } from "./useAnswerToolUse.js";

/**
 * Context value that carries the answer handler and its per-gate state to the
 * tool rows, so a tool use that waits for a person renders its decision
 * *inline* on its own row (parent thread and nested subagents alike) instead
 * of as a detached card at the bottom of the thread.
 *
 * Whether a row waits is the row's own fact (`ToolUse.state === "waiting"`,
 * from the session's events); the context supplies only what the row cannot
 * know: how to answer, and which answers are in flight or failed.
 *
 * Provided by {@link MessageThread} (or a platform builder's custom wrapper),
 * beside {@link FilePathContext} / `SandboxContext`. Without a provider, or
 * without an `onAnswer` handler, {@link useApproval} returns `null` and no
 * decision UI is shown (a read-only transcript).
 */
export interface ApprovalContextValue {
  /**
   * Answers a waiting tool use. Wired to the same handler the bottom
   * {@link ApprovalCard} backstop uses; when absent, no inline decision UI
   * is shown.
   */
  readonly onAnswer?: (toolUseId: string, answer: ToolUseAnswer, denyMessage?: string) => void;
  /** Tool-use ids whose answer is in flight, for per-gate spinners. */
  readonly submittingIds: ReadonlySet<string>;
  /**
   * Each tool use's last failed answer, keyed by its id (the parallel of
   * {@link submittingIds}), surfaced in-card beside the gate that failed.
   */
  readonly errorsByToolUseId: ReadonlyMap<string, Error>;
}

const DEFAULT_VALUE: ApprovalContextValue = {
  submittingIds: new Set(),
  errorsByToolUseId: new Map(),
};

/** Context that supplies the answer handler to the tool rows that wait. */
export const ApprovalContext =
  createContext<ApprovalContextValue>(DEFAULT_VALUE);

/**
 * Resolved inline-approval state for one waiting tool use. Its shape is a
 * superset of the props {@link ApprovalCardBody} reads, so a consumer can
 * spread it: `<ApprovalCardBody {...approval} />`.
 */
export interface UseApprovalResult {
  /** The tool use that waits. */
  readonly toolUse: ToolUse;
  /** Answers this tool use (its id already bound). */
  readonly onAnswer: (answer: ToolUseAnswer, denyMessage?: string) => void;
  /** True while this tool use's answer is in flight. */
  readonly isSubmitting: boolean;
  /** This gate's last failed answer, or `null`, surfaced in-card beside it. */
  readonly error: Error | null;
}

/**
 * Returns the inline-approval state for a tool use, or `null` when it does
 * not wait for a person (or no answer handler is wired).
 *
 * The returned `onAnswer` is bound to the tool use's id and stable across
 * renders, so it can flow straight into a memoized approval body.
 *
 * @example
 * ```tsx
 * const approval = useApproval(toolUse);
 * if (approval) {
 *   return <ApprovalCardBody {...approval} />;
 * }
 * ```
 */
export function useApproval(toolUse: ToolUse): UseApprovalResult | null {
  const { onAnswer, submittingIds, errorsByToolUseId } = useContext(ApprovalContext);
  const toolUseId = toolUse.id;

  const handleAnswer = useCallback(
    (answer: ToolUseAnswer, denyMessage?: string) => {
      onAnswer?.(toolUseId, answer, denyMessage);
    },
    [onAnswer, toolUseId],
  );

  if (toolUse.state !== "waiting" || !onAnswer) return null;

  return {
    toolUse,
    onAnswer: handleAnswer,
    isSubmitting: submittingIds.has(toolUseId),
    error: errorsByToolUseId.get(toolUseId) ?? null,
  };
}
