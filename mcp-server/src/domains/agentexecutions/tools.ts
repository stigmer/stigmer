// MCP tools for the AgentExecution domain: start a run, poll it, and answer
// its approval requests. Together with cancel_execution (executions domain)
// these close the agent iteration loop: author with apply_agent, run with
// run_agent, observe with get_agent_execution, steer with
// submit_agent_execution_approval.
//
// The execution model is asynchronous by design: run_agent returns as soon as
// the backend accepts the execution; progress is observed by polling. Agent
// executions have no event-log RPC, so get_agent_execution IS the poll loop —
// which is why it defaults to the compact view (see fetch.ts).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveToken, type BackendTarget } from "../client.js";
import { textOrError } from "../toolresult.js";
import { submitAgentApproval } from "./approve.js";
import { DEFAULT_MESSAGE_LIMIT, fetchAgentExecution } from "./fetch.js";
import { runAgent } from "./run.js";

/** Register every AgentExecution-domain tool; returns the registered tool names. */
export function registerAgentExecutionTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "run_agent",
    {
      description:
        "Start an agent execution (asynchronous). Returns immediately with the created execution " +
        "(aex_* ID) while the run continues in the background — poll get_agent_execution to observe " +
        "progress, pending approvals, and the final result. Omit session_id to start a fresh " +
        "conversation; pass one to send a follow-up message into an existing session.",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the agent (e.g. stigmer)."),
        agent: z
          .string()
          .describe("Agent slug — the unique identifier within the org (e.g. code-reviewer)."),
        message: z.string().describe("The instruction or message for the agent to act on."),
        session_id: z
          .string()
          .optional()
          .describe(
            "Existing session ID to continue a conversation (from a previous execution's " +
              "spec.session_id). Omit to start a new session.",
          ),
        runtime_env: z
          .record(z.string())
          .optional()
          .describe(
            "Non-secret runtime environment values (name → value) injected into the run. " +
              "Secrets must come from Environments attached to the agent, never through this tool.",
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
    "get_agent_execution",
    {
      description:
        "Get an agent execution's status: phase, messages, pending approvals, errors, timing. " +
        "Agent executions have no event log — poll this tool to track a run started with run_agent " +
        "(terminal phases: completed, failed, cancelled, terminated). The default compact view " +
        "returns the last few messages and omits bulky bookkeeping fields (resolved context, " +
        "approval ledger, sub-agent transcripts); total_messages tells you when the tail is a " +
        "window. Use view=full for the complete record.",
      inputSchema: {
        execution_id: z.string().describe("Agent execution ID (aex_* format)."),
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
        fetchAgentExecution(
          target.serverAddress,
          resolveToken(extra, target.apiKey),
          args.execution_id,
          args.view ?? "compact",
          args.message_limit ?? DEFAULT_MESSAGE_LIMIT,
        ),
      ),
  );

  server.registerTool(
    "submit_agent_execution_approval",
    {
      description:
        "Approve, skip, or reject a tool call an agent execution is waiting on (phase " +
        "waiting-for-approval). Find pending requests in get_agent_execution's " +
        "status.pending_approvals — tool_call_id must match exactly. reject denies the single " +
        "tool call and feeds your comment back to the agent, which then continues; to stop the " +
        "whole run use cancel_execution instead.",
      inputSchema: {
        execution_id: z.string().describe("Agent execution ID (aex_* format)."),
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
        submitAgentApproval(target.serverAddress, resolveToken(extra, target.apiKey), {
          executionId: args.execution_id,
          toolCallId: args.tool_call_id,
          action: args.action,
          comment: args.comment,
        }),
      ),
  );

  return ["run_agent", "get_agent_execution", "submit_agent_execution_approval"];
}
