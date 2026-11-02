/**
 * The Temporal workflow for a plugin's tools listing.
 *
 * "stigmer/mcp-server/connect": one step — list one plugin server's tools
 * now, with each tool's `destructiveHint` (true only for an explicit MCP
 * annotation; see shared/mcp-tool-listing.ts) — and the list as its
 * result, which the server hands to the person who asked. Nothing is
 * persisted; nothing here judges a tool.
 *
 * The type name is a pinned wire identifier.
 *
 * Where it may run. The server starts a listing on the shared runner queue
 * or on its own connect sandbox's queue (`mcpconnect:<id>`), never on a
 * session's. Every runner registers this type, though, and whatever can
 * write to Temporal can start it on any queue; the listing starts the
 * plugin's MCP server (a local program, for a stdio entry) wherever it
 * lands. So a listing whose task queue is a session's (`session:<id>`) is
 * refused before its activity is scheduled. The activity refuses a
 * session's queue too (activities/list-plugin-tools.ts), for a workflow that
 * schedules it there directly; between them another person's session
 * sandbox never runs a program a stranger's plugin names. The refusal adds
 * no command ahead of the activity, so a history recorded before it
 * replays unchanged. A listing forged onto a live connect sandbox's queue
 * is indistinguishable from the real one here; only a job-store identity
 * per sandbox closes that.
 *
 * SANDBOX RULES: This file runs inside the Temporal deterministic V8
 * isolate. No Node.js built-ins (crypto, fs, net), no non-deterministic
 * operations, no side-effecting imports. Only @temporalio/workflow APIs,
 * type-only imports, the import-free constants of shared/task-queues.ts,
 * and pure JS/TS logic.
 */

import { ApplicationFailure, proxyActivities, workflowInfo } from "@temporalio/workflow";

import { LISTING_ON_SESSION_QUEUE_FAILURE_TYPE, SESSION_QUEUE_PREFIX } from "../shared/task-queues.js";

import type {
  createListPluginToolsActivities,
  ListPluginToolsOutput,
} from "../activities/list-plugin-tools.js";

import type { ListPluginToolsWorkflowInput, ListPluginToolsWorkflowOutput } from "./types.js";

type ListActivities = ReturnType<typeof createListPluginToolsActivities>;

// The bounds ladder (issue #239): the activity heartbeats every 15s, so
// heartbeatTimeout is pure LIVENESS (dead worker detection) — it never
// kills a slow-but-alive listing. The activity bounds its own WORK with a
// transport-aware init timeout (30s HTTP / 270s stdio) that fails with an
// actionable, endpoint-naming error; startToCloseTimeout is the hard cap
// above both.
const list = proxyActivities<ListActivities>({
  startToCloseTimeout: "600s",
  heartbeatTimeout: "60s",
  retry: { maximumAttempts: 1 },
});

function runListing(input: ListPluginToolsWorkflowInput): Promise<ListPluginToolsOutput> {
  return list.DiscoverMcpServerCapabilities({
    pluginId: input.plugin_id,
    server: input.server,
    executionContextId: input.execution_context_id ?? null,
    executionContextToken: input.execution_context_token ?? null,
  });
}

function toWire(listing: ListPluginToolsOutput): ListPluginToolsWorkflowOutput {
  return {
    tools: listing.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      destructiveHint: tool.destructiveHint,
    })),
  };
}

export async function listPluginTools(input: ListPluginToolsWorkflowInput): Promise<ListPluginToolsWorkflowOutput> {
  const { taskQueue } = workflowInfo();
  if (taskQueue.startsWith(SESSION_QUEUE_PREFIX)) {
    throw ApplicationFailure.nonRetryable(
      `A tools listing does not run on a session's task queue (${taskQueue}); the server starts it on the shared runner queue or its own connect sandbox`,
      LISTING_ON_SESSION_QUEUE_FAILURE_TYPE,
    );
  }
  return toWire(await runListing(input));
}
