/**
 * The synthetic execution id of an MCP connect — the ONE home for its
 * shape, built here by the connect lane and recognized here by the
 * runner-credential lane, so the two can never drift apart.
 *
 * A connect is not an execution: it has no AgentExecution or
 * WorkflowExecution row. What it has is an ephemeral ExecutionContext
 * (connect.ts `createConnectExecutionContext`) whose `spec.execution_id`
 * must name SOMETHING for the decrypt lane's binding check
 * (executioncontext/resolve-values-for-caller.ts: the token's
 * `execution_id` claim must equal the EC's), and this id is that
 * something — an id that names no resource kind, so the contract's
 * `kind_meta` prefix table (pipeline/apiresource-meta.ts) cannot mistake
 * it for a row. The runner-credential lane reads it the other way round
 * (runnerauth/bound-execution.ts `boundExecutionKindOf`): an id this
 * predicate recognizes is a connect binding, resolved through the EC row
 * whose `spec.execution_id` it is. Keep the builder and the predicate
 * together; a second copy of the prefix anywhere would be the drift this
 * module exists to prevent.
 */
import { randomUUID } from "node:crypto";

/** The prefix every connect execution id carries — no resource kind's id starts with it. */
const CONNECT_EXECUTION_ID_PREFIX = "connect-";

/** One connect's execution id: the server it discovers plus eight hex of entropy per attempt. */
export function newConnectExecutionId(mcpServerId: string): string {
  return `${CONNECT_EXECUTION_ID_PREFIX}${mcpServerId}-${randomUUID().slice(0, 8)}`;
}

/** Whether `executionId` is a connect's — the runner-credential lane's recognition of the third binding. */
export function isConnectExecutionId(executionId: string): boolean {
  return executionId.startsWith(CONNECT_EXECUTION_ID_PREFIX);
}
