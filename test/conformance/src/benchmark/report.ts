// The harness benchmark report: the one contract between the producer
// (`scripts/benchmark-harnesses.ts`, over `src/benchmark/run.ts`) and its
// readers: the CLI's own per-cell table, and the maintainers who keep a
// run's report with the record of the work that prompted it. The benchmark
// is an internal instrument; its numbers are never published on the docs
// site (the docs-writing skill's refusals carry the rule and its reason:
// `.agents/skills/docs-writing/SKILL.md`), so a hunk here
// is the review of what the maintainers will read differently.
// Domain: conformance benchmark (the live instrument's output).
//
// This module is a LEAF by rule: a report is JSON read by tools outside this
// workspace under tsconfigs this workspace does not control, so it imports
// no `node:` builtin, no proto stub and no schema library, carries `number`
// never `bigint`, and hand-writes its reader over `unknown`.
//
// What the shape embodies, and why:
// - Every sample is kept whole (`samples`), failed attempts included with
//   their `outcome`, so a later reader derives what it needs without a second
//   paid run; the stat's `median` is taken per field over the SUCCESSFUL
//   samples only, because one sample cannot be the median of cost and of
//   latency at once.
// - Cost is the runner's own rate-card estimate (`streaming_usage.
//   estimated_cost_usd`), never a billed figure: the open-source edition
//   records no per-call usage. `cost_source` says so on every sample.
// - `cache_hit_ratio` is cache-read over `input_tokens`, because both
//   harnesses report `input_tokens` cache-INCLUSIVE (the cache buckets are
//   subsets of it); dividing by input + cache buckets would read a fully
//   cached prompt as a 50% hit rate.
// - "Cold" is the run's FIRST call per harness, served model and agent shape,
//   not each cell's first attempt: every cell of one agent shape sends the
//   same prompt prefix on the same served model, so the provider's prompt
//   cache is warm for every such cell after the first. The bare and the
//   working agent send different prefixes, so each pays its own cache write.
//   Each cell's first attempt is a discarded `warmup`; `cold_first_call` is
//   present on the one cell that paid the cache write and `null` elsewhere.
// - `rounds` and `tool_calls` are the runtime's fold of each harness's own
//   events (runner harness/turn-timeline.ts) and are NOT one unit across
//   harnesses: both count a sub-agent's work, a native round is a provider
//   call, and a Cursor round is a stretch of output between tool calls, with
//   a sub-agent's transcript synthesized into rounds of its own (stigmer#1289).
//   Compare a harness with itself across runs; across harnesses, read them as
//   shape.
// - A turn that edits files parks for review before it ends (the runner
//   captures the edits and the execution waits for a decision). The
//   benchmark approves at once and records when the agent's work was done
//   (`review_ready_ms`) beside when the execution ended (`end_to_end_ms`).
// - Every failed attempt says where it failed (`failure.stage`) and why, in
//   the platform's own words.
// - Two SHAs: the repository squash-merges, so a branch HEAD alone resolves
//   on nothing after the merge. `main_sha` (the merge base with main) is the
//   SHA a readout cites; `head_sha` and the PR locate the instrument's exact
//   bytes.
// - Every latency axis names its clock in the type's comment. The client
//   axes start at the create call; the Temporal axes are on Temporal's clock;
//   the runner axes are on the runner's own origin (the activity's start).
// - Every sample carries its root tool calls (`tool_calls`), each placed on
//   the model round that issued it, with its target and how it ended, and the
//   turn's final to-do list by state (`todos`), because the counts alone say
//   how many rounds a turn took and never why (schema v4; the derivation is
//   `tool-call-facts.ts`'s). Targets are kept, results and file contents never.
// - The quality arm is an eval run about a plugin (schema v7; v6 kept a
//   plugin eval's document, whose cases sat at its top): the working agent
//   as a plugin whose `evals/` suite holds the quality tasks, with each
//   harness's parity model as a target. `quality` carries the eval run's
//   id, what was asked of it, and its result document whole (`@stigmer/client`
//   `toResultDocument`, whose one plugin block is the plugin-eval format's
//   `schemaVersion: 1` file), so a reader reads the quality numbers as any
//   plugin author reads theirs. The document is kept as JSON, not typed
//   here, because this module stays a leaf. Grades from v5 and earlier came
//   from another judge on another scale and are not compared.
// - The native arm runs on any model (`--native-model`), one per run, so a
//   report says which arm it measured (schema v8): `models.parity_native` is
//   that model, `native_endpoint` the host its calls went to (never a key or
//   a path), `native_api` the API they were made on, and `native_cost_basis`
//   whether the runner priced them from a catalog row or at its default rate
//   (runner shared/model-pricing.ts `getModelPricing`: a model with no priced
//   registry row is costed at one fixed invented rate). A default-rate arm's
//   `estimated_cost_micros` is not a price; a readout prices it from the
//   sample's `tokens` at the provider's published rate, and names the rate.
// - A report says which code it measured, apart from the instrument that
//   measured it (schema v9): the script can boot another checkout's server
//   and runner (`--stack`), so `git.code_sha` is that checkout's HEAD and
//   `git.head_sha` stays the instrument's. One instrument measures two
//   versions of the code alike, and `benchmark-compare` keys an arm by both
//   its model and its code. `runner_log` counts the runner's marker lines
//   over the run (log-markers.ts), the one record of whether an edit was
//   repaired, a result cut, a model call retried or a repository's own
//   instructions read; and a tool call's fact says when it asked for a
//   background command.

