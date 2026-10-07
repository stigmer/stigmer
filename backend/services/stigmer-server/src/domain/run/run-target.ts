/**
 * The agent-execution run-gate resolvers: a turn asks two questions, in an
 * order that discloses nothing about a conversation to a caller who may not
 * add to it.
 *
 *   1. agentExecutionRunTarget (AuthorizeRunTarget, before anything stored
 *      is read): a turn added to an existing conversation asks the
 *      session's own permission, session#can_create_run_in. A new
 *      conversation asks nothing here: its session create (run as the
 *      caller by CreateSessionIfNeeded) asks can_create_session on the
 *      organization and can_execute on the agent it names.
 *   2. agentExecutionRunAgent (AuthorizeRunAgent, after ResolveRunAgent
 *      stamped the agent the turn runs): agent#can_execute on
 *      status.agent_id, the session's pinned agent or the new session's
 *      resolved one. So a person who lost the agent cannot keep using it
 *      through a conversation they still own, and nothing a client sends
 *      reaches the check: BuildNewState cleared status before the stamp.
 *
 * No agent is the built-in assistant (agentrun/v1/spec.proto): there
 * is no blueprint to spend, so the second resolver answers no target. Both
 * are pure over the record being built.
 */
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";

import {
  RUN_GATE_CHECKS,
  type RunTarget,
} from "../../pipeline/steps/authorize-run-target.js";
import {
  addExecutionToSessionDeniedMessage,
  runAgentDeniedMessage,
} from "./constants.js";
import { sessionIdOf } from "./target.js";

export function agentExecutionRunTarget(
  execution: Run,
): RunTarget | undefined {
  const sessionId = sessionIdOf(execution.spec);
  if (sessionId === "") {
    return undefined;
  }
  return {
    ...RUN_GATE_CHECKS.session,
    resourceId: sessionId,
    deniedMessage: addExecutionToSessionDeniedMessage(sessionId),
  };
}

export function agentExecutionRunAgent(
  execution: Run,
): RunTarget | undefined {
  const agentId = execution.status?.agentId ?? "";
  if (agentId === "") {
    return undefined;
  }
  return {
    ...RUN_GATE_CHECKS.agent,
    resourceId: agentId,
    deniedMessage: runAgentDeniedMessage(agentId),
  };
}
