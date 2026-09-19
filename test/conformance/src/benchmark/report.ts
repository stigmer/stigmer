// The harness benchmark report: the one contract between the producer
// (`scripts/benchmark-harnesses.ts`, over `src/benchmark/run.ts`) and its
// consumer (`site/scripts/generate-harness-cost-comparison.ts`, which curates
// a report into the docs fixture). The site script imports these types by
// relative path, so the contract has one home and a hunk here is the review
// of what the page will read differently.
// Domain: conformance benchmark (the live instrument's output).
//
// This module is a LEAF by rule: it compiles under two tsconfigs (this
// workspace's, with node types and noUncheckedIndexedAccess; the site's,
// ES2017 + dom, isolatedModules, no node types), so it imports no `node:`
// builtin, no proto stub and no schema library, carries `number` never
// `bigint`, and hand-writes its reader over `unknown`.
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
// - "Cold" is the run's FIRST call per harness and served model, not each
//   cell's first attempt: every cell of a harness sends the same prompt
//   prefix on the same served model, so the provider's prompt cache is warm
//   for every cell after the first. Each cell's first attempt is a discarded
//   `warmup`; `cold_first_call` is present on the one cell that paid the
//   cache write and `null` elsewhere.
// - Two SHAs: the repository squash-merges, so a branch HEAD alone resolves
//   on nothing after the merge. `main_sha` (the merge base with main) is what
//   the page shows; `head_sha` and the PR locate the instrument's exact bytes.
// - Every latency axis names its clock in the type's comment. The client
//   axes start at the create call; the Temporal axes are on Temporal's clock;
//   the runner axes are on the runner's own origin (the activity's start).

export const BENCHMARK_REPORT_SCHEMA_VERSION = 2;

/** The runtime's harness vocabulary, as the runner's `turn_phases` line labels it. */
export type BenchmarkHarness = "deep-agent" | "cursor";

export type ComparisonMode = "parity" | "default" | "turn-2";

export type SessionShape = "fresh-per-execution" | "one-session-three-turns";

export type SampleOutcome = "completed" | "failed" | "cancelled" | "timeout";

export type RefusalReason =
  | "missing ANTHROPIC_API_KEY"
  | "missing CURSOR_API_KEY"
  | "excluded by --only"
  | "excluded by --cells"
  | "model not in registry for harness";

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
  /** Temporal's clock: the EnsureThread activity's ActivityTaskScheduled to its ActivityTaskCompleted. */
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
  rounds: number | null;
  tool_calls: number | null;
}

export interface TokenCounts {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  total: number;
}

/** What a median is taken over: the axes plus the cost and token figures the page reads. */
export interface BenchmarkMeasures extends BenchmarkAxes {
  estimated_cost_micros: number;
  tokens: TokenCounts;
}

export interface SiblingTurn {
  turn_seq: number;
  execution_id: string;
  measures: BenchmarkMeasures;
  timing: SampleTiming;
  outcome: SampleOutcome;
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
  outcome: SampleOutcome;
  /** A turn-2 sample keeps its session's first and third turns here. */
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
  /** One prompt for a first-turn cell, three for a turn-2 cell. */
  prompts: string[];
  mode: ComparisonMode;
  session_shape: SessionShape;
  native?: BenchmarkStat;
  cursor?: BenchmarkStat;
  /** Warm median cost, native over cursor; absent when a side is. */
  cost_ratio?: number;
}

export interface QualityCell {
  task_id: string;
  placeholder: boolean;
  harness: BenchmarkHarness;
  model_requested: string;
  /** The judge model the eval task reports it used. */
  judge_model: string;
  score: number | null;
  reasoning: string;
  workflow_execution_id: string;
  agent_execution_id: string;
  outcome: SampleOutcome;
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
    /** The merge base with main: the SHA the page shows. */
    main_sha: string;
    pr?: number;
  };
  host: { platform: string; node: string };
  methodology: {
    reps: number;
    warmup_discarded: true;
    cold: "first-call-of-run-per-harness-and-model";
    titling_suppressed: boolean;
  };
  models: { parity_native: string; parity_cursor: string; judge_requested: string };
  comparisons: BenchmarkComparison[];
  quality: QualityCell[];
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
  const comparisons = root["comparisons"];
  if (!Array.isArray(comparisons)) throw new Error("not a benchmark report: comparisons is not an array");
  comparisons.forEach((entry, index) => {
    const comparison = asRecord(entry, `report.comparisons[${index}]`);
    requireString(comparison, "scenario", `report.comparisons[${index}]`);
    requireString(comparison, "mode", `report.comparisons[${index}]`);
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
