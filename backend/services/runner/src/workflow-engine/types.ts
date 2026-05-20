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
  | RaiseTaskDef
  | CallHttpTaskDef
  | CallGrpcTaskDef
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
 * Custom call function — covers Stigmer extensions:
 * call: agent | llm | transform | validate | human_input |
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

export type DurationDef = string | { readonly seconds?: number; readonly minutes?: number; readonly hours?: number };

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
 * expression evaluation and the workflow document without coupling
 * task implementations to Temporal APIs.
 */
export interface TaskExecutionContext {
  readonly evaluateExpressions: ExpressionEvaluator;
  readonly doc: WorkflowModel;
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