export const BENCHMARK_REPORT_SCHEMA_VERSION = 9;

/** The runtime's harness vocabulary, as the runner's `turn_phases` line labels it. */
export type BenchmarkHarness = "deep-agent" | "cursor";

export type ComparisonMode = "parity" | "default" | "turn-2" | "working-agent";

export type SessionShape = "fresh-per-execution" | "one-session-three-turns";

/**
 * Which agent a cell measures: the bare agent the request-shape goldens
 * photograph (support/agents.ts), or the working agent (support/working-agent.ts).
 */
export type AgentShape = "bare" | "working";

export type SampleOutcome = "completed" | "failed" | "cancelled" | "timeout";

export type RefusalReason =
  | "missing ANTHROPIC_API_KEY"
  | "missing CURSOR_API_KEY"
  | "missing OPENAI_API_KEY"
  | "model provider unknown"
  | "the native model is pinned by --native-model"
  | "thinking needs a catalog Claude model"
  | "excluded by --only"
  | "excluded by --cells"
  | "model not in registry for harness"
  | "missing stigmer CLI"
  | "thinking needs a pinned model"
  | "runs only when --cells names it";

/** The API a native model's calls were made on. */
export type NativeApi = "messages" | "chat-completions" | "responses";

/** Whether the runner priced the native model from a catalog row, or at its default rate. */
export type NativeCostBasis = "catalog" | "default-rate";

/** Where an attempt failed: creating it, running it, or grading it. */
export type FailureStage = "create" | "execution";

export interface SampleFailure {
  stage: FailureStage;
  /** The platform's own words: the RPC error, `status.error`, or why a verdict was refused. */
  message: string;
}

/**
 * The runner's `stigmer_timing` line, kept whole: `segments` are what the
 * warm-session work reads on turn 2 of a session, and a report that dropped
 * them would cost a second paid run to recover.
 */
export interface TimingLine {
  event: string;
  /** Every other field of the line (`execution_id`, `harness`, `rounds`, ...). */
  context: Record<string, string | number | boolean | null>;
  total_ms: number;
  segments: TimingSegment[];
}

export interface TimingSegment {
  name: string;
  start_ms: number;
  duration_ms: number;
}

