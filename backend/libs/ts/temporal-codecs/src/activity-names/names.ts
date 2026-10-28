/**
 * The Temporal activity names the runner registers and the server's agent
 * execution workflow calls. They live here, in the one library both
 * processes already depend on, because the two sides must agree byte for
 * byte and a split shows only as a run stuck until its schedule-to-start
 * timeout: the workflow schedules a name no worker polls for. Declared
 * once, neither side can drift.
 *
 * Every value is a pinned wire identifier: a run in flight carries these
 * names in its history, so renaming one is a protocol break, not a cleanup.
 *
 * Dependency-free on purpose: the server's workflow bundle imports this
 * module inside Temporal's workflow sandbox, which refuses Node built-ins,
 * and the runner's attach entry keeps a short import allowlist.
 */

/** Opens (or names) the conversation a turn runs in; no I/O for an engine whose state id is derived. */
export const ENSURE_THREAD_ACTIVITY_NAME = "EnsureThread";

/** One turn on Stigmer's native engine. */
export const EXECUTE_DEEP_AGENT_ACTIVITY_NAME = "ExecuteDeepAgent";

/** One turn on Anthropic's Claude Agent SDK engine. */
export const EXECUTE_CLAUDE_ACTIVITY_NAME = "ExecuteClaude";

/** Names a new conversation from its first message. */
export const GENERATE_SESSION_SUBJECT_ACTIVITY_NAME = "GenerateSessionSubject";
