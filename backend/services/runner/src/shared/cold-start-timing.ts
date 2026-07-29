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
