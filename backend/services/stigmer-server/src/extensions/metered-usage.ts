/**
 * The metered-usage driver point: the token counts a deployment's meter
 * recorded for each run's model calls. Single instance, registered as
 * `drivers.meteredUsageProvider`.
 *
 * Open source has no meter: the runner talks to its model directly, so the
 * only token counts are the runner's own report on the run
 * (RunStatus.streaming_usage). An edition that relays model calls through a
 * proxy records each call there (the cloud's llm_call_usage_record) and
 * answers here for the runs it metered.
 *
 * The usage reports (domain/run/usage.ts) decide each run once: the rows
 * this point returns for it when it answers for the run, else the run's own
 * runner report, marked estimated. The fallback lives in the core, once, so
 * an edition never re-implements it; absent, every run is counted from its
 * runner's report, which is true of open source and of any edition with no
 * meter.
 *
 * The contract:
 *   - One call per report, with every run the report counts. The run ids
 *     come from runs the caller is already authorized to read, so the
 *     provider applies no permission of its own.
 *   - A run the meter holds no call for is absent from the answer, never
 *     present with zero rows: absence is how the core knows to fall back
 *     (a run in flight before its first metered call, a lost report).
 *   - Token counts are bigint, as the contract's int64 fields are, so a
 *     sum past 2^53 reaches the wire exactly. The buckets are the meter's
 *     own: input excludes the cache buckets, and total is the sum of each
 *     call's provider-reported, cache-inclusive total.
 *   - A throw fails the report: a partial answer would show a metered run
 *     as an estimate with no sign that anything went wrong.
 */
import type { ProviderKeySource } from "@stigmer/apis/ai/stigmer/agentic/run/v1/usage_pb";

/** One run's metered calls for one (model, provider, harness, key source). */
export interface MeteredUsageRow {
  /** The model the provider served (the resolved model, else the requested one). */
  readonly model: string;
  /** The provider (e.g. "anthropic", "openai", "cursor"). */
  readonly provider: string;
  /** The execution harness (e.g. "native", "cursor"); empty when the record names none. */
  readonly harness: string;
  /** Whose credential served the calls; UNSPECIFIED for a record that does not say. */
  readonly providerKeySource: ProviderKeySource;
  /** Non-cached input tokens (disjoint from the cache buckets). */
  readonly inputTokens: bigint;
  readonly outputTokens: bigint;
  readonly cacheCreationInputTokens: bigint;
  readonly cacheReadInputTokens: bigint;
  readonly reasoningTokens: bigint;
  /** The sum of each call's provider-reported total (cache-inclusive). */
  readonly totalTokens: bigint;
  /** Number of metered calls in this row. */
  readonly callCount: number;
}

/** What the meter recorded for one run. */
export interface MeteredRunUsage {
  /** At least one row: a run with no metered call is absent from the answer instead. */
  readonly rows: readonly MeteredUsageRow[];
}

/** The metered-usage contract (single-instance point, ExtensionDrivers.meteredUsageProvider). */
export interface MeteredUsageProvider {
  /** The metered usage of each run in `runIds` the meter holds calls for, keyed by run id. */
  usageForRuns(
    runIds: readonly string[],
  ): Promise<ReadonlyMap<string, MeteredRunUsage>>;
}
