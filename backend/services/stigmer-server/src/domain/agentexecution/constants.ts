/**
 * AgentExecution byte-pinned wire copy — every string a client can observe
 * from this domain, copied character-for-character from the Go controller
 * (pkg/domain/agentexecution/controller). Coexistence rule: the Go server
 * is the behavioral reference; do not "improve" copy here (guidelines §2).
 */

/**
 * create's engine-gate refusal (create.go engineUnavailableMessage) —
 * kept identical across AgentExecution and WorkflowExecution so both
 * domains present one symmetric create-boundary contract. Pinned by the
 * conformance engine-gate test (CW-7).
 */
export const ENGINE_UNAVAILABLE_MESSAGE =
  "The execution engine is temporarily unavailable. Please try again shortly.";

/**
 * getExecutionUsageReport's unknown-execution refusal. Go
 * (get_execution_usage_report.go) calls
 * NotFoundError("agent execution '%s' not found", executionID) — but that
 * helper's signature is (resource, id) rendering "%s not found: %s", so
 * the literal '%s' and the doubled "not found" reach the wire. Ported
 * byte-faithfully per sub-project DD-001 (owner-ratified 2026-08-24);
 * the both-editions fix is stigmer/stigmer#859.
 */
export function executionUsageReportNotFoundMessage(
  executionId: string,
): string {
  return `agent execution '%s' not found not found: ${executionId}`;
}

/**
 * The run gate's deny copy per request shape (P1 sp.run-gate, ruling
 * Q-RG-4; wire once merged, asserted by the conformance run-gate suite).
 * NEW copy quotes the handle single-quoted (the ratified 2026-08-26 rule).
 * An AgentExecution is a RUN in the ubiquitous language, hence "run";
 * a turn added to an existing conversation is "an execution in a session",
 * the session's own permission.
 */
export function runAgentDeniedMessage(agentId: string): string {
  return `unauthorized to run agent '${agentId}'`;
}

/**
 * Identical to the session domain's instance copy on purpose — one fact,
 * one sentence (the ENGINE_UNAVAILABLE_MESSAGE precedent for cross-domain
 * twins: each domain owns its constant, the twin is named here).
 */
export function runAgentInstanceDeniedMessage(agentInstanceId: string): string {
  return `unauthorized to run agent instance '${agentInstanceId}'`;
}

export function addExecutionToSessionDeniedMessage(sessionId: string): string {
  return `unauthorized to add an execution to session '${sessionId}'`;
}