/** The latency and count axes of one execution. `null` means "not observed", never zero. */
export interface BenchmarkAxes {
  /** Client clock: the create call's start to the receive of the subscribe message carrying the terminal phase. */
  end_to_end_ms: number | null;
  /** Client clock: the create call's start to the first subscribe message with a root AI or THINKING row with content. */
  client_first_visible_token_ms: number | null;
  /** Client clock: the same, for a root AI row alone. */
  client_first_text_ms: number | null;
  /** Temporal's clock: WorkflowExecutionStarted to the execute activity's ActivityTaskStarted. */
  before_activity_ms: number | null;
  /**
   * Temporal's clock: the EnsureThread activity's ActivityTaskScheduled to its
   * ActivityTaskCompleted. Null on every Cursor sample by construction: only the
   * native flow schedules EnsureThread (the LangGraph thread); the Cursor flow
   * reads its harness state instead (invoke-agent-execution.ts).
   */
  ensure_thread_ms: number | null;
  /** Runner clock (the activity's start): `turn_phases.first_visible_token_ms`. */
  runner_first_visible_token_ms: number | null;
  /** Runner clock: `turn_phases.first_text_ms`. */
  runner_first_text_ms: number | null;
  /** Runner clock: `execution_setup.total_ms`. */
  execution_setup_ms: number | null;
  /** Runner clock: `turn_phases.total_ms`. */
  turn_total_ms: number | null;
  /** Runner clock: `turn_phases.max_gap_ms`. */
  max_gap_ms: number | null;
  /** `turn_phases.rounds`; see the header on comparing it across harnesses. */
  rounds: number | null;
  /** `turn_phases.tool_calls`, sub-agent calls included. */
  tool_calls: number | null;
  /** `turn_phases.sub_agents`: delegations in the turn, not the sub-agents declared. */
  sub_agent_calls: number | null;
  /**
   * Client clock: the create call's start to the first subscribe message
   * carrying a change set AWAITING_REVIEW, the instant the agent's work was
   * done. Null on a turn that offered nothing for review.
   */
  review_ready_ms: number | null;
  /**
   * Runner clock: the `connect_mcp` segment of `execution_setup`. Null on
   * every Cursor sample by construction: the Cursor SDK connects its servers
   * inside `send()`, after setup is written (see `cursor_send_returned_ms`).
   * Null on a native turn with no server to connect.
   */
  mcp_connect_ms: number | null;
  /**
   * Runner clock: the `send_returned` segment of the Cursor-only
   * `turn_first_event` line, the window in which the SDK acquires its
   * executor and spawns stdio servers. Null on every native sample.
   */
  cursor_send_returned_ms: number | null;
  /** `execution_setup.mcp_server_count`: the servers the agent and session declare, attachments excluded. */
  mcp_server_count: number | null;
  /** Platform attachments the runtime adds beside the declared servers (memory, on this stack). */
  attachment_count: number | null;
  /** `execution_setup.skill_count`: the skill references, as declared. */
  skill_count: number | null;
  /** `execution_setup.workspace_entry_count`. */
  workspace_entry_count: number | null;
}

export interface TokenCounts {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  total: number;
}

/** What a median is taken over: the axes plus the cost and token figures a readout reads. */
export interface BenchmarkMeasures extends BenchmarkAxes {
  estimated_cost_micros: number;
  tokens: TokenCounts;
}

/**
 * How one tool call ended. `not_found` and `not_unique` are the native
 * engine's failed edits, which it returns as a result rather than an error;
 * `failed` is any other error; `skipped` a call the approval gate or a
 * reviewer declined; `unsettled` a call the turn left pending or interrupted.
 */
export type ToolCallOutcome = "ok" | "failed" | "not_found" | "not_unique" | "skipped" | "unsettled";

/** One root tool call of a turn, in start order. */
export interface ToolCallFact {
  /** The 1-based model round that issued it, from the turn timeline; `null` where the timeline cannot place it. */
  round: number | null;
  name: string;
  /** The call's `file_path`, `path` or `pattern`, or the head of its `command`; "" when it names none. */
  target: string;
  /** A paged read's window, present only when the call set it. */
  offset?: number;
  limit?: number;
  /** How the call stands in the session's log: `completed`, `failed`, `denied`, `stopped`, ... */
  status: string;
  outcome: ToolCallOutcome;
  /** Present only on a shell call (`execute`) whose input asked to run the command in the background. */
  background?: true;
}

