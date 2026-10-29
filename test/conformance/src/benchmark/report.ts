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
//   call, and each other engine folds its rounds from its own events.
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
// - The native arm runs on any model (`--stigmer-model` since v12), one per run, so a
//   report says which arm it measured (schema v8): the native parity model
//   (`models.parity.stigmer` since v11) is that model, `stigmer_endpoint` the host its calls went to (never a key or
//   a path), `stigmer_api` the API they were made on, and `stigmer_cost_basis`
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
// - A native agent can run a shell command in the background, and an
//   operator can turn that off (runner STIGMER_SHELL_BACKGROUND_ENABLED), so
//   a report says which arm it measured (schema v10):
//   `methodology.shell_background`. Every sample that ran carries what the
//   agent did with background commands (`background`, derived in
//   `background-readings.ts` on the runner's one clock, and the processes
//   the turn left behind, `orphans.ts`), every tool call when it
//   started, and `task_done`: whether a cell's own checks of the work held,
//   so a fast sample that skipped the work reads as what it is.
// - A report is keyed by engine (schema v11): a comparison's `sides` and
//   `cost_ratio`, and the arms' models (`models.parity`), are records over
//   `BenchmarkHarness`, where v10 named one field per engine. Adding an
//   engine then needs no schema change, and neither does retiring one: its
//   member leaves the union, which the compiler follows to every site that
//   branched on it, and the axes only its samples carried leave with it. A
//   v11 report written while an engine since retired still reads: the
//   reader checks the engines it knows and ignores the rest.
// - Every harness is keyed by its one word, the first word of its label in
//   lower case (schema v12): `stigmer` and `claude` in `sides`, `models.parity`, an
//   arm's label (`stigmer/<model>`) and the cell ids, and the Stigmer arm's
//   endpoint, API and cost basis are `models.stigmer_endpoint`,
//   `stigmer_api` and `stigmer_cost_basis`. v11 keyed the same arm
//   `deep-agent` and `native`.

export const BENCHMARK_REPORT_SCHEMA_VERSION = 12;

/**
 * Every harness the benchmark measures, by its one word, in the order a
 * report lists them: Stigmer first, the reference. The word is the same in
 * the runner's `turn_phases` line, an arm's label (`<word>/<model>`), a
 * quality target and the script's flags.
 */
export const HARNESSES = ["stigmer", "claude"] as const;

/** A harness the benchmark measures. */
export type BenchmarkHarness = (typeof HARNESSES)[number];

export type ComparisonMode = "parity" | "default" | "turn-2" | "working-agent";

export type SessionShape = "fresh-per-execution" | "one-session-three-turns";

/** Whether the runner let the native agent start shell commands in the background (STIGMER_SHELL_BACKGROUND_ENABLED). */
export type ShellBackground = "on" | "off";

/**
 * Which agent a cell measures: the bare agent the request-shape goldens
 * photograph (support/agents.ts), or the working agent (support/working-agent.ts).
 */
export type AgentShape = "bare" | "working";

export type SampleOutcome = "completed" | "failed" | "cancelled" | "timeout";

export type RefusalReason =
  | "missing ANTHROPIC_API_KEY"
  | "missing OPENAI_API_KEY"
  | "model provider unknown"
  | "the native model is pinned by --stigmer-model"
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
   * ActivityTaskCompleted. Null on every Claude sample by construction: only
   * the native flow schedules EnsureThread (the LangGraph thread).
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
   * Runner clock: the `connect_mcp` segment of `execution_setup`. Null on a
   * turn whose setup line names no such segment, as a native turn with no
   * server to connect.
   */
  mcp_connect_ms: number | null;
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
  /** Runner clock: the start of the tool span the call was placed on; `null` exactly where `round` is. */
  start_ms: number | null;
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

/**
 * How a background command ended, as the session's log folds it: it exited,
 * ran out its time, was stopped (by the agent's stop tool, a person, the
 * turn's pause for an approval, or the turn's end), or never started.
 * `running` is one the log had not seen end when the turn was read.
 */
export type BackgroundEndingKey =
  | "exited"
  | "timed_out"
  | "stopped_by_agent"
  | "stopped_by_person"
  | "stopped_by_approval"
  | "stopped_by_turn"
  | "failed_to_start"
  | "running";

/**
 * What the agent did with background commands in one turn (`background-readings.ts`).
 * Counts are over the primary thread's calls. A runner-clock reading is
 * `null` when the turn has no timeline, and a reading that needs each call's
 * start is `null` when the timeline cannot place the calls (a sub-agent ran):
 * never guessed.
 */
