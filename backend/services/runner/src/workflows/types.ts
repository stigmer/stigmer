/**
 * Workflow boundary types for the MCP server connect flow.
 *
 * These types define the Temporal wire contract between the Java/Go
 * backend (which starts and reads the workflow) and the TypeScript
 * workflow implementation. Field names use snake_case to match the
 * server's keys exactly — Temporal's TS SDK does plain JSON
 * serialization with no name transformation. The one camelCase key,
 * `WireToolResult.destructiveHint`, is pinned as spelled on both sides.
 *
 * IMPORTANT: This file MUST contain only plain TypeScript interfaces
 * with zero runtime imports. It is imported by the workflow file
 * which runs inside the Temporal deterministic sandbox.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Input (from Java's McpServerConnectHandler)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConnectMcpServerWorkflowInput {
  mcp_server_id: string;
  execution_context_id?: string | null;
  /**
   * Execution-scoped token for reading the connect ExecutionContext's
   * decrypted credentials (oss#535). Populated by the OSS Go handler, whose
   * EC read RPCs redact secrets for tokenless callers; absent on cloud,
   * where the discovery activity's ambient connect_sandbox credential
   * decrypts on its own.
   */
  execution_context_token?: string | null;
  invoker_identity_account_id?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Output (read by Java's StoreConnectResults)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConnectMcpServerWorkflowOutput {
  tools: WireToolResult[];
  resource_templates: WireResourceTemplateResult[];
}

export interface WireToolResult {
  name: string;
  description: string;
  input_schema?: Record<string, unknown> | null;
  /**
   * True only when the tool's MCP annotations carry an explicit
   * `destructiveHint: true`, whatever `readOnlyHint` says. camelCase, unlike
   * its siblings: the server reads this exact key and persists it as
   * `DiscoveredTool.destructive_hint`. Pinned bytes on both sides.
   */
  destructiveHint: boolean;
}

export interface WireResourceTemplateResult {
  uri_template: string;
  name: string;
  description: string;
  mime_type: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Discover-only Workflow Output
// ─────────────────────────────────────────────────────────────────────────────

/** The legacy workflow's result: the same discovery, in the same shape. */
export type DiscoverMcpServerWorkflowOutput = ConnectMcpServerWorkflowOutput;