/** The turn's to-do list at its end, by state: what the user's progress card showed. */
export interface TodoCounts {
  pending: number;
  in_progress: number;
  completed: number;
  cancelled: number;
}

/**
 * A turn of a sampled session other than the sampled one. `turn_seq` is the
 * turn's place in the session (1-based); the runner's own `turn_seq` field on
 * its timing lines is an approval-cycle index within one execution, a
 * different count.
 */
export interface SiblingTurn {
  turn_seq: number;
  execution_id: string;
  measures: BenchmarkMeasures;
  timing: SampleTiming;
  tool_calls: ToolCallFact[];
  todos: TodoCounts;
  outcome: SampleOutcome;
  failure?: SampleFailure;
}

export interface SampleTiming {
  turn_phases: TimingLine | null;
  execution_setup: TimingLine | null;
  /** The Cursor-only first-event line; `null` on every native sample. */
  turn_first_event: TimingLine | null;
}

export interface BenchmarkSample {
  execution_id: string;
  session_id: string;
  /** The cell's pin, or "default". */
  model_requested: string;
  /** `streaming_usage.model`: the basis the adapter priced against, as reported. */
  model_reported: string;
  measures: BenchmarkMeasures;
  cost_source: "runner-rate-card-estimate";
  /** The server's own stamps, kept raw. */
  server: { created_at: string; started_at: string; completed_at: string };
  timing: SampleTiming;
  /** The turn's root tool calls in start order; empty on an attempt that never ran. */
  tool_calls: ToolCallFact[];
  todos: TodoCounts;
  outcome: SampleOutcome;
  /** Present on every attempt whose outcome is not `completed`. */
  failure?: SampleFailure;
  /** A three-turn sample keeps its session's first and third turns here. */
  sibling_turns?: SiblingTurn[];
}

export interface BenchmarkStat {
  harness: BenchmarkHarness;
  /** Successful warm samples. */
  n: number;
  failed: number;
  /** Every attempt after the warm-up, failed ones with their `outcome`. */
  samples: BenchmarkSample[];
  /** Each cell's first attempt, discarded from the medians, whatever its outcome. */
  warmup: BenchmarkSample;
  /** The run's first call for this harness and served model; `null` on every other cell. */
  cold_first_call: BenchmarkSample | null;
  /** Per-field medians over the successful samples; `null` when `n` is 0. */
  median: BenchmarkMeasures | null;
  /** Max minus min over the successful samples. */
  spread: { estimated_cost_micros: number; end_to_end_ms: number };
  /** Cache-read over input tokens, both summed over the successful samples. */
  cache_hit_ratio: number;
  /** Distinct `model_reported` values, in first-seen order. */
  models: string[];
}

export interface BenchmarkComparison {
  scenario: string;
  /** One prompt for a first-turn cell, three for a three-turn cell. */
  prompts: string[];
  mode: ComparisonMode;
  session_shape: SessionShape;
  agent: AgentShape;
  native?: BenchmarkStat;
  cursor?: BenchmarkStat;
  /** Warm median cost, native over cursor; absent when a side is. */
  cost_ratio?: number;
}

/**
 * The quality arm's one eval run. `document` is its result document as
 * JSON; `null`, with `failure`, when the eval run could not be pushed,
 * created or followed to its end.
 */
export interface QualityEval {
  /** The plugin under evaluation, as installed. */
  plugin: string;
  /** The eval run's id; "" when it was never created. */
  eval_id: string;
  /** The targets asked for, as `<harness>/<model>`. */
  targets: string[];
  judge_model: string;
  /** Tries per case and target. */
  runs: number;
  document: Record<string, unknown> | null;
  failure?: SampleFailure;
}

