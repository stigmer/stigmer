// Cross-kind run-control tools. Currently just cancel_run — the one control
// verb whose argument shape is identical for agent and workflow runs, so a
// single ID-prefix-dispatched tool serves both (the "crisp schemas over
// fewer tools" principle cuts the other way for approvals, whose shapes are
// disjoint). pause/resume/terminate stay CLI-only until a real MCP need
// shows up.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveToken, type BackendTarget } from "../client.js";
import { textOrError } from "../toolresult.js";
import { cancelRun } from "./cancel.js";

/** Register the cross-kind run-control tools; returns the registered tool names. */
export function registerRunControlTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "cancel_run",
    {
      description:
        "Gracefully cancel a running agent (aex_*) or workflow (wex_*) run — the kind is " +
        "inferred from the ID prefix. Cancellation is terminal: the run stops after cleanup and " +
        "cannot be resumed. Runs already in a terminal phase are returned with " +
        "already_terminal=true instead of an error.",
      inputSchema: {
        run_id: z.string().describe("Run ID to cancel (aex_* or wex_* format)."),
        reason: z
          .string()
          .optional()
          .describe("Human-readable reason for the cancellation, stored in the audit trail."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        cancelRun(
          target.serverAddress,
          resolveToken(extra, target.apiKey),
          args.run_id,
          args.reason ?? "",
        ),
      ),
  );

  return ["cancel_run"];
}
