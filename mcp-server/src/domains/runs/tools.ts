// MCP tools for runs: start a run, poll it, answer the tool uses it waits
// on, and cancel it. Together they close the agent iteration loop: author
// with apply_agent, run with run_agent, observe with get_run, steer with
// submit_run_approval, stop with cancel_run. Runs that already happened are
// found with list_runs, and what they left behind is read with
// get_run_outputs and get_run_scores (history.ts).
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
import {
  DEFAULT_RUN_LIMIT,
  getRunOutputs,
  getRunScores,
  listRuns,
  MAX_RUN_LIMIT,
} from "./history.js";
import { type LocalFileAccess, MAX_RUN_FILES, rootPath } from "./local-files.js";
import { runAgent } from "./run.js";
import { DESTRUCTIVE, READ, WRITE_OPEN_WORLD } from "../toolmarks.js";

/**
 * What run_agent's `files` may read: the target says whether this server
 * shares the person's disk; the client's MCP roots bound the paths
 * (local-files.ts). A client that does not declare roots has none to list.
 */
function fileAccessOf(server: McpServer, target: BackendTarget): LocalFileAccess {
  return {
    localFiles: target.localFiles === true,
    listRoots: async () => {
      if (server.server.getClientCapabilities()?.roots === undefined) return undefined;
      const listed = await server.server.listRoots();
      return listed.roots.map((root) => rootPath(root.uri)).filter((path): path is string => path !== undefined);
    },
  };
}