export interface RefusedCell {
  cell: string;
  reason: RefusalReason;
}

/**
 * The runner's marker lines over the run, every cell and the quality arm
 * together (log-markers.ts names each line's writer). Zero means the path
 * never fired, or the measured code has no such line.
 */
export interface RunnerLogMarkers {
  /** The runner logs read, in the order the runners started. */
  files: string[];
  /** Edits the runner repaired, by the tier that matched. */
  edit_repaired: Record<string, number>;
  /** Tool results cut to the bound, by whether the whole result was kept (`absent` on code that never said), and by tool. */
  truncated: { kept_yes: number; kept_no: number; kept_absent: number; by_tool: Record<string, number> };
  /** Failed model calls, by where they failed and what was decided. */
  model_retry: { request: { retry: number; stop: number }; stream: { retry: number; stop: number } };
  /** Turns that read the workspace's own instruction files (`root`), and nested files attached on a read (`nested`). */
  repo_instructions: { root: number; nested: number };
  hook_failures: number;
}

export interface BenchmarkReport {
  schema_version: typeof BENCHMARK_REPORT_SCHEMA_VERSION;
  /** ISO 8601, UTC. */
  timestamp: string;
  git: {
    /** The instrument's checkout HEAD (the tree the script ran from), `-dirty` when the tree had changes. */
    head_sha: string;
    /** The instrument's merge base with main: the SHA a readout cites. */
    main_sha: string;
    /**
     * The HEAD of the checkout whose server and runner were measured
     * (`--stack`), `-dirty` when that tree had changes; `head_sha` when the
     * run measured its own tree.
     */
    code_sha: string;
    pr?: number;
  };
  host: { platform: string; node: string };
  methodology: {
    reps: number;
    quality_reps: number;
    warmup_discarded: true;
    cold: "first-call-of-run-per-harness-model-and-agent";
    titling_suppressed: boolean;
    /** Every turn that offered a change set for review was approved whole, at once. */
    file_review: "approved-at-review-ready";
    /**
     * "enabled" when every execution of the run asked for thinking
     * (`--thinking enabled`); absent when none named a mode, so reports
     * written before the field read the same.
     */
    thinking_mode?: "enabled";
  };
  models: {
    /** The native arm's model: `--native-model`, else the parity pin. */
    parity_native: string;
    parity_cursor: string;
    judge_requested: string;
    /** The host the native model's calls went to, or the Anthropic backend's name; never a key or a path. */
    native_endpoint: string;
    native_api: NativeApi;
    native_cost_basis: NativeCostBasis;
  };
  comparisons: BenchmarkComparison[];
  /** The quality arm's eval; `null` when no quality target was planned. */
  quality: QualityEval | null;
  refused: RefusedCell[];
  runner_log: RunnerLogMarkers;
}

// ─── Statistics ─────────────────────────────────────────────────────────────

/**
 * The median of a list, as the July methodology read it: the middle sample
 * for an odd count, the upper-middle for an even one (so the value is always
 * an observed sample, never an interpolation). `null` on an empty list.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/** Max minus min; 0 on an empty list. */
export function spread(values: number[]): number {
  if (values.length === 0) return 0;
  let min = values[0] ?? 0;
  let max = min;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min;
}

/**
 * Cache-read over input tokens, both summed. `input_tokens` is cache-inclusive
 * on both harnesses (see the header), so this is the share of the prompt the
 * provider served from its cache. 0 when nothing was sent.
 */
export function cacheHitRatio(samples: readonly BenchmarkSample[]): number {
  let input = 0;
  let cacheRead = 0;
  for (const sample of samples) {
    input += sample.measures.tokens.input;
    cacheRead += sample.measures.tokens.cache_read;
  }
  return input === 0 ? 0 : cacheRead / input;
}

