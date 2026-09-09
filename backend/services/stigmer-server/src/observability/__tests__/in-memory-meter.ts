/**
 * A REAL OTel MeterProvider backed by an in-memory exporter, for suites
 * that pin an instrument registry's names, label vocabulary and zero
 * baselines — what the SigNoz rules key on. The registries are lazy and
 * memoized on the GLOBAL meter provider (rpc-metrics.ts), so the helper
 * installs the provider globally and takes the registry's reset seam to
 * clear the memo before and after; a registry created against an earlier
 * provider would otherwise keep recording into it.
 *
 * Collection is manual (`collect()` forces a flush) and the export interval
 * is set far out so nothing races the test. Recorders are fire-and-forget
 * over a dynamic import; callers poll `collect()` with a deadline (`until`)
 * rather than sleeping — the determinism rule.
 *
 * The cloud composition's `src/observability/__tests__/in-memory-meter.ts`
 * (stigmer-cloud `694b6a57e`) is this file's source; the two registries it
 * serves there and the one here share the idiom on purpose.
 */

export interface CollectedPoint {
  readonly value: unknown;
  readonly attributes: Record<string, unknown>;
}

/** Metric name → its data points at the last collection. */
export type CollectedMetrics = Map<string, CollectedPoint[]>;

export interface InMemoryMeter {
  /** Flushes the provider and returns every exported metric by name. */
  collect(): Promise<CollectedMetrics>;
  /** Shuts the provider down, disables the global API and clears the registry memo. */
  dispose(): Promise<void>;
}

/**
 * @param resetInstruments the registry's test seam (`resetRpcInstruments`),
 *   invoked after the provider is installed and again on dispose so no
 *   memoized meter outlives this provider.
 */
export async function inMemoryMeter(
  resetInstruments: () => void,
): Promise<InMemoryMeter> {
  const {
    AggregationTemporality,
    InMemoryMetricExporter,
    MeterProvider,
    PeriodicExportingMetricReader,
  } = await import("@opentelemetry/sdk-metrics");
  const api = await import("@opentelemetry/api");
  const exporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const reader = new PeriodicExportingMetricReader({
    exporter,
    // Effectively manual: collection happens on forceFlush in collect().
    exportIntervalMillis: 3_600_000,
  });
  const provider = new MeterProvider({ readers: [reader] });
  api.metrics.setGlobalMeterProvider(provider);
  resetInstruments();
  return {
    async collect() {
      await provider.forceFlush();
      const byName: CollectedMetrics = new Map();
      for (const resource of exporter.getMetrics()) {
        for (const scope of resource.scopeMetrics) {
          for (const metric of scope.metrics) {
            byName.set(
              metric.descriptor.name,
              metric.dataPoints.map((point) => ({
                value: point.value,
                attributes: point.attributes,
              })),
            );
          }
        }
      }
      return byName;
    },
    async dispose() {
      await provider.shutdown();
      api.metrics.disable();
      resetInstruments();
    },
  };
}

/** Polls collect() until the predicate holds or the deadline (5 s) passes; returns the last collection either way. */
export async function until<T>(
  collect: () => Promise<T>,
  ready: (collected: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const collected = await collect();
    if (ready(collected) || Date.now() > deadline) {
      return collected;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
