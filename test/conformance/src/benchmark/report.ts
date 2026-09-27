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

export const BENCHMARK_REPORT_SCHEMA_VERSION = 3;

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
  | "excluded by --only"
  | "excluded by --cells"
  | "model not in registry for harness"
  | "missing stigmer CLI";

/** Where an attempt failed: creating it, running it, or grading it. */
export type FailureStage = "create" | "execution" | "judge";

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

/** One criterion of a task's rubric, as the judge scored it. */
export interface CriterionGrade {
  name: string;
  weight: number;
  score: number;
  reasoning: string;
}

export type QualityCheckName = "go_test";

/** A check the benchmark ran on the workspace after the task's last turn. */
export interface QualityCheck {
  name: QualityCheckName;
  /** `not-run` names why in `detail` (for example, no `go` on PATH); never silent. */
  outcome: "passed" | "failed" | "not-run";
  /** The command's exit code and output tail, or why it did not run. */
  detail: string;
}

/** A file whose bytes differ from the fixture's after the task's last turn. */
export interface FileChangeFact {
  path: string;
  change: "added" | "modified" | "deleted";
}

/**
 * One graded attempt of a quality task on one harness: the session the
 * working agent ran (`turns`), what the workspace held afterwards
 * (`files_changed`, `checks`), exactly what the judge was shown (`subject`)
 * and its verdict. A verdict whose criteria are not exactly the rubric's is
 * refused (`failure.stage: "judge"`, `score: null`), never read as a grade.
 */
export interface QualityCell {
  task_id: string;
  placeholder: boolean;
  harness: BenchmarkHarness;
  /** 1-based, of `methodology.quality_reps`. */
  rep: number;
  model_requested: string;
  /** The judge model the eval task reports it used. */
  judge_model: string;
  /** The eval's weighted score, 0..1. */
  score: number | null;
  criteria: CriterionGrade[];
  reasoning: string;
  subject: string;
  files_changed: FileChangeFact[];
  checks: QualityCheck[];
  turns: BenchmarkSample[];
  workflow_execution_id: string;
  outcome: SampleOutcome;
  failure?: SampleFailure;
}

/** A task's grades on one harness, summarised: the median over the graded attempts. */
export interface QualitySummary {
  task_id: string;
  harness: BenchmarkHarness;
  graded: number;
  failed: number;
  median_score: number | null;
}

export interface RefusedCell {
  cell: string;
  reason: RefusalReason;
}

export interface BenchmarkReport {
  schema_version: typeof BENCHMARK_REPORT_SCHEMA_VERSION;
  /** ISO 8601, UTC. */
  timestamp: string;
  git: {
    /** The measuring checkout's HEAD, `-dirty` when the tree had changes. */
    head_sha: string;
    /** The merge base with main: the SHA a readout cites. */
    main_sha: string;
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
  };
  models: { parity_native: string; parity_cursor: string; judge_requested: string };
  comparisons: BenchmarkComparison[];
  quality: QualityCell[];
  quality_summary: QualitySummary[];
  refused: RefusedCell[];
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

/** Per task and harness, in first-seen order: the graded count, the failed count and the median score. */
export function summarizeQuality(cells: readonly QualityCell[]): QualitySummary[] {
  const byKey = new Map<string, { task_id: string; harness: BenchmarkHarness; scores: number[]; failed: number }>();
  for (const cell of cells) {
    const key = `${cell.task_id}|${cell.harness}`;
    const entry = byKey.get(key) ?? { task_id: cell.task_id, harness: cell.harness, scores: [], failed: 0 };
    if (cell.outcome === "completed" && cell.score !== null) entry.scores.push(cell.score);
    else entry.failed += 1;
    byKey.set(key, entry);
  }
  return [...byKey.values()].map((entry) => ({
    task_id: entry.task_id,
    harness: entry.harness,
    graded: entry.scores.length,
    failed: entry.failed,
    median_score: median(entry.scores),
  }));
}

/** Native warm median cost over cursor's; `undefined` when either side has no median or cursor's cost is 0. */
export function costRatio(native: BenchmarkStat | undefined, cursor: BenchmarkStat | undefined): number | undefined {
  if (native?.median === null || native?.median === undefined) return undefined;
  if (cursor?.median === null || cursor?.median === undefined) return undefined;
  if (cursor.median.estimated_cost_micros === 0) return undefined;
  return native.median.estimated_cost_micros / cursor.median.estimated_cost_micros;
}

// ─── The reader ─────────────────────────────────────────────────────────────

/**
 * Refuses, by naming the field, a body that is not a v2 benchmark report. It
 * checks the discriminating fields and the shape every consumer walks
 * (`comparisons[].{native,cursor}.median`, `git.main_sha`, `methodology.reps`)
 * and trusts the rest to the producer: a full structural check would be a
 * second copy of the types above.
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
  const methodology = asRecord(root["methodology"], "report.methodology");
  requireNumber(methodology, "reps", "report.methodology");
  requireNumber(methodology, "quality_reps", "report.methodology");
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
  if (!Array.isArray(root["quality"])) throw new Error("not a benchmark report: quality is not an array");
  if (!Array.isArray(root["quality_summary"])) throw new Error("not a benchmark report: quality_summary is not an array");
  if (!Array.isArray(root["refused"])) throw new Error("not a benchmark report: refused is not an array");
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

function describe(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}