/** Register the tools that start, observe and steer a run; returns the registered tool names. */
export function registerRunTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "run_agent",
    {
      annotations: WRITE_OPEN_WORLD,
      description:
        "Start a run (asynchronous). Returns immediately with the created run " +
        "(run_* ID) while the run continues in the background — poll get_run to observe " +
        "progress, the tool uses it waits on, and the final answer. Omit session_id to start a fresh " +
        "conversation on the agent; pass one to send a follow-up message into an existing session, " +
        "which runs the agent the session started on. `files` hands the run files from the person's " +
        "project (\"run invoice-checker on samples/march.csv\").",
      inputSchema: z.strictObject({
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
        files: z
          .array(z.string())
          .max(MAX_RUN_FILES)
          .optional()
          .describe(
            `Files from the person's project the message carries, at most ${MAX_RUN_FILES}: each a path, ` +
              "relative to a folder their coding agent has open or absolute inside one. The agent sees " +
              "each with the message and finds it under .stigmer/uploads/. Taken only by the tool " +
              "server running on the person's machine (`stigmer mcp-server`) and only inside the " +
              "folders their coding agent has open; anywhere else the call is refused, and the file " +
              "is attached from a shell with `stigmer run <agent> --attach <path>`. A folder is " +
              "refused the same way. Works on a follow-up too.",
          ),
      }),
    },
    (args, extra) =>
      textOrError(async () =>
        runAgent(
          target.serverAddress,
          await resolveToken(extra, target),
          {
            org: args.org,
            agent: args.agent,
            message: args.message,
            sessionId: args.session_id,
            vaults: args.vaults,
            includeMyVault: args.include_my_vault,
            plugins: args.plugins,
            files: args.files,
          },
          fileAccessOf(server, target),
        ),
      ),
  );

  server.registerTool(
    "list_runs",
    {
      annotations: READ,
      description:
        "List one agent's runs, newest first, across all its conversations: how to find \"the last " +
        "run\" of an agent, or the run a person means (\"last night's\", \"the one that failed\"). " +
        "Each run has its run_id, session_id, phase, start and end, and its error in one line when it " +
        "failed. Read one run with get_run (why it failed, what it said), what it saved with " +
        "get_run_outputs, and how it was graded with get_run_scores.",
      inputSchema: z.strictObject({
        org: z
          .string()
          .default("")
          .describe(
            "Organization slug that owns the agent (e.g. acme). Leave empty on a server that holds one organization.",
          ),
        agent: z.string().describe("Agent slug (e.g. invoice-checker)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_RUN_LIMIT)
          .optional()
          .describe(`How many of the newest runs to return (default ${DEFAULT_RUN_LIMIT}, at most ${MAX_RUN_LIMIT}).`),
      }),
    },
    (args, extra) =>
      textOrError(async () =>
        listRuns(target.serverAddress, await resolveToken(extra, target), {
          org: args.org,
          agent: args.agent,
          limit: args.limit ?? DEFAULT_RUN_LIMIT,
        }),
      ),
  );

  server.registerTool(
    "get_run_outputs",
    {
      annotations: READ,
      description:
        "Read what a run made: the files it saved in its outputs folder (a report, a CSV), newest per " +
        "path. Text files come back with their content, at most 512 KB each, the cut said; other " +
        "files are named with their size and type. Give the person the content itself, not a " +
        "description of where it is. To save the files to a folder, the person runs " +
        "`stigmer download run <run_id> --output-dir <folder>`. No download link is returned: it " +
        "would open the file without a sign-in.",
      inputSchema: z.strictObject({
        run_id: z.string().describe("Run ID (run_*); find one with list_runs."),
        path: z
          .string()
          .optional()
          .describe("Only this output: its path in the outputs folder (reports/march.md) or its filename."),
      }),
    },
    (args, extra) =>
      textOrError(async () =>
        getRunOutputs(target.serverAddress, await resolveToken(extra, target), {
          runId: args.run_id,
          path: args.path,
        }),
      ),
  );

  server.registerTool(
    "get_run_scores",
    {
      annotations: READ,
      description:
        "Read how a run was graded: each score with where it came from (the platform's run-health " +
        "check, a person's thumbs, an AI judge, an eval), whether it was graded, its verdict, its " +
        "criteria and comment. An empty list means nobody and nothing graded the run: say so " +
        "plainly rather than judge it yourself.",
      inputSchema: z.strictObject({
        run_id: z.string().describe("Run ID (run_*); find one with list_runs."),
      }),
    },
    (args, extra) =>
      textOrError(async () => getRunScores(target.serverAddress, await resolveToken(extra, target), args.run_id)),
  );

  server.registerTool(
    "get_run",
    {
      annotations: READ,
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
        "Claude Managed Agents JSON. Find a run you have no id for with list_runs.",
      inputSchema: z.strictObject({
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
      }),
    },
    (args, extra) =>
      textOrError(async () =>
        fetchRun(
          target.serverAddress,
          await resolveToken(extra, target),
          args.run_id,
          args.view ?? "compact",
          args.item_limit ?? DEFAULT_ITEM_LIMIT,
        ),
      ),
  );

  server.registerTool(
    "submit_run_approval",
    {
      annotations: WRITE_OPEN_WORLD,
      description:
        "Answer a tool use a run is waiting on (get_run's turn.phase is waiting). Find the waiting tool uses " +
        "in get_run's turn.asks — tool_use_id must match exactly. The run continues once " +
        "every waiting tool use of its turn is answered. deny refuses the one call and feeds " +
        "your reason back to the agent, which then continues; to stop the conversation use " +
        "cancel_run instead. An approval is the person's to give: send allow or allow_all only " +
        "when the person you are working for said so, in this conversation, for this call.",
      inputSchema: z.strictObject({
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
      }),
    },
    (args, extra) =>
      textOrError(async () =>
        submitRunApproval(target.serverAddress, await resolveToken(extra, target), {
          runId: args.run_id,
          toolUseId: args.tool_use_id,
          decision: args.decision,
          reason: args.reason,
        }),
      ),
  );

  return ["run_agent", "list_runs", "get_run_outputs", "get_run_scores", "get_run", "submit_run_approval"];
}

/** Register the tools that control a running run; returns the registered tool names. */
export function registerRunControlTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "cancel_run",
    {
      annotations: DESTRUCTIVE,
      description:
        "Cancel a run in progress (run_*) by interrupting " +
        "its conversation: every unfinished turn of the conversation stops (queued, working, " +
        "waiting for an answer or paused), not this run alone, and each ends cancelled. " +
        "Cancellation is terminal: a stopped turn cannot be resumed. The response names the " +
        "runs stopped (stopped_run_ids). A run already in a terminal phase is returned with " +
        "already_terminal=true and nothing is stopped.",
      inputSchema: z.strictObject({
        run_id: z.string().describe("Run ID to cancel (run_*)."),
      }),
    },
    (args, extra) =>
      textOrError(async () => cancelRun(target.serverAddress, await resolveToken(extra, target), args.run_id)),
  );

  return ["cancel_run"];
}