export interface BackgroundReadings {
  /** Shell calls that asked for the background. */
  starts: number;
  /** Those commands by how they ended. */
  endings: Record<BackgroundEndingKey, number>;
  /** Runner clock: model and tool time overlapping any command's run, the measure of "kept working". */
  worked_while_running_ms: number | null;
  /**
   * Calls that started while a command ran and read or searched a command's
   * output file, or a shell call that begins with `sleep`: polling, by
   * OpenCode's definition ("repeatedly sleeping and reading or searching the
   * output file").
   */
  polls: number | null;
  /** Foreground shell calls that begin with `sleep`, wherever they fall. */
  sleeps: number;
  /** Shell calls that put a command in the background themselves: a lone `&`, or `nohup`. */
  self_backgrounded: number;
  /** Shell calls that ran out their foreground time limit. */
  foreground_timeouts: number;
  /** Runner clock: the waits at a round's end for running commands, and their total length. */
  waits: number | null;
  wait_ms: number | null;
  /** Times the agent was sent back with a reminder that its commands still ran. */
  reminders: number | null;
  /**
   * Shell calls that started while a command ran. Under the default approval
   * policy each would pause the turn and stop every running command; the
   * benchmark approves everything, so this is an estimate of that cost, not
   * an observation.
   */
  gated_while_running: number | null;
  /** Process groups the attempt left running in its workspace or on the fixture's port, each stopped after the attempt; `null` where nothing was swept. */
  orphans: number | null;
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
  /** What the agent did with background commands; `null` on an attempt that never ran. */
  background: BackgroundReadings | null;
  /** Whether every one of the cell's checks of the work held; `null` on a cell that names none. */
  task_done: boolean | null;
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
  /** Each harness the cell ran on, by harness. */
  sides: Partial<Record<BenchmarkHarness, BenchmarkStat>>;
  /** Each side's warm median cost over native's, by harness; native itself is never listed, and a side without a median is left out. */
  cost_ratio: Partial<Record<BenchmarkHarness, number>>;
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
    /** Whether the runner let the native agent start commands in the background: the arm (`--shell-background`). */
    shell_background: ShellBackground;
  };
  models: {
    /** Each arm's model, by harness; native's is `--stigmer-model`, else its parity pin. */
    parity: Record<BenchmarkHarness, string>;
    judge_requested: string;
    /** The host the native model's calls went to, or the Anthropic backend's name; never a key or a path. */
    stigmer_endpoint: string;
    stigmer_api: NativeApi;
    stigmer_cost_basis: NativeCostBasis;
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

/** A side's warm median cost over native's; `undefined` when either has no median or native's cost is 0. */
export function costRatio(side: BenchmarkStat | undefined, native: BenchmarkStat | undefined): number | undefined {
  if (side?.median === null || side?.median === undefined) return undefined;
  if (native?.median === null || native?.median === undefined) return undefined;
  if (native.median.estimated_cost_micros === 0) return undefined;
  return side.median.estimated_cost_micros / native.median.estimated_cost_micros;
}

/** Every side's cost over native's, for the sides that are not native and have one (`costRatio`). */
export function costRatios(sides: Partial<Record<BenchmarkHarness, BenchmarkStat>>): Partial<Record<BenchmarkHarness, number>> {
  const ratios: Partial<Record<BenchmarkHarness, number>> = {};
  for (const harness of HARNESSES) {
    if (harness === "stigmer") continue;
    const ratio = costRatio(sides[harness], sides.stigmer);
    if (ratio !== undefined) ratios[harness] = ratio;
  }
  return ratios;
}

/** What a comparison names of its scenario (cells.ts `Scenario`, read structurally so this module stays a leaf). */
export interface ComparedScenario {
  readonly name: string;
  readonly prompts: readonly string[];
  readonly mode: ComparisonMode;
  readonly sessionShape: SessionShape;
  readonly agent: AgentShape;
}

/** One scenario's comparison: each harness it ran on, and each side's cost over native's (`costRatios`). */
export function comparisonOf(scenario: ComparedScenario, sides: Partial<Record<BenchmarkHarness, BenchmarkStat>>): BenchmarkComparison {
  return {
    scenario: scenario.name,
    prompts: [...scenario.prompts],
    mode: scenario.mode,
    session_shape: scenario.sessionShape,
    agent: scenario.agent,
    sides,
    cost_ratio: costRatios(sides),
  };
}

// ─── The reader ─────────────────────────────────────────────────────────────

const NATIVE_APIS: readonly NativeApi[] = ["messages", "chat-completions", "responses"];
const NATIVE_COST_BASES: readonly NativeCostBasis[] = ["catalog", "default-rate"];
const SHELL_BACKGROUNDS: readonly ShellBackground[] = ["on", "off"];

/**
 * Refuses, by naming the field, a body that is not a current benchmark report. It
 * checks the discriminating fields and the shape every consumer walks
 * (`comparisons[].sides.<harness>.median`, `git.head_sha` and `git.code_sha`,
 * `methodology.reps` and `shell_background`, the native arm in `models`,
 * `runner_log`) and trusts the rest to the producer: a full
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
  requireOneOf(methodology, "shell_background", SHELL_BACKGROUNDS, "report.methodology");
  const models = asRecord(root["models"], "report.models");
  const parity = asRecord(models["parity"], "report.models.parity");
  for (const harness of HARNESSES) requireString(parity, harness, "report.models.parity");
  requireString(models, "stigmer_endpoint", "report.models");
  requireOneOf(models, "stigmer_api", NATIVE_APIS, "report.models");
  requireOneOf(models, "stigmer_cost_basis", NATIVE_COST_BASES, "report.models");
  const comparisons = root["comparisons"];
  if (!Array.isArray(comparisons)) throw new Error("not a benchmark report: comparisons is not an array");
  comparisons.forEach((entry, index) => {
    const comparison = asRecord(entry, `report.comparisons[${index}]`);
    requireString(comparison, "scenario", `report.comparisons[${index}]`);
    requireString(comparison, "mode", `report.comparisons[${index}]`);
    requireString(comparison, "agent", `report.comparisons[${index}]`);
    const sides = asRecord(comparison["sides"], `report.comparisons[${index}].sides`);
    asRecord(comparison["cost_ratio"], `report.comparisons[${index}].cost_ratio`);
    for (const side of HARNESSES) {
      if (sides[side] === undefined) continue;
      const where = `report.comparisons[${index}].sides.${side}`;
      const stat = asRecord(sides[side], where);
      requireNumber(stat, "n", where);
      if (stat["median"] !== null) {
        const measures = asRecord(stat["median"], `${where}.median`);
        requireNumber(measures, "estimated_cost_micros", `${where}.median`);
        asRecord(measures["tokens"], `${where}.median.tokens`);
      }
      if (!Array.isArray(stat["models"])) {
        throw new Error(`not a benchmark report: comparisons[${index}].sides.${side}.models is not an array`);
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
