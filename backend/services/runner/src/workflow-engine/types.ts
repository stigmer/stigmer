/**
 * Core type definitions for the workflow execution engine.
 *
 * These types represent the serializable, plain-object form of a
 * CNCF Serverless Workflow DSL 1.0.0 document. The loader converts
 * CNCF SDK class instances into these types; the engine operates
 * exclusively on them. No SDK class instances cross the serialization
 * boundary into the Temporal workflow sandbox.
 *
 * The type system follows the CNCF spec structure but uses a
 * discriminated union (`kind` field) for task types to enable
 * exhaustive type checking in TypeScript.
 */

import type { TaskStatusAccumulator } from "./task-status-accumulator.js";

// ─────────────────────────────────────────────────────────────────────
// Workflow Model (top-level)
// ─────────────────────────────────────────────────────────────────────

export interface WorkflowModel {
  readonly document: WorkflowDocument;
  readonly do: TaskList;
  readonly input?: InputDef;
  readonly output?: OutputDef;
}

export interface WorkflowDocument {
  readonly dsl: string;
  readonly name: string;
  readonly namespace?: string;
  readonly version?: string;
  readonly description?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Task List & Entries
// ─────────────────────────────────────────────────────────────────────

/**
 * Ordered list of named tasks. Each entry maps a single task name
 * to its definition — mirrors the CNCF `do:` array where each
 * element is a `{ taskName: TaskDef }` object.
 */
export type TaskList = TaskEntry[];

export interface TaskEntry {
  readonly key: string;
  readonly task: TaskDef;
}

// ─────────────────────────────────────────────────────────────────────
// Task Base (shared by all task types)
// ─────────────────────────────────────────────────────────────────────

export interface TaskBase {
  readonly if?: string;
  readonly input?: InputDef;
  readonly output?: OutputDef;
  readonly export?: ExportDef;
  readonly then?: FlowDirective;
  readonly metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────
// Task Definitions (discriminated union)
// ─────────────────────────────────────────────────────────────────────

export type TaskDef =
  | SetTaskDef
  | SwitchTaskDef
  | DoTaskDef
  | ForTaskDef
  | ForkTaskDef
  | TryTaskDef
  | WaitTaskDef
  | ListenTaskDef
  | HumanInputTaskDef
  | RaiseTaskDef
  | CallHttpTaskDef
  | CallGrpcTaskDef
  | CallAgentTaskDef
  | CallFunctionTaskDef
  | RunTaskDef;

export interface SetTaskDef extends TaskBase {
  readonly kind: "set";
  readonly set: Record<string, unknown>;
}

export interface SwitchTaskDef extends TaskBase {
  readonly kind: "switch";
  readonly switch: SwitchCase[];
}

export interface DoTaskDef extends TaskBase {
  readonly kind: "do";
  readonly do: TaskList;
}

export interface ForTaskDef extends TaskBase {
  readonly kind: "for";
  readonly for: ForConfig;
  readonly while?: string;
  readonly do: TaskList;
}

export interface ForkTaskDef extends TaskBase {
  readonly kind: "fork";
  readonly fork: ForkConfig;
}

export interface TryTaskDef extends TaskBase {
  readonly kind: "try";
  readonly try: TaskList;
  readonly catch: CatchConfig;
}

export interface WaitTaskDef extends TaskBase {
  readonly kind: "wait";
  readonly wait: DurationDef;
}

export interface ListenTaskDef extends TaskBase {
  readonly kind: "listen";
  readonly listen: ListenConfig;
}

export interface HumanInputTaskDef extends TaskBase {
  readonly kind: "human_input";
  readonly humanInput: HumanInputConfig;
}

export interface RaiseTaskDef extends TaskBase {
  readonly kind: "raise";
  readonly raise: RaiseConfig;
}

export interface CallHttpTaskDef extends TaskBase {
  readonly kind: "call:http";
  readonly call: "http";
  readonly with: HttpCallConfig;
}

export interface CallGrpcTaskDef extends TaskBase {
  readonly kind: "call:grpc";
  readonly call: "grpc";
  readonly with: GrpcCallConfig;
}

/**
 * Agent call — invokes a Stigmer agent as a workflow task. Uses
 * Temporal async completion: the activity creates an AgentExecution
 * with a callback token, then the platform completes the activity
 * when the agent finishes. Separate from generic call:function
 * because it requires workflow-side signal handling for HITL.
 */
export interface CallAgentTaskDef extends TaskBase {
  readonly kind: "call:agent";
  readonly call: "agent";
  readonly with: AgentCallConfig;
}

/**
 * Custom call function — covers Stigmer extensions:
 * call: llm | transform | validate | human_input |
 *       emit_event | notification | eval | activity
 */
export interface CallFunctionTaskDef extends TaskBase {
  readonly kind: "call:function";
  readonly call: string;
  readonly with?: Record<string, unknown>;
}

export interface RunTaskDef extends TaskBase {
  readonly kind: "run";
  readonly run: RunConfig;
}

// ─────────────────────────────────────────────────────────────────────
// Switch
// ─────────────────────────────────────────────────────────────────────

export interface SwitchCase {
  readonly name: string;
  readonly when?: string;
  readonly then: FlowDirective;
}

// ─────────────────────────────────────────────────────────────────────
// Flow Directives
// ─────────────────────────────────────────────────────────────────────

/**
 * Flow control directive on a task's `then` field.
 * - "continue" — proceed to next task (default)
 * - "end" or "exit" — terminate the workflow
 * - any other string — jump to the named task
 */
export type FlowDirective = string;

export const FLOW_CONTINUE = "continue";
export const FLOW_END = "end";
export const FLOW_EXIT = "exit";

export function isTermination(directive: FlowDirective): boolean {
  return directive === FLOW_END || directive === FLOW_EXIT;
}

export function isExplicitTarget(directive: FlowDirective): boolean {
  return (
    directive !== FLOW_CONTINUE &&
    directive !== FLOW_END &&
    directive !== FLOW_EXIT
  );
}

// ─────────────────────────────────────────────────────────────────────
// Input / Output / Export
// ─────────────────────────────────────────────────────────────────────

export interface InputDef {
  readonly from?: string | Record<string, unknown>;
  readonly schema?: Record<string, unknown>;
}

export interface OutputDef {
  readonly as?: string | Record<string, unknown>;
  readonly schema?: Record<string, unknown>;
}

export interface ExportDef {
  readonly as?: string | Record<string, unknown>;
  readonly schema?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────
// For / Fork / Try-Catch
// ─────────────────────────────────────────────────────────────────────

export interface ForConfig {
  readonly each?: string;
  readonly in: string;
  readonly at?: string;
}

export interface ForkConfig {
  readonly branches: TaskList;
  readonly compete?: boolean;
}

export interface CatchConfig {
  readonly errors?: CatchErrors;
  readonly as?: string;
  readonly when?: string;
  readonly do?: TaskList;
  readonly retry?: RetryConfig;
}

export interface CatchErrors {
  readonly with?: Record<string, unknown>;
}

export interface RetryConfig {
  readonly when?: string;
  readonly exceptWhen?: string;
  readonly limit?: RetryLimit;
  readonly backoff?: BackoffConfig;
  readonly jitter?: JitterConfig;
  readonly delay?: DurationDef;
}

export interface RetryLimit {
  readonly attempt?: { readonly count: number };
  readonly duration?: DurationDef;
}

export interface BackoffConfig {
  readonly exponential?: Record<string, unknown>;
  readonly linear?: Record<string, unknown>;
  readonly constant?: Record<string, unknown>;
}

export interface JitterConfig {
  readonly from?: DurationDef;
  readonly to?: DurationDef;
}

// ─────────────────────────────────────────────────────────────────────
// Wait / Listen / Raise / Run
// ─────────────────────────────────────────────────────────────────────

export interface DurationDef {
  readonly days?: number;
  readonly hours?: number;
  readonly minutes?: number;
  readonly seconds?: number;
  readonly milliseconds?: number;
}

export interface ListenConfig {
  readonly to: EventConsumptionConfig;
}

export interface EventConsumptionConfig {
  readonly any?: EventFilter[];
  readonly all?: EventFilter[];
  readonly one?: EventFilter;
}

export interface EventFilter {
  readonly with?: Record<string, unknown>;
}

export interface RaiseConfig {
  readonly error: ErrorDef;
}

export interface ErrorDef {
  readonly type: string;
  readonly status: number;
  readonly title?: string;
  readonly detail?: string;
  readonly instance?: string;
}

// ─────────────────────────────────────────────────────────────────────
// HTTP / gRPC Call Configs
// ─────────────────────────────────────────────────────────────────────

export interface HttpCallConfig {
  readonly method: string;
  readonly endpoint: EndpointDef;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly query?: Record<string, string>;
  readonly output?: string;
  readonly redirect?: string;
}

export type EndpointDef = string | { readonly uri: string; readonly authentication?: Record<string, unknown> };

export interface GrpcCallConfig {
  readonly proto: string;
  readonly service: { readonly name: string; readonly host: string; readonly port?: number };
  readonly method: string;
  readonly arguments?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────
// Run Config
// ─────────────────────────────────────────────────────────────────────

export interface RunConfig {
  readonly shell?: ShellRunConfig;
  readonly script?: ScriptRunConfig;
  readonly workflow?: WorkflowRunConfig;
}

export interface ShellRunConfig {
  readonly command: string;
  readonly arguments?: Record<string, string>;
  readonly environment?: Record<string, string>;
}

export interface ScriptRunConfig {
  readonly language: string;
  readonly code?: string;
  readonly source?: { readonly endpoint: EndpointDef };
  readonly arguments?: Record<string, unknown>;
  readonly environment?: Record<string, string>;
}

export interface WorkflowRunConfig {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly input?: unknown;
}

// ─────────────────────────────────────────────────────────────────────
// Task Builder Contract
// ─────────────────────────────────────────────────────────────────────

/**
 * The function a task builder produces. Called by the DoTask executor
 * to run a single task. Receives the current input and state, returns
 * the task's output (which may be undefined for control-flow tasks).
 *
 * For tasks that need expression evaluation (set, switch, if-guards),
 * the executor provides an `evaluateExpressions` callback that batches
 * jq evaluation into a local activity call.
 */
export type TaskExecutorFn = (
  input: unknown,
  state: WorkflowState,
  ctx: TaskExecutionContext,
) => unknown | Promise<unknown>;

/**
 * Runtime context passed to task executors. Provides access to
 * expression evaluation, the workflow document, and external call
 * capabilities without coupling task implementations to Temporal APIs.
 *
 * Call callbacks (`callHttp`, `callGrpc`, `callFunction`) are wired
 * to Temporal `proxyActivities` in the workflow function. The kernel
 * invokes them as opaque callbacks — it never imports Temporal APIs.
 */
export interface TaskExecutionContext {
  readonly evaluateExpressions: ExpressionEvaluator;
  readonly doc: WorkflowModel;
  readonly sleep: SleepFn;
  readonly listen: ListenFn;
  readonly runCommand: RunCommandFn;
  readonly runWorkflow: RunWorkflowFn;
  readonly awaitHumanInput: AwaitHumanInputFn;
  readonly callHttp: CallHttpFn;
  readonly callGrpc: CallGrpcFn;
  readonly callFunction: CallFunctionFn;
  readonly callAgent: CallAgentFn;

