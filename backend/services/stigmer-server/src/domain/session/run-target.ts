/**
 * The session run-target resolver (P1 sp.run-gate): a session bound to an
 * agent instance has that instance as its run target —
 * agent_instance#can_execute on spec.agent_instance_id.
 *
 * Pure over the record being built. An empty id is the built-in assistant
 * (session/v1/spec.proto): there is no blueprint to spend, so the answer is
 * "no target" and the gate makes no check. What admits the conversation is
 * the Authorize step ahead of the gate — can_create_session on the
 * organization — and each turn is admitted by the session's own
 * can_create_execution_in on the execution chain.
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
