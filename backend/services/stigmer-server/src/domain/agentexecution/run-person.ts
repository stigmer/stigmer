/**
 * Whose run is this — the person an execution's person-scoped reads act
 * for. Today one read asks it: the personal-environment fill-ins of the
 * execution-context builder (a session's git clone token and its own MCP
 * servers' declared keys), which must read the run's person's saved
 * values and never a teammate's.
 *
 * The person is the execution's creator stamp
 * (`status.audit.spec_audit.created_by.id`), which the server stamped from
 * the verified caller. It is read from the PERSISTED execution, never from
 * the request, so a recover — which rebuilds the context with no caller at
 * all — gets the answer create got. It is the TURN's creator, not the
 * session's: a teammate who adds a turn to someone else's conversation
 * runs with their own keys. (The cloud's run credential binds to the
 * session's creator instead, on purpose: that credential decrypts every
 * turn of the session. Different question, different answer.)
 *
 * A run has no person when:
 *
 *   - it carries no creator stamp; or
 *   - a schedule fired it (`stigmer.ai/schedule-id`), in every edition.
 *     Open source's fire acts as the schedule's creator, so its stamp
 *     names a person; the label is what makes it unattended. A schedule
 *     that needs its owner's values binds their environment on the
 *     schedule itself, deliberately.
 *
 * A visitor's, a channel's and a cloud schedule's runs need no rule of
 * their own: their stamp is the organization's system lane account, which
 * holds no member role and so never creates a personal environment
 * (`can_create_environment: member`, organization.fga). A workflow
 * `agent_call` child's stamp is the person who started the workflow. Under
 * trusted-local the operator, the server's internal class and every row
 * share one stamp, so the single user keeps every fill-in.
 */
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

import { createdByOf } from "../../pipeline/steps/authorization-facts.js";

/**
 * The audit link stamped on every schedule-created execution by the run
 * starter (temporal/schedule/run-starter.ts), read here and by the
 * builder's schedule layer. Pinned beside its readers with its lineage (Go
 * scheduletemporal.ScheduleIDLabelKey), as the builder pinned it before.
 */
export const SCHEDULE_ID_LABEL_KEY = "stigmer.ai/schedule-id";

/** The run's person's creator stamp, or `undefined` when the run has none. */
export function runPersonOf(execution: AgentExecution): string | undefined {
  if ((execution.metadata?.labels[SCHEDULE_ID_LABEL_KEY] ?? "") !== "") {
    return undefined;
  }
  const stamp = createdByOf(execution);
  return stamp === "" ? undefined : stamp;
}
