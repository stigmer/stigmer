/**
 * McpServer connect-engine seam — the domain's view of the Temporal client
 * operations the connect lanes need (Go holds these as optional fields on
 * McpServerController, set by SetConnectDependencies; here availability is
 * the modeled engine state, the same idiom as agentexecution's engine.ts
 * and workflowexecution's engine.ts — guidelines §4).
 *
 * The engine does NOT run a worker: the connect workflow
 * (stigmer/mcp-server/connect) is the RUNNER's — this server only starts,
 * attaches to, and awaits runs of it. The temporal-side implementation
 * lands in src/temporal/mcpserver/engine-client.ts; tests fake this
 * interface directly.
 *
 * Failure classification (ConnectRunFailure) mirrors the error taxonomy
 * Go's awaitConnectWorkflow switches on (connect.go:661-694). The engine
 * classifies; the DOMAIN owns the gRPC codes and user-facing copy the
 * classes map to — the split keeps Temporal error types out of handler
 * code.
 */

/**
 * The connect workflow's input — matches the runner's
 * ConnectMcpServerWorkflowInput (Go connectWorkflowInput). Snake_case keys
 * are the Temporal JSON payload wire contract; ids-only except
 * execution_context_token, the ONE deliberate exception (oss#535): the EC
 * read RPC redacts secrets unless the caller presents an execution-scoped
 * runner token, and the discovery activity has no execution of its own to
 * exchange for one — the capability travels with the work item. It is a
 * decrypt-lane discriminator, not a secret value: short-TTL, bound to
 * this connect flow's ephemeral EC (deleted when the handler returns),
 * and useless once either expires.
 */
export interface ConnectWorkflowInput {
  readonly mcp_server_id: string;
  readonly execution_context_id?: string;
  readonly execution_context_token?: string;
}

/**
 * The connect workflow's result — mirrors the runner's
 * ConnectMcpServerWorkflowOutput (Go connectWorkflowOutput). Every field
 * the runner emits must have a home here: a missing field is silently
 * dropped during JSON deserialization, which is exactly how
 * tool_approvals used to be lost.
 */
export interface ConnectWorkflowOutput {
  readonly tools?: DiscoveredToolResult[];
  readonly resource_templates?: DiscoveredResourceTemplateResult[];
  /**
   * Per-tool approval policies produced by the connect-time classifier —
   * layer 1 of the approval policy chain. The classifier returns only the
   * gated tools, but each entry still carries requires_approval so a
   * future runner that emits non-gated entries is handled defensively at
   * conversion time.
   */
  readonly tool_approvals?: ToolApprovalResult[];
}

export interface DiscoveredToolResult {
  readonly name?: string;
  readonly description?: string;
  readonly input_schema?: Record<string, unknown>;
}

export interface DiscoveredResourceTemplateResult {
  readonly uri_template?: string;
  readonly name?: string;
  readonly description?: string;
  readonly mime_type?: string;
}

export interface ToolApprovalResult {
  readonly tool_name?: string;
  readonly requires_approval?: boolean;
  readonly message?: string;
  /**
   * True when the connect-time tightener force-gated this tool from its
   * destructiveHint annotation (not the classifier) — persisted to
   * ToolApprovalPolicy.from_destructive_hint so the runner attributes the
   * gate to the annotation rather than the classifier default.
   */
  readonly from_destructive_hint?: boolean;
}

/**
 * How a connect run failed, in Go awaitConnectWorkflow's taxonomy:
 * - "application": the workflow itself failed with the runner's crafted,
 *   user-facing message (Go temporal.ApplicationError).
 * - "timeout": the WorkflowRunTimeout elapsed (Go temporal.TimeoutError).
 * - "service-not-found": Temporal no longer knows the run (Go
 *   serviceerror.NotFound).
 * - "other": everything else; message carries the error's own text (Go's
 *   default arm, err.Error()).
 */
export type ConnectRunFailure =
  | { readonly kind: "application"; readonly message: string }
  | { readonly kind: "timeout" }
  | { readonly kind: "service-not-found" }
  | { readonly kind: "other"; readonly message: string };

export type ConnectRunOutcome =
  | { readonly ok: true; readonly output: ConnectWorkflowOutput }
  | { readonly ok: false; readonly failure: ConnectRunFailure };

/** A started-or-attached connect run (Go client.WorkflowRun). */
export interface ConnectRun {
  readonly workflowId: string;
  /**
   * True when the deterministic workflow ID reported an in-flight run and
   * this handle attached to it instead of starting a new one — the lanes
   * skip the CONNECTING write in that case so the starting lane's
   * started_at survives.
   */
  readonly attached: boolean;
  /**
   * Blocks until the run settles and classifies the outcome. The
   * workflow's own WorkflowRunTimeout is the deadline that should fire
   * first; raceTimeoutMs (budget + a small buffer on the background
   * lanes) is only a backstop so a settle task can never hang if Temporal
   * becomes unreachable — Go's bounded background contexts.
   */
  result(raceTimeoutMs?: number): Promise<ConnectRunOutcome>;
}

/** The Temporal client operations the connect lanes consume. */
export interface McpServerConnectEngine {
  /**
   * Starts the connect workflow on the runner queue, or attaches to the
   * in-flight run when the deterministic workflow ID reports one already
   * running (Go startOrAttachConnectWorkflow). Throws on any other start
   * failure — the lanes map that to Internal "failed to start connect
   * workflow".
   */
  startOrAttachConnect(
    mcpServerId: string,
    input: ConnectWorkflowInput,
    runTimeoutMs: number,
  ): Promise<ConnectRun>;

  /**
   * Whether the recorded connect workflow is still running (Go
   * isConnectRunRunning). Errors — including a run Temporal no longer
   * knows — report false: the caller falls through to a fresh start,
   * where the AlreadyStarted refusal is the authoritative answer.
   */
  isConnectRunRunning(workflowId: string): Promise<boolean>;

  /**
   * Whether any worker is polling the runner task queue (Go
   * runnerQueueWarning's DescribeTaskQueue probe). `undefined` when the
   * question cannot be answered — an unreachable Temporal should not cry
   * wolf on an operation that is about to fail loudly anyway.
   */
  hasRunnerQueuePollers(): Promise<boolean | undefined>;
}

/** Engine availability as an explicit modeled state (guidelines §4). */
export type McpServerEngineState =
  | { readonly connected: true; readonly engine: McpServerConnectEngine }
  | { readonly connected: false };

/**
 * The disconnected state: no Temporal behind this server (never
 * connected since boot). Connect/startConnect refuse with Go's
 * byte-pinned FailedPrecondition; the OAuth RPCs work fully — the
 * ratified DB-1 split (sub-project 20260825.02).
 */
export const MCP_SERVER_ENGINE_DISCONNECTED: McpServerEngineState =
  Object.freeze({ connected: false });

/**
 * A provider rather than a value: consumers observe the CURRENT state at
 * request time, never a boot-time snapshot — reconnects propagate
 * automatically (the #18 engine-state idiom).
 */
export type McpServerEngineStateProvider = () => McpServerEngineState;
