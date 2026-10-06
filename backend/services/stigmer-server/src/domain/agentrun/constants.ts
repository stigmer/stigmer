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
 * conformance engine-gate tests (agentrun.conformance.test.ts).
 */
export const ENGINE_UNAVAILABLE_MESSAGE =
  "The execution engine is temporarily unavailable. Please try again shortly.";

/**
 * The run gate's deny copy per request shape (wire copy, asserted by the
 * conformance run-gate suite). NEW copy quotes the handle single-quoted
 * (the rule since 2026-08-26).
 * An AgentExecution is a RUN in the ubiquitous language, hence "run";
 * a turn added to an existing conversation is "an execution in a session",
 * the session's own permission.
 */
export function runAgentDeniedMessage(agentId: string): string {
  return `unauthorized to run agent '${agentId}'`;
}

/**
 * A turn's refusal when the agent its session pins has been deleted: the
 * session the caller may add to is named, and the agent by the id the
 * session recorded, with what to do about it. FAILED_PRECONDITION: the
 * request is well formed and the caller admitted, but the conversation's
 * agent is gone.
 */
export function sessionAgentGoneMessage(
  sessionId: string,
  agentId: string,
): string {
  return `session '${sessionId}' runs agent '${agentId}', which no longer exists; update the session to another agent, or start a new conversation`;
}

/**
 * create's refusal of a `parent` link the request may not set: only the
 * workflow run it names (its runner, vouched by the composed credential
 * provider), the server itself, or a holder of the platform's
 * can_write_reserved_labels may link a turn to a workflow run.
 * INVALID_ARGUMENT, the reserved-label guard's code for the same rule.
 */
export const WORKFLOW_PARENT_NOT_VOUCHED_MESSAGE =
  "parent links this execution to a workflow run, which only that workflow run's runner may do; remove parent";

/**
 * create's refusal of a `parent` link that names another workflow run than
 * the execution's stigmer.ai/workflow-execution-id label: a turn belongs
 * to one workflow run.
 */
export function workflowParentMismatchMessage(
  parentId: string,
  labelId: string,
): string {
  return `parent.workflow_run_id '${parentId}' differs from the stigmer.ai/workflow-execution-id label '${labelId}'; a turn belongs to one workflow run`;
}

/**
 * update's refusal of a changed `parent` link: the workflow run a turn was
 * started by is a fact of its creation, as its session is.
 */
export const WORKFLOW_PARENT_IMMUTABLE_MESSAGE =
  "parent cannot be changed — an execution keeps the workflow run it was started by";

export function addExecutionToSessionDeniedMessage(sessionId: string): string {
  return `unauthorized to add an execution to session '${sessionId}'`;
}

/**
 * create's same-organization refusal (stigmer/stigmer#1580): a turn in an
 * existing session belongs to that session's organization. It names no
 * organization: the edition lanes (a guest, a channel, a schedule fire)
 * pass the run gate unchecked and are admitted later, in the gate slot, so
 * a caller refused here may not be one who may read the session. A caller
 * who may read the session finds its organization there. The refusal
 * itself still tells a lane caller holding the id that the id names a
 * session and that the organization it sent is not the session's
 * (session-binding.ts says why that stays).
 * Pinned by the conformance agentexecution suite.
 */
export function sessionOrganizationMismatchMessage(sessionId: string): string {
  return `an execution in session '${sessionId}' must belong to the session's organization`;
}

/**
 * update's session refusal (stigmer/stigmer#1588): an execution stays in the
 * session it was created in, as a session keeps its harness
 * (ValidateHarnessImmutability), and one created without a session never
 * joins one past the run gate.
 */
export function sessionIdImmutableMessage(sessionId: string): string {
  if (sessionId === "") {
    return "session_id cannot be set on update — an execution created without a session cannot join one";
  }
  return `session_id cannot be changed — an execution belongs to the session it was created in ('${sessionId}')`;
}
