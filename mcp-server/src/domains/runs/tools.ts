// MCP tools for runs: start a run, poll it, answer its approval requests,
// and cancel it. Together they close the agent iteration loop: author with
// apply_agent, run with run_agent, observe with get_run, steer with
// submit_run_approval, stop with cancel_run.
//
// A run is asynchronous by design: run_agent returns as soon as the backend
// accepts the run; progress is observed by polling. Runs have no event-log
// RPC, so get_run IS the poll loop — which is why it defaults to the compact
// view (see fetch.ts). pause/resume/terminate stay CLI-only until a real MCP
// need shows up.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveToken, type BackendTarget } from "../client.js";
import { textOrError } from "../toolresult.js";
import { submitRunApproval } from "./approve.js";
import { cancelRun } from "./cancel.js";
import { DEFAULT_MESSAGE_LIMIT, fetchRun } from "./fetch.js";
import { runAgent } from "./run.js";

/** Register the tools that start, observe and steer a run; returns the registered tool names. */
export function registerRunTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "run_agent",
    {
      description:
        "Start an agent run (asynchronous). Returns immediately with the created run " +
        "(run_* ID) while the run continues in the background — poll get_run to observe " +
        "progress, pending approvals, and the final result. Omit session_id to start a fresh " +
        "conversation on the agent; pass one to send a follow-up message into an existing session, " +
        "which runs the agent the session started on.",
      inputSchema: {
        org: z
          .string()
          .default("")
          .describe(
            "Organization slug that owns the agent (e.g. acme). Leave empty on a server that holds one organization.",
          ),
        agent: z
          .string()
          .describe("Agent slug — the unique identifier within the org (e.g. code-reviewer)."),
        message: z.string().describe("The instruction or message for the agent to act on."),
        session_id: z
          .string()
          .optional()
          .describe(
            "Existing session ID to continue a conversation (from a previous run's " +
              "spec.session_id). Omit to start a new session. A turn in a session runs the agent " +
              "the session started on and belongs to that session's organization, which the server " +
              "applies. `agent` (and `org`, when given) must name the session's agent, or the call " +
              "is refused; neither is sent with the turn.",
          ),
        runtime_env: z
          .record(z.string())
          .optional()
          .describe(
            "Non-secret runtime environment values (name → value) injected into the run. Every key the agent " +
              "declares that is not passed here is read from the personal Environment of the caller (the person " +
              "the run belongs to), when the agent is in the run's organization; a secret belongs there, never in " +
              "this tool.",
          ),
      },
    },
    (args, extra) =>
      textOrError(() =>
        runAgent(target.serverAddress, resolveToken(extra, target.apiKey), {
          org: args.org,
          agent: args.agent,
          message: args.message,
          sessionId: args.session_id,
          runtimeEnv: args.runtime_env,
        }),
      ),
  );

  server.registerTool(
    "get_run",
    {
      description:
        "Get a run's status: phase, messages, pending approvals, errors, timing. " +
        "Runs have no event log — poll this tool to track a run started with run_agent " +
        "(terminal phases: completed, failed, cancelled, terminated). The default compact view " +
        "returns the last few messages and omits bulky bookkeeping fields (resolved context, " +
        "approval ledger, sub-agent transcripts); total_messages tells you when the tail is a " +
        "window. Use view=full for the complete record.",
      inputSchema: {
        run_id: z.string().describe("Run ID (run_*, or aex_* for a run created before the rename)."),
        view: z
          .enum(["compact", "full"])
          .optional()
          .describe("Response shape: compact (default, bounded message tail) or full protojson."),
        message_limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(`Compact view only: number of trailing messages to return (default ${DEFAULT_MESSAGE_LIMIT}).`),
      },
    },
    (args, extra) =>
      textOrError(() =>
        fetchRun(
          target.serverAddress,
          resolveToken(extra, target.apiKey),
          args.run_id,
          args.view ?? "compact",
          args.message_limit ?? DEFAULT_MESSAGE_LIMIT,
        ),
      ),
  );

  server.registerTool(
    "submit_run_approval",
    {
      description:
        "Approve, skip, or reject a tool call a run is waiting on (phase " +
        "waiting-for-approval). Find pending requests in get_run's " +
        "status.pending_approvals — tool_call_id must match exactly. reject denies the single " +
        "tool call and feeds your comment back to the agent, which then continues; to stop the " +
        "whole run use cancel_run instead.",
      inputSchema: {
        run_id: z.string().describe("Run ID (run_*, or aex_* for a run created before the rename)."),
        tool_call_id: z
          .string()
          .describe("Tool call awaiting the decision (status.pending_approvals[].tool_call_id)."),
        action: z
          .enum(["approve", "skip", "reject"])
          .describe(
            "approve: execute the tool. skip: don't execute, agent proceeds without it. " +
              "reject: don't execute, agent is told why (see comment) and adapts.",
          ),
        comment: z
          .string()
          .optional()
          .describe("Reason for the decision; on reject it is fed back to the agent."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        submitRunApproval(target.serverAddress, resolveToken(extra, target.apiKey), {
          runId: args.run_id,
          toolCallId: args.tool_call_id,
          action: args.action,
          comment: args.comment,
        }),
      ),
  );

  return ["run_agent", "get_run", "submit_run_approval"];
}

/** Register the tools that control a running run; returns the registered tool names. */
export function registerRunControlTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "cancel_run",
    {
      description:
        "Gracefully cancel a run in progress (run_*, or aex_* from before the rename). " +
        "Cancellation is terminal: the run stops after cleanup and " +
        "cannot be resumed. Runs already in a terminal phase are returned with " +
        "already_terminal=true instead of an error.",
      inputSchema: {
        run_id: z.string().describe("Run ID to cancel (run_*, or aex_* for a run created before the rename)."),
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