const AXIS_KEYS: readonly (keyof BenchmarkAxes)[] = [
  "end_to_end_ms",
  "client_first_visible_token_ms",
  "client_first_text_ms",
  "before_activity_ms",
  "ensure_thread_ms",
  "runner_first_visible_token_ms",
  "runner_first_text_ms",
  "execution_setup_ms",
  "turn_total_ms",
  "max_gap_ms",
  "rounds",
  "tool_calls",
  "sub_agent_calls",
  "review_ready_ms",
  "mcp_connect_ms",
  "cursor_send_returned_ms",
  "mcp_server_count",
  "attachment_count",
  "skill_count",
  "workspace_entry_count",
];

const TOKEN_KEYS: readonly (keyof TokenCounts)[] = ["input", "output", "cache_read", "cache_write", "total"];

/**
 * Per-field medians over the given samples. A `null` axis on a sample is left
 * out of that field's median rather than counted as zero; a field with no
 * observed value is `null`. `null` for an empty list.
 */
export function medianMeasures(samples: readonly BenchmarkSample[]): BenchmarkMeasures | null {
  if (samples.length === 0) return null;
  const axes = {} as Record<keyof BenchmarkAxes, number | null>;
  for (const key of AXIS_KEYS) {
    const observed: number[] = [];
    for (const sample of samples) {
      const value = sample.measures[key];
      if (value !== null) observed.push(value);
    }
    axes[key] = median(observed);
  }
  const tokens = {} as Record<keyof TokenCounts, number>;
  for (const key of TOKEN_KEYS) {
    tokens[key] = median(samples.map((sample) => sample.measures.tokens[key])) ?? 0;
  }
  return {
    ...axes,
    estimated_cost_micros: median(samples.map((sample) => sample.measures.estimated_cost_micros)) ?? 0,
    tokens,
  };
}

/** One cell's stat from its attempts: the warm-up, then the samples in run order. */
export function summarize(
  harness: BenchmarkHarness,
  warmup: BenchmarkSample,
  samples: BenchmarkSample[],
  coldFirstCall: BenchmarkSample | null,
): BenchmarkStat {
  const successful = samples.filter((sample) => sample.outcome === "completed");
  const models: string[] = [];
  for (const sample of successful) {
    if (sample.model_reported !== "" && !models.includes(sample.model_reported)) models.push(sample.model_reported);
  }
  return {
    harness,
    n: successful.length,
    failed: samples.length - successful.length,
    samples,
    warmup,
    cold_first_call: coldFirstCall,
    median: medianMeasures(successful),
    spread: {
      estimated_cost_micros: spread(successful.map((sample) => sample.measures.estimated_cost_micros)),
      end_to_end_ms: spread(
        successful.flatMap((sample) => (sample.measures.end_to_end_ms === null ? [] : [sample.measures.end_to_end_ms])),
      ),
    },
    cache_hit_ratio: cacheHitRatio(successful),
    models,
  };
}

/** Native warm median cost over cursor's; `undefined` when either side has no median or cursor's cost is 0. */
export function costRatio(native: BenchmarkStat | undefined, cursor: BenchmarkStat | undefined): number | undefined {
  if (native?.median === null || native?.median === undefined) return undefined;
  if (cursor?.median === null || cursor?.median === undefined) return undefined;
  if (cursor.median.estimated_cost_micros === 0) return undefined;
  return native.median.estimated_cost_micros / cursor.median.estimated_cost_micros;
}

// ─── The reader ─────────────────────────────────────────────────────────────

const NATIVE_APIS: readonly NativeApi[] = ["messages", "chat-completions", "responses"];
const NATIVE_COST_BASES: readonly NativeCostBasis[] = ["catalog", "default-rate"];

/**
 * Refuses, by naming the field, a body that is not a current benchmark report. It
 * checks the discriminating fields and the shape every consumer walks
 * (`comparisons[].{native,cursor}.median`, `git.head_sha` and `git.code_sha`,
 * `methodology.reps`, the native arm in `models`, `runner_log`) and trusts
 * the rest to the producer: a full
 * structural check would be a second copy of the types above.
 */
