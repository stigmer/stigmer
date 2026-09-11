/**
 * The session run-target resolver (P1 sp.run-gate): a session is a
 * conversation bound to ONE agent instance, so its run target is that
 * instance — agent_instance#can_execute on spec.agent_instance_id.
 *
 * Pure over the record being built. ResolveDefaultAgentInstance runs before
 * the gate and guarantees the id (the caller's, or the platform default
 * agent's default instance), so an empty id here is that step's own
 * refusal already thrown, never a check to make. Read from newState, where
 * the resolution writes — the same clone gotcha steps.ts records.
 */
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

import {
  RUN_GATE_CHECKS,
  type RunTarget,
} from "../../pipeline/steps/authorize-run-target.js";
import { runAgentInstanceDeniedMessage } from "./constants.js";

export function sessionRunTarget(session: Session): RunTarget | undefined {
  const agentInstanceId = session.spec?.agentInstanceId ?? "";
  if (agentInstanceId === "") {
    return undefined;
  }
  return {
    ...RUN_GATE_CHECKS.agentInstance,
    resourceId: agentInstanceId,
    deniedMessage: runAgentInstanceDeniedMessage(agentInstanceId),
  };
}
