/**
 * McpServer connect workflow wire identifiers — cross-edition constants
 * copied character-for-character from Go (connect.go:31-32, 584-586).
 * Renaming one is a wire protocol break (guidelines §2).
 */

/** The runner's connect workflow type (Go connectWorkflowName). */
export const CONNECT_WORKFLOW_NAME = "stigmer/mcp-server/connect";

/**
 * The deterministic workflow ID for a server's connect operation (Go
 * connectWorkflowID). One ID per server (no random suffix) makes Temporal
 * itself the authority on "is a connect already running": a second start
 * while one is in flight is refused with WorkflowExecutionAlreadyStarted,
 * which the lanes turn into attach semantics — concurrent connects share
 * one discovery run instead of racing duplicate workflows against the
 * same server. A new run under the same ID is allowed once the previous
 * one closes (the SDK's default reuse policy), which is what a reconnect
 * is.
 */
export function connectWorkflowIdFor(mcpServerId: string): string {
  return `${CONNECT_WORKFLOW_NAME}/${mcpServerId}`;
}
