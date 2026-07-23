// Cross-kind execution-control tools. Currently just cancel_execution — the
// one control verb whose argument shape is identical for agent and workflow
// executions, so a single ID-prefix-dispatched tool serves both (the
// "crisp schemas over fewer tools" principle cuts the other way for
// approvals, whose shapes are disjoint). pause/resume/terminate stay
// CLI-only until a real MCP need shows up.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveToken, type BackendTarget } from "../client.js";
import { textOrError } from "../toolresult.js";
import { cancelExecution } from "./cancel.js";

/** Register the cross-kind execution-control tools; returns the registered tool names. */
export function registerExecutionControlTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "cancel_execution",
    {
      description:
        "Gracefully cancel a running agent (aex_*) or workflow (wex_*) execution — the kind is " +
        "inferred from the ID prefix. Cancellation is terminal: the run stops after cleanup and " +
        "cannot be resumed. Executions already in a terminal phase are returned with " +
        "already_terminal=true instead of an error.",
      inputSchema: {
        execution_id: z.string().describe("Execution ID to cancel (aex_* or wex_* format)."),
        reason: z
          .string()
          .optional()
          .describe("Human-readable reason for the cancellation, stored in the audit trail."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        cancelExecution(
          target.serverAddress,
          resolveToken(extra, target.apiKey),
          args.execution_id,
          args.reason ?? "",
        ),
      ),
  );

  return ["cancel_execution"];
}
