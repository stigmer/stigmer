/**
 * The tools listing's engine seam — the domain's view of the Temporal client
 * operations the listing needs; availability is the modeled engine state,
 * the same idiom as agentexecution's engine.ts.
 *
 * The engine does NOT run a worker: the connect workflow
 * (stigmer/mcp-server/connect, a pinned wire name) is the RUNNER's — this
 * server only starts runs of it and awaits them. The temporal-side
 * implementation lives in src/temporal/plugintools/engine-client.ts; tests
 * fake this interface directly.
 *
 * Failure classification (ToolsRunFailure) is the engine's; the DOMAIN owns
 * the gRPC codes and user-facing copy the classes map to, so Temporal error
 * types stay out of handler code.
 */

/**
 * The connect workflow's input. Snake_case keys are the Temporal JSON
 * payload wire contract (the two execution_context_* names are pinned
 * bytes from before values were fetched from vaults: execution_context_id
 * carries the listing's attempt id). Ids-only except
 * execution_context_token, the ONE deliberate exception: the values fetch
 * answers only a runner credential bound to the execution, and the
 * listing activity has no execution of its own to exchange for one, so the
 * capability travels with the work item. It is a short-TTL token bound to
 * this listing's attempt, ended when the listing settles. What it unlocks
 * depends on the posture: under trusted-local it fetches that listing's
 * values and nothing more; under the built-in authorization posture the
 * same token also admits its bearer AS THE PERSON who asked, on every
 * RPC, for as long as the attempt row exists (runnerauth/runnerauth.ts;
 * runnerauth/bound-execution.ts, the `mcp-connect` binding). It sits in
 * Temporal history in the clear like every server-written input; no vault
 * value does.
 */
export interface ToolsWorkflowInput {
  readonly plugin_id: string;
  /** The server's name in the plugin (an McpServerEntry name). */
  readonly server: string;
  readonly execution_context_id?: string;
  readonly execution_context_token?: string;
}

/**
 * The connect workflow's result. Every field the runner emits must have a
 * home here: a missing field is silently dropped during JSON
 * deserialization.
 */
export interface ToolsWorkflowOutput {
  readonly tools?: ListedToolResult[];
}

export interface ListedToolResult {
  readonly name?: string;
  readonly description?: string;
  /**
   * True only when the tool's MCP annotations carry an explicit
   * `destructiveHint: true`, whatever `readOnlyHint` says. The key is
   * camelCase on the wire because the runner's workflow output names it so.
   */
  readonly destructiveHint?: boolean;
}

/**
 * How a listing run failed:
 * - "application": the workflow failed with the runner's crafted,
 *   user-facing message;
 * - "timeout": the WorkflowRunTimeout elapsed;
 * - "service-not-found": Temporal no longer knows the run;
 * - "other": everything else; message carries the error's own text.
 */
export type ToolsRunFailure =
  | { readonly kind: "application"; readonly message: string }
  | { readonly kind: "timeout" }
  | { readonly kind: "service-not-found" }
  | { readonly kind: "other"; readonly message: string };

export type ToolsRunOutcome =
  | { readonly ok: true; readonly output: ToolsWorkflowOutput }
  | { readonly ok: false; readonly failure: ToolsRunFailure };

/**
 * Where a listing run is served — decided by the domain, resolved to a
 * queue name by the engine:
 * - "runner": the server's shared runner queue, polled by an external
 *   runner (the posture with no sandbox provisioner composed);
 * - "sandbox": the queue one connect sandbox serves, provisioned for this
 *   listing alone (sandbox.ts). With a provisioner composed the shared
 *   queue has no poller at all (boot/compose.ts requires a per-queue
 *   routing mode beside one, stigmer/stigmer#1474).
 */
export type ToolsTaskQueue =
  | { readonly kind: "runner" }
  | { readonly kind: "sandbox"; readonly name: string };

/** A started listing run. */
export interface ToolsRun {
  readonly workflowId: string;
  /**
   * Blocks until the run settles and classifies the outcome. The
   * workflow's own WorkflowRunTimeout is the deadline that should fire
   * first; raceTimeoutMs is only a backstop so the handler can never hang
   * if Temporal becomes unreachable.
   */
  result(raceTimeoutMs?: number): Promise<ToolsRunOutcome>;
}

/** The Temporal client operations the listing consumes. */
export interface PluginToolsEngine {
  /**
   * Starts the connect workflow on `taskQueue` under a workflow id of its
   * own (`attemptId` names it), so one person's listing is never served by
   * another's run. Throws on any start failure — the lane maps that to
   * Internal "failed to start the tools listing".
   */
  startListing(
    attemptId: string,
    input: ToolsWorkflowInput,
    runTimeoutMs: number,
    taskQueue: ToolsTaskQueue,
  ): Promise<ToolsRun>;
}

/** Engine availability as an explicit modeled state (guidelines §4). */
export type PluginToolsEngineState =
  | { readonly connected: true; readonly engine: PluginToolsEngine }
  | { readonly connected: false };

/** The disconnected state: no Temporal behind this server (never connected since boot). */
export const PLUGIN_TOOLS_ENGINE_DISCONNECTED: PluginToolsEngineState =
  Object.freeze({ connected: false });

/**
 * A provider rather than a value: consumers observe the CURRENT state at
 * request time, never a boot-time snapshot — reconnects propagate
 * automatically (the agent-execution engine-state idiom).
 */
export type PluginToolsEngineStateProvider = () => PluginToolsEngineState;
