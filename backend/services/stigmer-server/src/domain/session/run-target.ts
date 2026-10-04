/**
 * The session run-target resolver: a session that names an agent has that
 * agent as its run target — agent#can_execute on status.agent_id, the id
 * ResolveSessionAgent pinned from spec.agent_ref (a slug cannot be checked
 * by a pure resolver; the resolved id is the mid-chain form).
 *
 * Asked only when the write introduces or changes the agent: a create that
 * names one, or an update whose pinned agent differs from the stored row's.
 * An update that keeps the agent (an echo, or a move to another version of
 * the same agent) is not re-asked; every turn asks it again anyway
 * (agent-execution's AuthorizeRunAgent), so a person who lost the agent
 * gains nothing by editing a session they still own.
 *
 * No agent is the built-in assistant (session/v1/spec.proto): there is no
 * blueprint to spend, so the answer is "no target" and the gate makes no
 * check. What admits the conversation is the Authorize step ahead of the
 * gate — can_create_session on the organization on create, the session's
 * own can_edit on update. Pure over the two records.
 */
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

import {
  RUN_GATE_CHECKS,
  type RunTarget,
} from "../../pipeline/steps/authorize-run-target.js";
import { runAgentDeniedMessage } from "./constants.js";

export function sessionRunTarget(
  session: Session,
  stored: Session | undefined,
): RunTarget | undefined {
  const agentId = session.status?.agentId ?? "";
  if (agentId === "" || agentId === (stored?.status?.agentId ?? "")) {
    return undefined;
  }
  return {
    ...RUN_GATE_CHECKS.agent,
    resourceId: agentId,
    deniedMessage: runAgentDeniedMessage(agentId),
  };
}
