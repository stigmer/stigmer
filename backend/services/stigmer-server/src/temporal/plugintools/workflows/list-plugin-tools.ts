/**
 * The plugin tools listing's workflow, "stigmer/mcp-server/connect": one
 * activity, `DiscoverMcpServerCapabilities`, scheduled on the queue the
 * listing is served on (the shared runner queue, or its own connect
 * sandbox's), and the tools it lists as the result.
 *
 * It runs on the SERVER's worker (the agent-execution worker's queue), so a
 * runner polls activities only and never takes a workflow task. Before
 * 2026-11, every runner registered this type and the server started it on
 * the runner's queue; a runner that serves workflow tasks keeps state per
 * workflow on a sticky queue of its own, which a runner reaching Temporal
 * only through the Stigmer server cannot be given.
 *
 * Wire facts, pinned: the type name (names.ts `CONNECT_WORKFLOW_NAME`), the
 * input and output (domain/plugin/tools/engine.ts `ToolsWorkflowInput`,
 * `ToolsWorkflowOutput`), and the activity's name and input, which the
 * runner's activity reads (runner src/activities/list-plugin-tools.ts).
 * The queue rides as a second argument, so the input stays the runner's.
 *
 * A listing is never served on a session's queue: another person's session
 * sandbox must not start a program a stranger's plugin names. The server
 * never places one there (domain/plugin/tools/sandbox.ts); the workflow
 * refuses it before the activity is scheduled, and the runner's activity
 * refuses it again.
 *
 * Runs inside Temporal's workflow sandbox: `@temporalio/workflow` and
 * type-only imports alone.
 */
import { ApplicationFailure, proxyActivities } from "@temporalio/workflow";

import type {
  ListedToolResult,
  ToolsWorkflowInput,
  ToolsWorkflowOutput,
} from "../../../domain/plugin/tools/engine.js";

/** Where the listing's activity runs: the second workflow argument. */
export interface ListingPlacement {
  readonly activity_task_queue: string;
}

/** A session sandbox's queue prefix (sandbox/naming.ts `SANDBOX_QUEUE_PREFIXES`; a test pins the two). */
export const SESSION_QUEUE_PREFIX = "session:";

/** The failure type of a listing placed on a session's queue; the runner's activity uses the same. */
export const LISTING_ON_SESSION_QUEUE_FAILURE_TYPE = "ListingOnSessionQueue";

/** What the runner's activity takes: camelCase, as its signature names it. */
interface DiscoverInput {
  readonly pluginId: string;
  readonly server: string;
  readonly executionContextId: string | null;
  readonly executionContextToken: string | null;
}

interface DiscoverOutput {
  readonly tools: readonly ListedToolResult[];
}

type DiscoverActivities = {
  DiscoverMcpServerCapabilities(input: DiscoverInput): Promise<DiscoverOutput>;
};

export async function listPluginTools(
  input: ToolsWorkflowInput,
  placement: ListingPlacement | undefined,
): Promise<ToolsWorkflowOutput> {
  const queue = placement?.activity_task_queue ?? "";
  if (queue === "") {
    throw ApplicationFailure.nonRetryable(
      "A tools listing was started without the queue its activity runs on",
      "ListingWithoutQueue",
    );
  }
  if (queue.startsWith(SESSION_QUEUE_PREFIX)) {
    throw ApplicationFailure.nonRetryable(
      `A tools listing does not run on a session's task queue (${queue}); the server starts it on the shared runner queue or its own connect sandbox`,
      LISTING_ON_SESSION_QUEUE_FAILURE_TYPE,
    );
  }
  // The bounds ladder (stigmer#239): the activity heartbeats every 15s, so
  // the heartbeat timeout is liveness alone; the activity bounds its own
  // work (30s HTTP, 270s stdio) and start-to-close is the hard cap above.
  const { DiscoverMcpServerCapabilities } = proxyActivities<DiscoverActivities>({
    taskQueue: queue,
    startToCloseTimeout: "600s",
    heartbeatTimeout: "60s",
    retry: { maximumAttempts: 1 },
  });
  const listing = await DiscoverMcpServerCapabilities({
    pluginId: input.plugin_id,
    server: input.server,
    executionContextId: input.execution_context_id ?? null,
    executionContextToken: input.execution_context_token ?? null,
  });
  return {
    tools: listing.tools.map((tool) => ({
      name: tool.name ?? "",
      description: tool.description ?? "",
      destructiveHint: tool.destructiveHint === true,
    })),
  };
}