  /**
   * Extract structured data from free-text agent output using an
   * extraction LLM. Optional — only available when the runner has
   * proxy access. Returns null if extraction fails.
   */
  readonly extractStructuredOutput?: (
    text: string,
    schema: Record<string, unknown>,
  ) => Promise<unknown | null>;

  /**
   * Emit workflow execution events to the server. Events are sent as
   * a batch via a local activity call to `updateWorkflowExecutionStatus`.
   * Best-effort — failures are logged but do not block the workflow.
   *
   * Accepts plain event descriptors (no proto imports needed in the
   * sandbox). The activity converts them to `WorkflowExecutionEvent`
   * proto objects before sending.
   */
  readonly emitEvents?: EmitEventsFn;

  /**
   * Optional pause yield point. When provided, the engine calls this
   * between tasks, between for-each iterations, and between try
   * retries. If the workflow is paused (via Temporal signal), this
   * callback blocks until resumed. If not paused, returns immediately.
   *
   * The engine has no knowledge of Temporal signals — it simply awaits
   * this opaque callback at well-defined yield points.
   */
  readonly checkPause?: () => Promise<void>;

  /**
   * Accumulates per-task status entries throughout the workflow run.
   * Passed to the emit activity on every event batch so the server
   * receives a complete snapshot of task statuses with each update.
   */
  readonly taskStatusAccumulator?: TaskStatusAccumulator;
}

/**
 * Pauses workflow execution for the specified duration in milliseconds.
 * Wired to Temporal's `sleep()` in the workflow function. Returns
 * undefined when the timer completes or the workflow is cancelled.
 */
export type SleepFn = (durationMs: number) => Promise<void>;

/**
 * Waits for external events (signals) to arrive at the workflow.
 * Wired to the listen-orchestrator which registers Temporal signal
 * channels and blocks until the consumption strategy is satisfied
 * (one/all/any). Returns the received signal payload(s).
 */
export type ListenFn = (config: ListenExecutionConfig) => Promise<unknown>;

/**
 * Normalized listen configuration passed to the workflow-layer
 * orchestrator. The kernel validates and normalizes the raw
 * ListenConfig before invoking this callback.
 */
export interface ListenExecutionConfig {
  readonly events: ListenEventDef[];
  readonly mode: "all" | "any";
  readonly timeoutMs: number;
}

export interface ListenEventDef {
  readonly id: string;
  readonly type: string;
  readonly acceptIf?: string;
  /** Reply template for query/update handlers — evaluated against state */
  readonly data?: unknown;
}

/**
 * Executes a script or shell command via a Temporal activity.
 * The activity writes inline code to a temp file and executes it,
 * or runs a shell command directly. Returns stdout as a string.
 */
export type RunCommandFn = (config: RunCommandConfig) => Promise<unknown>;

export interface RunCommandConfig {
  readonly mode: "script" | "shell";
  readonly language?: string;
  readonly code?: string;
  readonly command?: string;
  readonly arguments?: unknown;
  readonly environment?: Record<string, string>;
  readonly runtimeEnv: Record<string, unknown>;
}

/**
 * Executes a child Temporal workflow. When `await` is true, blocks
 * until the child completes and returns its result. When false,
 * fires and forgets (returns undefined immediately).
 */
export type RunWorkflowFn = (config: RunWorkflowExecutionConfig) => Promise<unknown>;

export interface RunWorkflowExecutionConfig {
  readonly name: string;
  readonly input?: unknown;
  readonly await: boolean;
}

/**
 * Blocks workflow execution until a human provides input via signal.
 * Supports configurable timeout with policies (fail, approve, deny).
 */
export type AwaitHumanInputFn = (config: HumanInputExecutionConfig) => Promise<HumanInputResult>;

export interface HumanInputExecutionConfig {
  readonly signalName: string;
  readonly timeoutSeconds: number;
  readonly onTimeout: "fail" | "approve" | "deny";
}

export interface HumanInputResult {
  readonly outcome: string;
  readonly reviewer?: string;
  readonly responded_at?: string;
  readonly form_data?: Record<string, unknown>;
  readonly auto_resolved?: boolean;
  readonly reason?: string;
}

export interface HumanInputConfig {
  readonly prompt: string;
  readonly outcomes?: HumanInputOutcome[];
  readonly formSchema?: Record<string, unknown>;
  readonly approvers?: readonly string[];
  readonly timeout?: number;
  readonly onTimeout?: "fail" | "approve" | "deny";
}

export interface HumanInputOutcome {
  readonly name: string;
  readonly label?: string;
  readonly then?: string;
}

/**
 * Executes an HTTP call as a Temporal activity. Receives the
 * expression-evaluated config and the runtime environment for
 * just-in-time secret resolution in the activity.
 */
export type CallHttpFn = (
  config: HttpCallConfig,
  runtimeEnv: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Executes a gRPC call as a Temporal activity. Receives the
 * expression-evaluated config and the runtime environment.
 */
export type CallGrpcFn = (
  config: GrpcCallConfig,
  runtimeEnv: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Executes a custom function call (llm, agent, etc.) as a Temporal
 * activity. The `call` string identifies the function type; the
 * activity dispatches internally based on this value.
 */
export type CallFunctionFn = (
  call: string,
  config: Record<string, unknown>,
  runtimeEnv: Record<string, unknown>,
  metadata: CallFunctionMetadata,
) => Promise<unknown>;

export interface CallFunctionMetadata {
  readonly workflowExecutionId?: string;
  readonly parentWorkflowId?: string;
}

/**
 * Batch expression evaluator. Takes a map of expression keys to
 * jq expression strings, evaluates them against the provided input
 * and state variables, and returns a matching map of results.
 *
 * This runs as a local activity (outside the workflow sandbox)
 * using jq-wasm. The results are recorded in workflow history
 * for deterministic replay.
 */
export type ExpressionEvaluator = (
  expressions: Record<string, string>,
  input: unknown,
  stateVars: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/**
 * Contract for task builders. Each task type implements this to
 * produce a TaskExecutorFn from its definition.
 */
export interface TaskBuilder {
  readonly taskName: string;
  readonly taskDef: TaskDef;
  build(): TaskExecutorFn;
  shouldRun(state: WorkflowState): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────
// Agent Call Types
// ─────────────────────────────────────────────────────────────────────

/**
 * Invokes a Stigmer agent as an async-completion Temporal activity.
 * The activity creates a Session + AgentExecution with a callback
 * token. The platform completes the activity when the agent finishes.
 * While pending, the workflow listens for HITL approval signals.
 */
export type CallAgentFn = (
  config: AgentCallConfig,
  runtimeEnv: Record<string, unknown>,
  metadata: CallAgentMetadata,
) => Promise<AgentCallResult>;

/**
 * Agent call configuration — mirrors the proto `AgentCallTaskConfig`.
 * Parsed from the YAML `with:` block of a `call: agent` task.
 */
export interface AgentCallConfig {
  readonly agent: string;
  readonly message: string;
  readonly org?: string;
  readonly env?: Record<string, string>;
  readonly config?: AgentExecutionCallConfig;
  readonly output?: AgentCallOutputContract;
  readonly harness?: string;
}

export interface AgentExecutionCallConfig {
  readonly model?: string;
  readonly timeout?: number;
  readonly temperature?: number;
  readonly max_cost_micros?: number;
}

export interface AgentCallOutputContract {
  readonly schema: Record<string, unknown>;
  readonly on_invalid?: "ON_INVALID_FAIL" | "ON_INVALID_RETRY" | "ON_INVALID_FALLBACK";
  readonly max_retries?: number;
  readonly fallback_task?: string;
}

export interface CallAgentMetadata {
  readonly parentWorkflowId: string;
  readonly taskName: string;
  readonly workflowExecutionId: string;
}

export interface AgentCallResult {
  readonly structured?: unknown;
  readonly final_text?: string;
  readonly agent_execution_id?: string;
  readonly usage_summary?: AgentUsageSummary;
}

export interface AgentUsageSummary {
  readonly total_tokens?: number;
  readonly estimated_cost_usd?: number;
  readonly tool_call_count?: number;
  readonly artifact_count?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Workflow Execution Event Descriptors
//
// Plain-object event descriptors that can be constructed inside the
// Temporal deterministic sandbox (no proto imports, no I/O). The
// emit activity converts these to WorkflowExecutionEvent proto
// objects before sending to the server.
// ─────────────────────────────────────────────────────────────────────

export type WorkflowEventDescriptor =
  | ExecutionStartedEvent
  | ExecutionCompletedEvent
  | ExecutionFailedEvent
  | TaskStartedEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskSkippedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | AgentCallStartedEvent
  | AgentCallCompletedEvent;

interface EventBase {
  readonly taskName?: string;
  readonly occurredAt: string;
}

export interface ExecutionStartedEvent extends EventBase {
  readonly type: "execution_started";
  readonly totalTasks: number;
  readonly workflowId: string;
  readonly workflowInstanceId: string;
}

export interface ExecutionCompletedEvent extends EventBase {
  readonly type: "execution_completed";
  readonly durationMs: number;
  readonly totalCostMicros: number;
  readonly totalTokens: number;
  readonly totalInputTokens?: number;
  readonly totalOutputTokens?: number;
}

export interface ExecutionFailedEvent extends EventBase {
  readonly type: "execution_failed";
  readonly error: string;
  readonly failedTaskName: string;
  readonly durationMs: number;
}

export interface TaskStartedEvent extends EventBase {
  readonly type: "task_started";
  readonly taskKind: string;
  readonly attemptNumber: number;
}

export interface TaskCompletedEvent extends EventBase {
  readonly type: "task_completed";
  readonly taskKind: string;
  readonly durationMs: number;
  readonly costMicros: number;
  readonly tokensUsed: number;
}

export interface TaskFailedEvent extends EventBase {
  readonly type: "task_failed";
  readonly taskKind: string;
  readonly error: string;
  readonly attemptNumber: number;
  readonly willRetry: boolean;
  readonly durationMs: number;
}

export interface TaskSkippedEvent extends EventBase {
  readonly type: "task_skipped";
  readonly taskKind: string;
  readonly reason: string;
}

export interface ApprovalRequestedEvent extends EventBase {
  readonly type: "approval_requested";
  readonly prompt: string;
  readonly approvers: readonly string[];
  readonly timeoutSeconds: number;
  readonly outcomes: ReadonlyArray<{ name: string; label: string }>;
  readonly formSchema?: Record<string, unknown>;
}

export interface ApprovalResolvedEvent extends EventBase {
  readonly type: "approval_resolved";
  readonly outcome: string;
  readonly resolvedBy: string;
  readonly comment: string;
  readonly waitDurationMs: number;
  readonly autoResolved: boolean;
}

export interface AgentCallStartedEvent extends EventBase {
  readonly type: "agent_call_started";
  readonly childExecutionId: string;
  readonly agentSlug: string;
  readonly messageSummary: string;
}

export interface AgentCallCompletedEvent extends EventBase {
  readonly type: "agent_call_completed";
  readonly childExecutionId: string;
  readonly durationMs: number;
  readonly tokensConsumed: number;
  readonly costMicros: number;
  readonly error: string;
}

export type EmitEventsFn = (events: WorkflowEventDescriptor[]) => Promise<void>;

// ─────────────────────────────────────────────────────────────────────
// WorkflowState (forward declaration — implemented in state.ts)
// ─────────────────────────────────────────────────────────────────────

/**
 * Workflow execution state. Carried through the task chain and
 * provides the jq variable bindings ($context, $data, $env, etc.).
 *
 * Defined here as an interface for use in type signatures.
 * The concrete implementation lives in state.ts.
 */
export interface WorkflowState {
  context: unknown;
  data: Record<string, unknown>;
  env: Record<string, unknown>;
  input: unknown;
  output: unknown;
  addData(data: Record<string, unknown>): void;
  getAsMap(): Record<string, unknown>;
  clone(): WorkflowState;
  clearOutput(): void;
}
