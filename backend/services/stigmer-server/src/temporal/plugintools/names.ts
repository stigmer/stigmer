/**
 * The tools listing's workflow wire identifiers: the runner's connect
 * workflow type, kept under its original name because a workflow type is a
 * pinned wire identifier, the workflow id a listing starts under, and the
 * connect sandbox's task queue (stigmer/stigmer#1474), which a sandboxed
 * runner polls. Renaming one is a wire protocol break.
 */

/** The runner's connect workflow type: lists one server's tools. */
export const CONNECT_WORKFLOW_NAME = "stigmer/mcp-server/connect";

/**
 * The workflow id of one listing: its attempt's id, unique per listing, so
 * two people listing one server never share a run (each run reads its own
 * person's vault, and its answer is that person's).
 */
export function listingWorkflowIdFor(attemptId: string): string {
  return `${CONNECT_WORKFLOW_NAME}/${attemptId}`;
}

/**
 * The task queue one connect sandbox serves: its runner polls exactly this
 * queue (STIGMER_TASK_QUEUE) and the listing workflow is started on it. The
 * colon form of every per-queue name (`session:`, `sandbox:`); the id is
 * the listing's attempt id (domain/plugin/tools/execution-id.ts), unique
 * per listing, so two listings never share a sandbox.
 */
export function connectTaskQueueFor(connectExecutionId: string): string {
  return `mcpconnect:${connectExecutionId}`;
}
