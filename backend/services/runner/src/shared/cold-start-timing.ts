/**
 * Cold-start timing instrumentation.
 *
 * Measures the two previously unmeasured segments of the user-perceived cold
 * start (warm-agent-surfaces Phase 0): the runner PROCESS BOOT (Node start →
 * worker polling its Temporal queue) and PER-EXECUTION SETUP (activity start →
 * agent ready to stream), broken down by named phase.
 *
 * Emission is a single structured JSON log line per timeline (selector field
 * `stigmer_timing`), joined to control-plane timestamps by `execution_id`.
 * Deliberately logs, not proto/status payloads: the status-update path is
 * size-guarded and UI-coupled, and Temporal history must never carry
 * telemetry. Cluster logging picks these lines up as-is.
 *
 * Failure posture: instrumentation must never affect an execution. All
 * emission is wrapped; recorders are plain arithmetic and cannot throw in
 * practice, but callers still treat every function here as best-effort.
 */

// Static on purpose: the registry module is itself lazy (it dynamic-imports
// @opentelemetry/api inside getInstruments), so this adds nothing to boot,
// while per-call dynamic imports raced under concurrent emissions.
import { getInstruments } from "../otel-metrics.js";

/** One closed segment on a timeline: [startMs, startMs + durationMs). */
export interface TimingSegment {
  readonly name: string;
  /** Offset from the recorder's origin when this segment began (ms). */
  readonly startMs: number;
  readonly durationMs: number;
}

/**
 * Records a linear sequence of named segments.
 *
 * `mark(name)` closes the span from the previous mark (or the origin) and
 * names it — so instrumentation reads as one line placed AFTER the work it
 * measures, mirroring the existing `reportSetupProgress` phase idiom:
 *
 * ```ts
 * const timing = new TimingRecorder();
 * const execution = await client.getExecution(executionId);
 * timing.mark("fetch_execution");
 * ```
 */
export class TimingRecorder {
  private readonly originMs: number;
  private readonly segments: TimingSegment[] = [];
  private lastMarkMs: number;

  /**
   * @param originMs absolute `performance.now()`-scale origin. Defaults to
   *   "now" (per-execution timelines). Pass 0 for a process-lifetime timeline
   *   whose offsets are milliseconds since Node start (`performance.now()`
   *   is measured from `performance.timeOrigin`, i.e. process start).
   */
  constructor(originMs: number = performance.now()) {
    this.originMs = originMs;
    this.lastMarkMs = originMs;
  }

  /** Close the span since the previous mark (or origin) and name it. */
  mark(name: string): void {
    const now = performance.now();
    this.segments.push({
      name,
      startMs: round1(this.lastMarkMs - this.originMs),
      durationMs: round1(now - this.lastMarkMs),
    });
    this.lastMarkMs = now;
  }

  /** Total elapsed time from the origin to the latest mark (ms). */
  totalMs(): number {
    return round1(this.lastMarkMs - this.originMs);
  }

  snapshot(): readonly TimingSegment[] {
    return this.segments;
  }
}

/**
 * Emit one timeline as a single structured log line.
 *
 * Shape (stable — the baseline report and log-based metrics query it):
 * `{"stigmer_timing":"<event>", ...context, "total_ms":N, "segments":[{"name","start_ms","duration_ms"}]}`
 *
 * Each timeline's total is additionally mirrored onto its OTel histogram
 * (see {@link recordTimingMetric}): the stdout line stays the source of
 * truth for per-segment forensics (it is the only place segments exist —
 * cluster workload logs are not ingested anywhere queryable), while the
 * histogram gives dashboards the aggregate without scraping pods.
 */
export function emitTimingLog(
  event: string,
  context: Record<string, string | number | boolean | null | undefined>,
  recorder: TimingRecorder,
): void {
  try {
    console.log(JSON.stringify({
      stigmer_timing: event,
      ...context,
      total_ms: recorder.totalMs(),
      segments: recorder.snapshot().map((s) => ({
        name: s.name,
        start_ms: s.startMs,
        duration_ms: s.durationMs,
      })),
    }));
  } catch {
    // Telemetry must never break the runner.
  }
  recordTimingMetric(event, context, recorder.totalMs());
}

/**
 * Mirror a timeline's total onto its OTel histogram, fire-and-forget.
 *
 * Attributes are a per-event WHITELIST (`mode`, `harness`) — never ids or
 * per-pod values. Unbounded attribute values multiply time series without
 * limit (the JVM JFR thread_name incident, 2026-07-29: 5k+ series in
 * 15 minutes), so new attributes here require the same closed-set argument
 * these two carry. Events without a mapped instrument are control-plane
 * timelines or future additions and are deliberately not recorded.
 *
 * Exported for tests; production callers go through {@link emitTimingLog}.
 */
export function recordTimingMetric(
  event: string,
  context: Record<string, string | number | boolean | null | undefined>,
  totalMs: number,
): void {
  void (async () => {
    const instruments = await getInstruments();
    switch (event) {
      case "runner_boot":
        instruments.runnerBootDuration.record(totalMs, pickAttrs(context, "mode"));
        break;
      case "execution_setup":
        instruments.executionSetupDuration.record(totalMs, pickAttrs(context, "harness"));
        break;
      case "pool_attach":
        instruments.poolAttachDuration.record(totalMs);
        break;
      default:
        break;
    }
  })().catch(() => {
    // Telemetry must never break the runner.
  });
}

/** Copy only the whitelisted string-valued keys into metric attributes. */
function pickAttrs(
  context: Record<string, string | number | boolean | null | undefined>,
  ...keys: string[]
): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const key of keys) {
    const value = context[key];
    if (typeof value === "string" && value.length > 0) {
      attrs[key] = value;
    }
  }
  return attrs;
}

// ─── Process boot timeline ───────────────────────────────────────────────────

// Origin 0 = process start, so the implicit first segment (everything before
// the first markBoot call) covers Node startup + entrypoint module loading.
const bootRecorder = new TimingRecorder(0);
let bootEmitted = false;

/** Record a boot milestone (closes the span since the previous milestone). */
export function markBoot(name: string): void {
  if (bootEmitted) return;
  bootRecorder.mark(name);
}

/**
 * Emit the boot timeline once — called when the worker starts polling, the
 * moment the sandbox can actually receive work. Later calls are no-ops so
 * worker restarts within one process never emit a bogus second timeline.
 */
export function emitRunnerBootTiming(
  context: Record<string, string | number | boolean | null | undefined>,
): void {
  if (bootEmitted) return;
  bootEmitted = true;
  emitTimingLog("runner_boot", context, bootRecorder);
}

function round1(ms: number): number {
  return Math.round(ms * 10) / 10;
}
