/**
 * Status-transition hook types — the execution-lifecycle seam, carried
 * by the extension registry and CONSUMED at
 * the updateStatus chokepoint (src/domain/agentrun/update-status.ts,
 * the single merge point every status transition funnels through).
 *
 * The contract: observers fire synchronously after the
 * store write and MAY NOT mutate the execution; decorators may contribute
 * only response fields the OSS reply schema already carries (the
 * control-signal field exists on the shared proto); StreamBroker.broadcast
 * stays last. The workflow `stigmer/agent-execution/invoke` stays
 * byte-identical — no extension activities inside it (that alternative
 * was considered and rejected).
 *
 * Scope note: this hook family spans the agent-execution family, the one
 * run kind.
 */
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { UpdateStatusResponse } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";

/** One observed phase transition, delivered post-merge. */
export interface RunStatusTransition {
  /** The merged, persisted run snapshot. Observers may not mutate it. */
  readonly run: Run;
  readonly oldPhase: RunPhase;
  readonly newPhase: RunPhase;
}

/**
 * Fires synchronously after the merge persists. A throwing observer is an
 * extension bug logged by the chokepoint, never a failed transition — the
 * cloud's expiry sweep remains the reconciliation backstop it already is.
 */
export type RunStatusObserver = (
  transition: RunStatusTransition,
) => void | Promise<void>;

/**
 * Runs after the merge, before the reply; may set only fields the shared
 * reply schema carries. Decorator failure degrades the contributed fields
 * to their defaults (the verified non-fatal posture), never the RPC.
 */
export type RunResponseDecorator = (
  execution: Run,
  response: UpdateStatusResponse,
) => void | Promise<void>;

/** The hook bundle one extension unit contributes (both lists optional). */
export interface RunStatusHooks {
  readonly observers?: ReadonlyArray<RunStatusObserver>;
  readonly responseDecorators?: ReadonlyArray<RunResponseDecorator>;
}
