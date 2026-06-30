import { createContext, useCallback, useContext } from "react";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/**
 * Context value that carries the run's pending approvals to the tool rows
 * that own them, so an approval gate can render *inline* on the exact tool
 * call it blocks (parent thread and nested sub-agents alike) instead of as a
 * detached card at the bottom of the thread.
 *
 * Provided by {@link MessageThread} (or a platform builder's custom wrapper),
 * beside {@link FilePathContext} / `SandboxContext`. When no provider is
 * present — or the consumer did not supply an `onApprovalSubmit` handler — the
 * map is empty and {@link useApproval} returns `null`, so the inline UI is a
 * no-op (backward compatible).
 *
 * The map is keyed by `tool_call_id` and rebuilt only when the underlying
 * `pendingApprovals` list changes (not per streaming frame), so subscribing
 * tool rows re-render on approval events, not on every snapshot — preserving
 * the thread's streaming re-render isolation (DD-009 / DD-010).
 */
export interface ApprovalContextValue {
  /** Unresolved approvals, keyed by the `tool_call_id` they gate. */
  readonly approvalsByToolCallId: ReadonlyMap<string, PendingApproval>;
  /**
   * Submits a decision for a gated tool call. Wired to the same handler the
   * bottom {@link ApprovalCard} backstop uses; when absent, no inline approval
   * UI is shown.
   */
  readonly onSubmit?: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => void;
  /** Tool-call ids whose decision RPC is in flight, for per-card spinners. */
  readonly submittingIds: ReadonlySet<string>;
  /**
   * Per-tool-call failures, keyed by `tool_call_id` (the parallel of
   * {@link submittingIds}). A failed decision is surfaced in-card, beside the
   * exact gate that failed, so the inline row can name *which* action did not
   * take and why. Empty when no provider supplies it.
   */
  readonly errorsByToolCallId: ReadonlyMap<string, Error>;
}

const DEFAULT_VALUE: ApprovalContextValue = {
  approvalsByToolCallId: new Map(),
  submittingIds: new Set(),
  errorsByToolCallId: new Map(),
};

/** Context that supplies a run's pending approvals to the tool rows they gate. */
export const ApprovalContext =
  createContext<ApprovalContextValue>(DEFAULT_VALUE);

/**
 * Resolved inline-approval state for a single tool call. Its shape is a superset
 * of the props {@link ApprovalCardBody} reads, so a consumer can spread it
 * directly: `<ApprovalCardBody {...approval} />`.
 */
export interface UseApprovalResult {
  /** The pending approval gating this tool call. */
  readonly pendingApproval: PendingApproval;
  /** Submits a decision for this tool call (id already bound). */
  readonly onSubmit: (action: ApprovalAction, comment?: string) => void;
  /** True while this tool call's decision RPC is in flight. */
  readonly isSubmitting: boolean;
  /** This gate's last failed decision, or `null` — surfaced in-card beside it. */
  readonly error: Error | null;
}

/**
 * Returns the inline-approval state for a tool call, or `null` when the call
 * is not currently gated (no matching approval, or no submit handler wired).
 *
 * The returned `onSubmit` is pre-bound to `toolCallId` and stable across
 * renders, so it can flow straight into a memoized approval body.
 *
 * @example
 * ```tsx
 * const approval = useApproval(toolCall.id);
 * if (approval) {
 *   return <ApprovalCardBody {...approval} />;
 * }
 * ```
 */
export function useApproval(toolCallId: string): UseApprovalResult | null {
  const { approvalsByToolCallId, onSubmit, submittingIds, errorsByToolCallId } =
    useContext(ApprovalContext);

  const handleSubmit = useCallback(
    (action: ApprovalAction, comment?: string) => {
      onSubmit?.(toolCallId, action, comment);
    },
    [onSubmit, toolCallId],
  );

  const pendingApproval = toolCallId
    ? approvalsByToolCallId.get(toolCallId)
    : undefined;
  if (!pendingApproval || !onSubmit) return null;

  return {
    pendingApproval,
    onSubmit: handleSubmit,
    isSubmitting: submittingIds.has(toolCallId),
    error: errorsByToolCallId.get(toolCallId) ?? null,
  };
}
