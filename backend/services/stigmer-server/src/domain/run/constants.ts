/**
 * Run byte-pinned wire copy — every string a client can observe
 * from this domain, copied character-for-character from the Go controller
 * (pkg/domain/agentexecution/controller). Coexistence rule: the Go server
 * is the behavioral reference; do not "improve" copy here (guidelines §2).
 */

/**
 * create's engine-gate refusal (create.go engineUnavailableMessage).
 * Pinned by the conformance engine-gate tests
 * (run.conformance.test.ts).
 */
export const ENGINE_UNAVAILABLE_MESSAGE =
  "The execution engine is temporarily unavailable. Please try again shortly.";

/**
 * The run gate's deny copy per request shape (wire copy, asserted by the
 * conformance run-gate suite). NEW copy quotes the handle single-quoted
 * (the rule since 2026-08-26).
 * A Run is a RUN in the ubiquitous language, hence "run";
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

/**
 * A turn refused because another turn of its session is unfinished
 * (stigmer#2429): a session runs one turn at a time, and a message for a
 * working session goes through sendMessage, which queues it. The reason
 * code lets a client branch without reading the copy.
 */
export function sessionTurnUnfinishedMessage(sessionId: string): string {
  return `session '${sessionId}' has an unfinished turn; send the message with sendMessage, which queues it for that turn, or stop the turn first`;
}

/** The reason a turn is refused while another of its session is unfinished. */
export const SESSION_TURN_UNFINISHED_REASON = "SESSION_TURN_UNFINISHED";

/** A turn refused while messages wait in its session's queue for the turn they start. */
export function sessionQueueWaitsMessage(sessionId: string): string {
  return `session '${sessionId}' has messages waiting for their turn; send the message with sendMessage, which queues it behind them`;
}

/** The reason a message is refused while a turn of its session waits for an answer. */
export const SESSION_TURN_WAITS_FOR_ANSWER_REASON = "SESSION_TURN_WAITS_FOR_ANSWER";

/** A message refused while a turn of its session waits for an answer: answer it first. */
export function sessionTurnWaitsForAnswerMessage(sessionId: string, runId: string): string {
  return `turn '${runId}' of session '${sessionId}' waits for an answer; allow or deny its tool use first (a deny can carry a message for the agent)`;
}

/** The reason a message is refused while a turn of its session is paused. */
export const SESSION_TURN_PAUSED_REASON = "SESSION_TURN_PAUSED";

/** A message refused while a turn of its session is paused: resume it first. */
export function sessionTurnPausedMessage(sessionId: string, runId: string): string {
  return `turn '${runId}' of session '${sessionId}' is paused; resume it first`;
}

/** sendMessage's refusal of a turn that names no existing session. */
export const SEND_MESSAGE_NEEDS_SESSION_MESSAGE =
  "a message is sent to an existing session: set spec.session_id";

/** The reason a turn started from a session's queue is refused: a message it would take no longer waits. */
export const QUEUED_MESSAGE_GONE_REASON = "QUEUED_MESSAGE_GONE";

/** A turn from a session's queue refused because another write took or dropped one of its messages first. */
export function queuedMessageGoneMessage(sessionId: string, eventId: string): string {
  return `queued message '${eventId}' of session '${sessionId}' no longer waits: another turn took it or the session was stopped`;
}
