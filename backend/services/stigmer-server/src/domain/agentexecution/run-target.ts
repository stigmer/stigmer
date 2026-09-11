/**
 * The agent-execution run-target resolver (P1 sp.run-gate, ruling Q-RG-2):
 * an execution names its run target in one of three shapes, and the gate
 * dispatches on them in the CHAIN's own precedence so it authorizes the
 * target the chain will actually use (CreateDefaultInstanceIfNeeded and
 * CreateSessionIfNeeded read them in exactly this order):
 *
 *   1. spec.session_id — a turn added to an existing conversation: the
 *      session's own permission, session#can_create_execution_in;
 *   2. spec.session_spec.agent_instance_id — a new conversation on an
 *      explicit instance: agent_instance#can_execute;
 *   3. spec.agent_id — a new conversation on the blueprint's default
 *      instance, which the chain resolves (or mints) only AFTER the gate:
 *      agent#can_execute, the blueprint's permission (the model derives
 *      the default instance's viewers from the blueprint's, so the two
 *      questions have one answer; asking the blueprint's is what lets the
 *      gate precede the side effect).
 *
 * None of the three set is EnsureSessionOrAgentResolved's invariant arm
 * (ResolveDefaultAgent guarantees one), never a check. Pure over the record
 * being built, where ResolveDefaultAgent writes the resolved agent_id.
 */
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

import {
  RUN_GATE_CHECKS,
  type RunTarget,
} from "../../pipeline/steps/authorize-run-target.js";
import {
  addExecutionToSessionDeniedMessage,
  runAgentDeniedMessage,
  runAgentInstanceDeniedMessage,
} from "./constants.js";

export function agentExecutionRunTarget(
  execution: AgentExecution,
): RunTarget | undefined {
  const spec = execution.spec;
  const sessionId = spec?.sessionId ?? "";
  if (sessionId !== "") {
    return {
      ...RUN_GATE_CHECKS.session,
      resourceId: sessionId,
      deniedMessage: addExecutionToSessionDeniedMessage(sessionId),
    };
  }
  const agentInstanceId = spec?.sessionSpec?.agentInstanceId ?? "";
  if (agentInstanceId !== "") {
    return {
      ...RUN_GATE_CHECKS.agentInstance,
      resourceId: agentInstanceId,
      deniedMessage: runAgentInstanceDeniedMessage(agentInstanceId),
    };
  }
  const agentId = spec?.agentId ?? "";
  if (agentId !== "") {
    return {
      ...RUN_GATE_CHECKS.agent,
      resourceId: agentId,
      deniedMessage: runAgentDeniedMessage(agentId),
    };
  }
  return undefined;
}
