/**
 * Workflow boundary types for a plugin's tools listing (the
 * `stigmer/mcp-server/connect` workflow type, a pinned name).
 *
 * These types define the Temporal wire contract between the server (which
 * starts the workflow and reads its result,
 * `backend/services/stigmer-server/src/domain/plugin/tools/engine.ts`) and
 * the workflow. Field names use snake_case to match the server's keys
 * exactly — Temporal's TS SDK does plain JSON serialization with no name
 * transformation. The one camelCase key, `WireToolResult.destructiveHint`,
 * is pinned as spelled on both sides.
 *
 * IMPORTANT: This file MUST contain only plain TypeScript interfaces
 * with zero runtime imports. It is imported by the workflow file
 * which runs inside the Temporal deterministic sandbox.
 */

export interface ListPluginToolsWorkflowInput {
  plugin_id: string;
  /** The server's name in the plugin. */
  server: string;
  /** The listing's attempt, whose values it fetches; absent when the server reads none. */
  execution_context_id?: string | null;
  /**
   * Execution-scoped token bound to the attempt, the authority of the
   * listing's value fetch. Absent on an edition whose ambient connect
   * sandbox credential is bound to the attempt on its own.
   */
  execution_context_token?: string | null;
}

export interface ListPluginToolsWorkflowOutput {
  tools: WireToolResult[];
}

export interface WireToolResult {
  name: string;
  description: string;
  /**
   * True only when the tool's MCP annotations carry an explicit
   * `destructiveHint: true`, whatever `readOnlyHint` says. camelCase, unlike
   * its siblings: the server reads this exact key. Pinned bytes on both
   * sides.
   */
  destructiveHint: boolean;
}
