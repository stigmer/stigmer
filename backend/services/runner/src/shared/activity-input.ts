/**
 * Typed Temporal activity input shared by every harness's activity: one
 * object with snake_case keys, the shape the server's invoke workflow sends
 * (`ExecuteActivityInput` in its `invoke-agent-execution.ts`). The keys are
 * wire contract.
 */

import type { RUN_CREDENTIAL_INPUT_KEY } from "./run-credential.js";

export interface ExecuteActivityInput {
  readonly execution_id: string;
  readonly thread_id: string;
  /** Carried for cross-edition parity; the runner hydrates the invoker from the DB. */
  readonly invoker_identity_account_id?: string;
  /**
   * Monotonic HITL-cycle index within this execution: 0 on the first invocation,
   * then the workflow's approvalCycle on each reinvocation. The runtime mints
   * its deterministic file-review change-set id ({@code executionId:turnSeq})
   * from it. Absent means 0.
   */
  readonly turn_seq?: number;
  /**
   * The run credential the server minted for this execution at dispatch,
   * handed on from the workflow input; absent when the dispatch carried none
   * (the cloud's). Not normalized here and never read by an
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
  /** HITL-cycle index for this invocation; 0 on the first turn. */
  readonly turnSeq: number;
}

/**
 * Normalizes the typed object into the `{ executionId, threadId, turnSeq }`
 * the inner activity path consumes. `thread_id` is empty on a first
 * invocation (new harness state) and `turn_seq` defaults to 0 (first turn).
 */
export function normalizeActivityInput(input: ExecuteActivityInput): NormalizedActivityInput {
  return {
    executionId: input.execution_id ?? "",
    threadId: input.thread_id ?? "",
    turnSeq: input.turn_seq ?? 0,
  };
}
