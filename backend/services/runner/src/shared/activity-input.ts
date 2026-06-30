/**
 * Typed Temporal activity input shared by ExecuteCursor and ExecuteDeepAgent.
 *
 * The Go and Java control planes now invoke these activities with a single
 * object carrying snake_case keys (mirroring the polyglot workflow-input
 * convention) instead of positional string args. This ends the prior drift
 * where Go sent (executionId, threadId) and Java sent
 * (executionId, threadId, invokerIdentityAccountId) while this single runner
 * read only the first two positionally.
 *
 * TRANSITIONAL DUAL-SHAPE: the activity is MaximumAttempts=1 (a failed activity
 * fails the execution with no retry), and the control plane and this runner
 * deploy separately. To make the rollout order-independent, the runner accepts
 * BOTH the new object and the legacy positional args. Deploy the runner first,
 * then the control planes; once both are everywhere, drop the positional branch
 * (and the `string` arms below).
 */
export interface ExecuteActivityInput {
  readonly execution_id: string;
  readonly thread_id: string;
  /** Carried for cross-edition parity; the runner hydrates the invoker from the DB. */
  readonly invoker_identity_account_id?: string;
}

export interface NormalizedActivityInput {
  readonly executionId: string;
  readonly threadId: string;
}

/**
 * Normalizes either the new typed object or the legacy positional args into the
 * `{ executionId, threadId }` the inner activity path consumes. `thread_id` is
 * empty on a first invocation (new harness state) by design.
 */
export function normalizeActivityInput(
  arg0: ExecuteActivityInput | string | undefined,
  arg1?: string,
): NormalizedActivityInput {
  if (arg0 !== null && typeof arg0 === "object") {
    return {
      executionId: arg0.execution_id ?? "",
      threadId: arg0.thread_id ?? "",
    };
  }
  return { executionId: arg0 ?? "", threadId: arg1 ?? "" };
}
