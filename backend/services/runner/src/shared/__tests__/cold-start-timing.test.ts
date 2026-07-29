/**
 * Unit tests for the cold-start timing instrumentation.
 *
 * The warm-agent-surfaces baseline report derives its waterfall from these
 * emissions, so the invariants pinned here are load-bearing for a spend
 * decision: segments must partition the timeline (total == sum, no gaps),
 * the emitted line must keep its stable shape (`stigmer_timing` selector,
 * context spread, `segments` with per-segment `start_ms`/`duration_ms`),
 * and the process-boot timeline must emit exactly once — a worker restart
 * inside one process must never produce a bogus second timeline.
 *
 * The boot singleton is module-level state, so those tests re-import the
 * module fresh via `vi.resetModules()` to get an unlatched instance.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { TimingRecorder, emitTimingLog } from "../cold-start-timing.js";

/** Parse the single JSON line the mocked console.log captured. */
function loggedJson(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  expect(spy).toHaveBeenCalledTimes(1);
  return JSON.parse(spy.mock.calls[0]![0] as string);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TimingRecorder", () => {
  it("partitions the timeline: total equals the sum of segment durations", () => {
    const recorder = new TimingRecorder();
    recorder.mark("first");
    recorder.mark("second");
    recorder.mark("third");

    const segments = recorder.snapshot();
    expect(segments.map((s) => s.name)).toEqual(["first", "second", "third"]);

    const sum = segments.reduce((acc, s) => acc + s.durationMs, 0);
    // Each value is independently rounded to 0.1ms, so allow rounding drift.
    expect(Math.abs(recorder.totalMs() - sum)).toBeLessThanOrEqual(
      0.05 * (segments.length + 1),
    );
  });

  it("leaves no gaps: each segment starts where the previous one ended", () => {
    const recorder = new TimingRecorder();
    recorder.mark("a");
    recorder.mark("b");
    recorder.mark("c");

    const segments = recorder.snapshot();
    for (let i = 1; i < segments.length; i++) {
      const previousEnd = segments[i - 1]!.startMs + segments[i - 1]!.durationMs;
      expect(Math.abs(segments[i]!.startMs - previousEnd)).toBeLessThanOrEqual(0.11);
    }
    expect(segments[0]!.startMs).toBe(0);
  });

  it("measures offsets from an explicit origin (the process-boot case)", () => {
    const recorder = new TimingRecorder(0);
    recorder.mark("node_start");
    // Origin 0 means the first segment's duration covers everything since
    // process start — it must be a real, positive elapsed time.
    expect(recorder.snapshot()[0]!.durationMs).toBeGreaterThan(0);
    expect(recorder.totalMs()).toBeGreaterThan(0);
  });

  it("reports zero total before any mark", () => {
    expect(new TimingRecorder().totalMs()).toBe(0);
    expect(new TimingRecorder().snapshot()).toHaveLength(0);
  });
});

describe("emitTimingLog", () => {
  it("emits one line with the stable shape the baseline report parses", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const recorder = new TimingRecorder();
    recorder.mark("only_segment");

    emitTimingLog("execution_setup", {
      execution_id: "exe_123",
      session_id: "ses_456",
      harness: "cursor",
      skipped: undefined,
      nullable: null,
    }, recorder);

    const line = loggedJson(spy);
    expect(line.stigmer_timing).toBe("execution_setup");
    expect(line.execution_id).toBe("exe_123");
    expect(line.session_id).toBe("ses_456");
    // undefined context values are dropped by JSON.stringify; null survives.
    expect("skipped" in line).toBe(false);
    expect(line.nullable).toBeNull();
    expect(line.total_ms).toBeTypeOf("number");

    const segments = line.segments as Array<Record<string, unknown>>;
    expect(segments).toHaveLength(1);
    expect(segments[0]!.name).toBe("only_segment");
    expect(segments[0]!.start_ms).toBeTypeOf("number");
    expect(segments[0]!.duration_ms).toBeTypeOf("number");
  });

  it("never throws, even when the payload cannot be serialized", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() =>
      // The context type forbids objects, but telemetry must survive a caller
      // getting it wrong at runtime — that is the module's stated posture.
      emitTimingLog("evt", cyclic as never, new TimingRecorder()),
    ).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("boot timeline singleton", () => {
  // Each test re-imports the module for a fresh, unlatched singleton.
  async function freshModule() {
    vi.resetModules();
    return import("../cold-start-timing.js");
  }

  it("emits runner_boot exactly once; later emits are no-ops", async () => {
    const mod = await freshModule();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    mod.markBoot("config_loaded");
    mod.emitRunnerBootTiming({ task_queue: "session:ses_1", mode: "cloud" });
    mod.emitRunnerBootTiming({ task_queue: "session:ses_1", mode: "cloud" });

    const line = loggedJson(spy);
    expect(line.stigmer_timing).toBe("runner_boot");
    expect(line.task_queue).toBe("session:ses_1");
  });

  it("ignores marks after the boot timeline has emitted", async () => {
    const mod = await freshModule();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    mod.markBoot("config_loaded");
    mod.markBoot("worker_polling");
    mod.emitRunnerBootTiming({ mode: "cloud" });
    mod.markBoot("late_mark_must_not_appear");

    const line = loggedJson(spy);
    const names = (line.segments as Array<{ name: string }>).map((s) => s.name);
    expect(names).toEqual(["config_loaded", "worker_polling"]);
  });

  it("closes the timeline at the final mark: total covers every named span", async () => {
    const mod = await freshModule();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    mod.markBoot("worker_created");
    await new Promise((resolve) => setTimeout(resolve, 5));
    mod.markBoot("worker_polling");
    mod.emitRunnerBootTiming({ mode: "cloud" });

    const line = loggedJson(spy);
    const segments = line.segments as Array<{ name: string; duration_ms: number }>;
    const last = segments[segments.length - 1]!;
    // The regression this pins: without a final mark before emit, the
    // worker_created → polling span would vanish from total_ms entirely.
    expect(last.name).toBe("worker_polling");
    expect(last.duration_ms).toBeGreaterThan(0);
    const sum = segments.reduce((acc, s) => acc + s.duration_ms, 0);
    expect(Math.abs((line.total_ms as number) - sum)).toBeLessThanOrEqual(
      0.05 * (segments.length + 1),
    );
  });
});
