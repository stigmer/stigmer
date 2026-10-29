// MCP tools for runs: start a run, poll it, answer the tool uses it waits
// on, and cancel it. Together they close the agent iteration loop: author
// with apply_agent, run with run_agent, observe with get_run, steer with
// submit_run_approval, stop with cancel_run.
//
// A run is asynchronous by design: run_agent returns as soon as the backend
// accepts the run; progress is observed by polling. MCP tools are
// request/response, so get_run IS the poll loop: each call reads the run's
// events from its session's log, which is why it defaults to the compact
// view (see fetch.ts). Answers and the stop go through the run's session
// (approve.ts, cancel.ts). pause/resume/terminate stay CLI-only until a real
// MCP need shows up.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveToken, type BackendTarget } from "../client.js";
import { textOrError } from "../toolresult.js";
import { APPROVAL_DECISIONS, submitRunApproval } from "./approve.js";
import { cancelRun } from "./cancel.js";
import { DEFAULT_ITEM_LIMIT, fetchRun } from "./fetch.js";
import { runAgent } from "./run.js";

/** Register the tools that start, observe and steer a run; returns the registered tool names. */
export function registerRunTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "run_agent",
    {
      description:
        "Start a run (asynchronous). Returns immediately with the created run " +
        "(run_* ID) while the run continues in the background — poll get_run to observe " +
        "progress, the tool uses it waits on, and the final answer. Omit session_id to start a fresh " +
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
          .describe("Agent slug — the unique identifier within the org (e.g. variance-reporter)."),
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
        vaults: z
          .array(z.string())
          .optional()
          .describe(
            "Shared vaults a new conversation uses, in order, after the caller's My vault: each a " +
              "vault slug in `org`, or `org/slug`. Only when starting a new conversation (no " +
              "session_id); a conversation keeps the vaults it was started with. The server refuses a " +
              "vault that does not exist or that the caller may not use.",
          ),
        plugins: z
          .array(z.string())
          .optional()
          .describe(
            "Installed plugins a new conversation uses beside its agent's, each whole (its skills, " +
              "agents, hooks and MCP servers): each a plugin slug in `org`, or `org/slug`. Only when " +
              "starting a new conversation (no session_id); a conversation keeps the plugins it was " +
              "started with.",
          ),
        include_my_vault: z
          .boolean()
          .optional()
          .describe(
            "Whether each turn of a new conversation uses the caller's own My vault first (default " +
              "true). Pass false to run on the listed vaults only. Only when starting a new " +
              "conversation (no session_id).",
          ),
      },
    },
    (args, extra) =>
      textOrError(async () =>
        runAgent(target.serverAddress, resolveToken(extra, target.apiKey), {
          org: args.org,
          agent: args.agent,
          message: args.message,
          sessionId: args.session_id,
          vaults: args.vaults,
          includeMyVault: args.include_my_vault,
          plugins: args.plugins,
        }),
      ),
  );

  server.registerTool(
    "get_run",
    {
      description:
        "Get a run and what its agent did: the run's lifecycle (phase, timing, error, " +
        "stop_cause) and the run's events from its session's event log. Poll this tool to " +
        "track a run started with run_agent (terminal phases: completed, failed, cancelled, " +
        "terminated). The default compact view summarizes the turn: its phase, its answer, " +
        "asks (the tool uses waiting for your answer, each with the tool_use_id " +
        "submit_run_approval takes), its to-do list, its changed files and the last few items " +
        "(messages, thinking, tool uses with their results); total_items tells you when the " +
        "tail is a window. run.status.credentials.sources names the vault and entry each key " +
        "the run uses came from, never a value. Use view=full for every event of the run as " +
        "Claude Managed Agents JSON.",
      inputSchema: {
        run_id: z.string().describe("Run ID (run_*)."),
        view: z
          .enum(["compact", "full"])
          .optional()
          .describe("Response shape: compact (default, the turn summarized with a bounded item tail) or full (every event)."),
        item_limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(`Compact view only: number of trailing items of the turn to return (default ${DEFAULT_ITEM_LIMIT}).`),
      },
    },
    (args, extra) =>
      textOrError(() =>
        fetchRun(
          target.serverAddress,
          resolveToken(extra, target.apiKey),
          args.run_id,
          args.view ?? "compact",
          args.item_limit ?? DEFAULT_ITEM_LIMIT,
        ),
      ),
  );

  server.registerTool(
    "submit_run_approval",
    {
      description:
        "Answer a tool use a run is waiting on (get_run's turn.phase is waiting). Find the waiting tool uses " +
        "in get_run's turn.asks — tool_use_id must match exactly. The run continues once " +
        "every waiting tool use of its turn is answered. deny refuses the one call and feeds " +
        "your reason back to the agent, which then continues; to stop the conversation use " +
        "cancel_run instead.",
      inputSchema: {
        run_id: z.string().describe("Run ID (run_*)."),
        tool_use_id: z
          .string()
          .describe("The waiting tool use to answer (get_run's turn.asks[].tool_use_id)."),
        decision: z
          .enum(APPROVAL_DECISIONS)
          .describe(
            "allow: run this call. deny: refuse it; the agent is told why (see reason) and adapts. " +
              "allow_all: run this call and every call of its class (its built-in category, MCP " +
              "server or asking hook) for the rest of the turn, including the class's other " +
              "waiting calls.",
          ),
        reason: z
          .string()
          .optional()
          .describe("With deny only: why the call is refused, fed back to the agent."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        submitRunApproval(target.serverAddress, resolveToken(extra, target.apiKey), {
          runId: args.run_id,
          toolUseId: args.tool_use_id,
          decision: args.decision,
          reason: args.reason,
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
        "Cancel a run in progress (run_*) by interrupting " +
        "its conversation: every unfinished turn of the conversation stops (queued, working, " +
        "waiting for an answer or paused), not this run alone, and each ends cancelled. " +
        "Cancellation is terminal: a stopped turn cannot be resumed. The response names the " +
        "runs stopped (stopped_run_ids). A run already in a terminal phase is returned with " +
        "already_terminal=true and nothing is stopped.",
      inputSchema: {
        run_id: z.string().describe("Run ID to cancel (run_*)."),
      },
    },
    (args, extra) =>
      textOrError(() => cancelRun(target.serverAddress, resolveToken(extra, target.apiKey), args.run_id)),
  );

  return ["cancel_run"];
}
