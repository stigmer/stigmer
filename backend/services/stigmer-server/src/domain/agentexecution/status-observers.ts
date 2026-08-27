/**
 * Status-observer notification — the domain-owned consumer of the
 * extension registry's status-transition hooks (blueprint 03 §7, DD-006
 * §3; O4 plan-gate ruling Q3, 20260827.07).
 *
 * The blueprint drafted the hook "at the updateStatus chokepoint", but
 * the verified reality is FIVE phase-transition persist sites, and a
 * finalize observer that misses any of them misses exactly what it
 * exists to settle (user cancels/terminations, start-failure FAILED,
 * workflow-gone FAILED). The ruled design: this ONE notifier is invoked
 * from every site — the site list below is the exhaustive contract,
 * re-verified whenever a new phase write appears:
 *   1. update-status.ts       — the runner's merge chokepoint;
 *   2. lifecycle.ts           — the phase-transition persist step
 *                               (cancel/terminate/pause/resume/recover);
 *   3. create-steps.ts        — the StartWorkflow failure arm (FAILED);
 *   4. submit-approval.ts     — reconcileStaleExecution (FAILED);
 *   5. submit-file-decision.ts — the file-review reconcile twin (FAILED).
 * Initial-phase stamping at creation (SetInitialPhase → PENDING) is by
 * definition not a transition and does not notify.
 *
 * Contract rendered here (status-hooks.ts carries the ratified text):
 *   - fires only when the phase actually changed (ruling Q4 — runner
 *     progress reports repeat the phase many times per execution; the
 *     terminal-vs-not filter stays with the observer);
 *   - observers run in registration order and are awaited, so every
 *     observer completes before the caller proceeds to broadcast —
 *     "StreamBroker.broadcast stays last" holds for async observers too;
 *   - a throwing/rejecting observer is an extension bug logged here,
 *     NEVER a failed transition (the cloud's expiry sweep remains the
 *     reconciliation backstop).
 */
import { clone } from "@bufbuild/protobuf";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { UpdateStatusResponse } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { UpdateStatusResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";

import type { Logger } from "../../boot/logger.js";
import type {
  AgentExecutionResponseDecorator,
  AgentExecutionStatusObserver,
} from "../../extensions/status-hooks.js";

/** The deps every notifying site threads (a slice of its own deps). */
export interface StatusObserverDeps {
  readonly statusObservers: ReadonlyArray<AgentExecutionStatusObserver>;
  readonly logger: Logger;
}

/**
 * Notifies the composed observers of one persisted phase transition.
 * Call AFTER the store write commits and BEFORE any broadcast, with the
 * persisted snapshot and the phase read from the pre-merge state.
 */
export async function notifyStatusObservers(
  deps: StatusObserverDeps,
  execution: AgentExecution,
  oldPhase: ExecutionPhase,
  newPhase: ExecutionPhase,
): Promise<void> {
  if (oldPhase === newPhase) {
    return;
  }
  for (const observer of deps.statusObservers) {
    try {
      await observer({ execution, oldPhase, newPhase });
    } catch (error) {
      deps.logger.warn("status observer failed (extension bug, ignored)", {
        executionId: execution.metadata?.id ?? "",
        oldPhase,
        newPhase,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Applies the composed response decorators to the UpdateStatus reply
 * (blueprint 03 §7 — the querySignal seam: after the merge, before the
 * reply). Each decorator works on a clone and commits only on success, so
 * a throwing decorator degrades exactly ITS contribution to the defaults
 * (the verified non-fatal posture) — never a partial write, never the
 * RPC. Returns the decorated reply.
 */
export async function applyResponseDecorators(
  decorators: ReadonlyArray<AgentExecutionResponseDecorator>,
  logger: Logger,
  execution: AgentExecution,
  response: UpdateStatusResponse,
): Promise<UpdateStatusResponse> {
  let decorated = response;
  for (const decorator of decorators) {
    const candidate = clone(UpdateStatusResponseSchema, decorated);
    try {
      await decorator(execution, candidate);
      decorated = candidate;
    } catch (error) {
      logger.warn("response decorator failed (extension bug, ignored)", {
        executionId: execution.metadata?.id ?? "",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return decorated;
}
