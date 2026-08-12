/**
 * Workflow boundary types for the MCP server connect flow.
 *
 * These types define the Temporal wire contract between the Java/Go
 * backend (which starts and reads the workflow) and the TypeScript
 * workflow implementation. All field names use snake_case to match
 * the Java `Map<String, Object>` keys exactly — Temporal's TS SDK
 * does plain JSON serialization with no name transformation.
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
  tool_approvals: WireToolApproval[];
}

export interface WireToolResult {
  name: string;
  description: string;
  input_schema?: Record<string, unknown> | null;
}

export interface WireResourceTemplateResult {
  uri_template: string;
  name: string;
  description: string;
  mime_type: string;
}

export interface WireToolApproval {
  tool_name: string;
  requires_approval: boolean;
  message: string;
  /**
   * True when the connect-time destructiveHint tightener force-gated this tool
   * (see applyDestructiveHintTightener). Persisted to
   * ToolApprovalPolicy.from_destructive_hint so the runner attributes the gate to
   * the annotation rather than the classifier. Omitted on classifier/pinned
   * entries.
   */
  from_destructive_hint?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Discover-only Workflow Output
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscoverMcpServerWorkflowOutput {
  tools: WireToolResult[];
  resource_templates: WireResourceTemplateResult[];
  previous_tools_fingerprint: string;
  previous_tool_approvals: WireToolApproval[];
  new_tools_fingerprint: string;
}
