/**
 * The one reading of an execution's `target` oneof the runner needs: the
 * session a turn runs in. By the time a turn is dispatched the server has
 * created any new session the turn started and recorded it on the target's
 * session_id arm, so the runner never reads the session_spec arm. An unset
 * target and a session_id arm holding an empty string both read as "", so
 * no reader spells the oneof's empty case its own way.
 *
 * Pinned by shared/__tests__/execution-target.test.ts.
 */

import type { AgentExecutionSpec } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";

/** The session a turn runs in, or "" when its target names none. */
export function sessionIdOf(spec: AgentExecutionSpec | undefined): string {
  return spec?.target.case === "sessionId" ? spec.target.value : "";
}
