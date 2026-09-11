/**
 * Session byte-pinned wire copy — every string a client can observe from
 * this domain that is not already a proto annotation's error_msg. Wire
 * once merged: the conformance run-gate suite asserts these characters.
 */

/**
 * The run gate's deny copy when a session names an agent instance the
 * caller may not run (P1 sp.run-gate, ruling Q-RG-4). NEW copy quotes the
 * handle single-quoted (the ratified 2026-08-26 quoting rule). Identical to
 * the agent-execution domain's instance copy on purpose — one fact, one
 * sentence — the ENGINE_UNAVAILABLE_MESSAGE precedent for cross-domain
 * twins: each domain owns its constant, the twin is named here.
 */
export function runAgentInstanceDeniedMessage(agentInstanceId: string): string {
  return `unauthorized to run agent instance '${agentInstanceId}'`;
}
