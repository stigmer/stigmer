/**
 * The execution-engine seam — the ONE place the agentexecution controller
 * touches Temporal-shaped behavior before sub-project #18 lands the real
 * worker infrastructure.
 *
 * Go models engine availability as two separately-injected nilable fields
 * on the controller (workflowCreator for create/signal/recover,
 * temporalClient for the lifecycle RPCs), re-injected by TemporalManager
 * on every reconnect. The TS guidelines forbid nullable modeling of
 * optional infrastructure, so availability is an explicit two-variant
 * state instead; #18's TemporalManager will flip the provider between the
 * variants on connect/disconnect, exactly where Go calls
 * SetWorkflowCreator/SetTemporalClient.
 *
 * Until #18, the composition root wires ENGINE_DISCONNECTED permanently —
 * byte-identical behavior to the Go server running without Temporal:
 * create refuses Unavailable at the gate (create.go
 * ensureEngineAvailableStep), lifecycle RPCs refuse FailedPrecondition,
 * and submitApproval records the decision but skips the resolved-gate
 * signal with a WARN (submit_approval.go signalWorkflowStep).
 *
 * The connected variant's operation surface is deliberately EMPTY here:
 * #18 owns its shape (workflow creator + lifecycle client + signals), and
 * pre-declaring it would be an architecture decision made outside that
 * sub-project's plan gate.
 */
import type { RequestContext } from "../../pipeline/request-context.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { unavailableError } from "../../pipeline/errors.js";
import type { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

import { ENGINE_UNAVAILABLE_MESSAGE } from "./constants.js";

/**
 * The engine operations the controller consumes once Temporal is wired.
 * Populated by #18 (sp.agentexecution-orchestration); empty by design
 * until then — see the module header.
 */
export interface ConnectedExecutionEngine {}

/** Engine availability as an explicit modeled state (guidelines §4). */
export type ExecutionEngineState =
  | { readonly connected: true; readonly engine: ConnectedExecutionEngine }
  | { readonly connected: false };

/**
 * The permanent pre-#18 state: no Temporal behind this server. A frozen
 * singleton so identity comparisons in tests stay meaningful.
 */
export const ENGINE_DISCONNECTED: ExecutionEngineState = Object.freeze({
  connected: false,
});

/**
 * A provider rather than a value: #18's TemporalManager re-injects on
 * every reconnect (Go's SetWorkflowCreator), so consumers must observe
 * the CURRENT state at request time, never a boot-time snapshot.
 */
export type ExecutionEngineStateProvider = () => ExecutionEngineState;

/**
 * EnsureEngineAvailable — create.go ensureEngineAvailableStep: rejects the
 * create fast — before any persistence or side effect — when the engine is
 * not connected. Placed after input validation but before the first
 * side-effecting step, so a malformed request still gets InvalidArgument
 * first and a down engine orphans nothing (no default instance, no
 * auto-created session, no ExecutionContext, no execution record).
 */
export function newEnsureEngineAvailableStep(
  engineState: ExecutionEngineStateProvider,
): PipelineStep<typeof AgentExecutionSchema> {
  return {
    name: "EnsureEngineAvailable",
    execute(_ctx: RequestContext<typeof AgentExecutionSchema>): void {
      if (!engineState().connected) {
        throw unavailableError(ENGINE_UNAVAILABLE_MESSAGE);
      }
    },
  };
}
