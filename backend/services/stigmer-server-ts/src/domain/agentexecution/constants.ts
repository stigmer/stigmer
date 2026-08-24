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
