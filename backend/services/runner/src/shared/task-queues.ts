/**
 * The task-queue prefixes a sandbox's runner serves, in their one home on
 * the runner side: `session:<id>` for a session's sandbox and
 * `mcpconnect:<id>` for a tools listing's connect sandbox. They are pinned
 * wire bytes, the server's `SANDBOX_QUEUE_PREFIXES`
 * (`stigmer-server/src/sandbox/naming.ts`); the runner imports nothing from
 * the server, so `attach/__tests__/push.test.ts` loads the server's module
 * and compares the two.
 *
 * The workflow isolate imports this module (`workflows/list-plugin-tools.ts`
 * refuses a listing started on a session's queue, as its activity does),
 * and the workflow bundle carries every module it reaches. So it stays free
 * of imports and of anything but constants.
 */

/** The queue a session's sandbox serves, before its session id. */
export const SESSION_QUEUE_PREFIX = "session:";

/** The queue a tools listing's connect sandbox serves, before its attempt id. */
export const CONNECT_QUEUE_PREFIX = "mcpconnect:";

/**
 * The failure type of a tools listing refused for running on a session's
 * queue, by the connect workflow or by its activity; matched by type, never
 * by wording.
 */
export const LISTING_ON_SESSION_QUEUE_FAILURE_TYPE = "ListingOnSessionQueue";
