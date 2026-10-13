/**
 * The sets the server's session event rules are written in. Each event's
 * Managed Agents type string is read from the contract by
 * `@stigmer/session-log`'s catalog (`eventTypeOf`, `SESSION_EVENT_TYPES`),
 * which every client shares; the sets below name events by type string
 * because that is how the outside format, the store and a list filter
 * name them.
 *
 * Who writes what. The server writes the turn's user message, the
 * session's status and each turn's (`stigmer.run.status`,
 * domain/session/events/transitions.ts), every
 * file-review decision (`stigmer.file_review.decided`,
 * ../../run/filereview/decided.ts), every answer to a waiting tool use
 * (`user.tool_confirmation`, `stigmer.permission.grant`,
 * ../hitl/answer.ts) and the session's stop (`user.interrupt`,
 * ../hitl/interrupt.ts); a runner writes what the agent did, its threads,
 * the errors it sees first, and Stigmer's other events about the turn
 * (`RUNNER_EVENT_TYPES`, append.ts), the files a turn changed and the
 * undone files it put back among them, and where an offloaded tool
 * output is stored (`stigmer.tool_result.full_output`). The session's and
 * a turn's status have one writer, the server, so a runner may never send
 * a status event; nor a
 * decision or an answer, so a runner can never forge a person's keep,
 * undo, allow or deny.
 *
 * Proven by __tests__/catalog.test.ts.
 */
/** The id prefix of an event the server mints (`generateId`). */
export const SESSION_EVENT_ID_PREFIX = "sevt";

/** The events that describe the session itself; a run's removal keeps them (run-writes.ts). */
export const SESSION_STATUS_TYPES: ReadonlyArray<string> = [
  "session.status_running",
  "session.status_idle",
];

/**
 * The types a runner may append: what the agent did, its threads, errors,
 * and Stigmer's own events about the turn (the stigmer.* types, which no
 * Managed Agents client needs), all but `stigmer.file_review.decided`,
 * `stigmer.permission.grant` and `stigmer.run.status`, which are the
 * server's.
 */
export const RUNNER_EVENT_TYPES: ReadonlySet<string> = new Set([
  "agent.message",
  "agent.thinking",
  "agent.tool_use",
  "agent.tool_result",
  "agent.mcp_tool_use",
  "agent.mcp_tool_result",
  "agent.thread_message_sent",
  "agent.thread_message_received",
  "agent.thread_context_compacted",
  "session.thread_created",
  "session.thread_status_running",
  "session.thread_status_idle",
  "session.error",
  "stigmer.agent.thinking",
  "stigmer.permission.asked",
  "stigmer.harness.note",
  "stigmer.agent.structured_output",
  "stigmer.memory.recalled",
  "stigmer.file_review.changes",
  "stigmer.file_review.reconciled",
  "stigmer.tool_result.full_output",
]);