export function readBenchmarkReport(body: unknown): BenchmarkReport {
  const root = asRecord(body, "report");
  const version = root["schema_version"];
  if (version !== BENCHMARK_REPORT_SCHEMA_VERSION) {
    throw new Error(
      `not a v${BENCHMARK_REPORT_SCHEMA_VERSION} benchmark report: schema_version is ${JSON.stringify(version)}`,
    );
  }
  requireString(root, "timestamp", "report");
  const git = asRecord(root["git"], "report.git");
  requireString(git, "head_sha", "report.git");
  requireString(git, "main_sha", "report.git");
  requireString(git, "code_sha", "report.git");
  const methodology = asRecord(root["methodology"], "report.methodology");
  requireNumber(methodology, "reps", "report.methodology");
  requireNumber(methodology, "quality_reps", "report.methodology");
  const models = asRecord(root["models"], "report.models");
  requireString(models, "parity_native", "report.models");
  requireString(models, "native_endpoint", "report.models");
  requireOneOf(models, "native_api", NATIVE_APIS, "report.models");
  requireOneOf(models, "native_cost_basis", NATIVE_COST_BASES, "report.models");
  const comparisons = root["comparisons"];
  if (!Array.isArray(comparisons)) throw new Error("not a benchmark report: comparisons is not an array");
  comparisons.forEach((entry, index) => {
    const comparison = asRecord(entry, `report.comparisons[${index}]`);
    requireString(comparison, "scenario", `report.comparisons[${index}]`);
    requireString(comparison, "mode", `report.comparisons[${index}]`);
    requireString(comparison, "agent", `report.comparisons[${index}]`);
    for (const side of ["native", "cursor"] as const) {
      if (comparison[side] === undefined) continue;
      const stat = asRecord(comparison[side], `report.comparisons[${index}].${side}`);
      requireNumber(stat, "n", `report.comparisons[${index}].${side}`);
      if (stat["median"] !== null) {
        const measures = asRecord(stat["median"], `report.comparisons[${index}].${side}.median`);
        requireNumber(measures, "estimated_cost_micros", `report.comparisons[${index}].${side}.median`);
        asRecord(measures["tokens"], `report.comparisons[${index}].${side}.median.tokens`);
      }
      if (!Array.isArray(stat["models"])) {
        throw new Error(`not a benchmark report: comparisons[${index}].${side}.models is not an array`);
      }
    }
  });
  if (root["quality"] !== null) {
    const quality = asRecord(root["quality"], "report.quality");
    requireString(quality, "eval_id", "report.quality");
    if (quality["document"] !== null) asRecord(quality["document"], "report.quality.document");
  }
  if (!Array.isArray(root["refused"])) throw new Error("not a benchmark report: refused is not an array");
  const runnerLog = asRecord(root["runner_log"], "report.runner_log");
  if (!Array.isArray(runnerLog["files"])) throw new Error("not a benchmark report: runner_log.files is not an array");
  asRecord(runnerLog["truncated"], "report.runner_log.truncated");
  asRecord(runnerLog["model_retry"], "report.runner_log.model_retry");
  asRecord(runnerLog["repo_instructions"], "report.runner_log.repo_instructions");
  return root as unknown as BenchmarkReport;
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`not a benchmark report: ${where} is ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string, where: string): void {
  if (typeof record[key] !== "string") {
    throw new Error(`not a benchmark report: ${where}.${key} is ${describe(record[key])}, expected a string`);
  }
}

function requireNumber(record: Record<string, unknown>, key: string, where: string): void {
  if (typeof record[key] !== "number") {
    throw new Error(`not a benchmark report: ${where}.${key} is ${describe(record[key])}, expected a number`);
  }
}

function requireOneOf(record: Record<string, unknown>, key: string, allowed: readonly string[], where: string): void {
  const value = record[key];
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(
      `not a benchmark report: ${where}.${key} is ${typeof value === "string" ? JSON.stringify(value) : describe(value)}, expected one of ${allowed.join(", ")}`,
    );
  }
}

function describe(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}
