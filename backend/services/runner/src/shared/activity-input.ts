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

import type { RUN_CREDENTIAL_INPUT_KEY } from "./run-credential.js";

export interface ExecuteActivityInput {
  readonly execution_id: string;
  readonly thread_id: string;
  /** Carried for cross-edition parity; the runner hydrates the invoker from the DB. */
  readonly invoker_identity_account_id?: string;
  /**
   * Monotonic HITL-cycle index within this execution: 0 on the first invocation,
   * then the workflow's approvalCycle on each reinvocation. The Cursor producer
   * mints its deterministic file-review change-set id ({@code executionId:turnSeq})
   * from it. Absent on the legacy positional wire shape (defaults to 0).
   */
  readonly turn_seq?: number;
  /**
   * The run credential the server minted for this execution at dispatch,
   * handed on from the workflow input; absent when the dispatch carried none
   * (an older server; the cloud). Not normalized here and never read by an
   * activity: the activity boundary enters it into the run-credential store
   * before the activity runs (`interceptors/run-credential-activity.ts`), and
   * the control-plane client presents it per request (`run-credential.ts`).
   */
  readonly execution_context_token?: string;
}

/**
 * Compile-time fence: the key the boundary reads
 * (`RUN_CREDENTIAL_INPUT_KEY`) is a key of this input. The type keeps the
 * literal so the wire shape stays readable; this line fails to type-check the
 * day the two disagree.
 */
type _RunCredentialKeyIsOnTheWire =
  ExecuteActivityInput[typeof RUN_CREDENTIAL_INPUT_KEY];

export interface NormalizedActivityInput {
  readonly executionId: string;
  readonly threadId: string;
  /** HITL-cycle index for this invocation; 0 on the first turn / legacy wire shape. */
  readonly turnSeq: number;
}

/**
 * Normalizes either the new typed object or the legacy positional args into the
 * `{ executionId, threadId, turnSeq }` the inner activity path consumes.
 * `thread_id` is empty on a first invocation (new harness state) and `turn_seq`
 * defaults to 0 (first turn, or the legacy positional shape that never carried it).
 */
export function normalizeActivityInput(
  arg0: ExecuteActivityInput | string | undefined,
  arg1?: string,
): NormalizedActivityInput {
  if (arg0 !== null && typeof arg0 === "object") {
    return {
      executionId: arg0.execution_id ?? "",
      threadId: arg0.thread_id ?? "",
      turnSeq: arg0.turn_seq ?? 0,
    };
  }
  return { executionId: arg0 ?? "", threadId: arg1 ?? "", turnSeq: 0 };
}
