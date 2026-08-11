"use client";

/** Props for {@link InCardDecisionError}. */
export interface InCardDecisionErrorProps {
  /** The failure to surface. Its `message` is shown verbatim (the actionable part). */
  readonly error: Error;
  /**
   * The verb phrase completing "Couldn't ___" — e.g. `"submit decision"` or
   * `"save"`. Kept short; the server `message` carries the detail.
   */
  readonly leadIn: string;
  /** Stable hook for e2e/visual targeting (`data-cursor-target`). */
  readonly cursorTarget: string;
}

/**
 * The shared in-card failure notice for a decision that did not take — used by
 * every decision surface that surfaces errors beside the control that failed:
 * the agent tool gate ({@link ApprovalCard}/{@link ApprovalCardBody}) and the
 * file-review card ({@link FileReviewCard}, whole-set and per-file).
 *
 * One source of truth so those surfaces can never drift in tone, copy shape, or
 * accessibility. `role="alert"` (matching the thread's other inline failures)
 * announces it the moment it appears, since it is a dynamic reaction to the
 * reviewer's action — by the time it renders the optimistic verdict has already
 * reverted, and this explains why. The server `message` is shown verbatim
 * because it is the actionable part (e.g. a digest mismatch means the captured
 * content moved on); the lead-in stays short. Every visual property flows
 * through `--stgm-*` tokens.
 *
 * @internal Not part of the public API.
 */
export function InCardDecisionError({
  error,
  leadIn,
  cursorTarget,
}: InCardDecisionErrorProps) {
  return (
    <p
      role="alert"
      className="stg:text-[11px] stg:text-destructive"
      data-cursor-target={cursorTarget}
    >
      Couldn&rsquo;t {leadIn} — {error.message}
    </p>
  );
}
