// Reads the runner's `stigmer_timing` lines out of its tee'd log: the
// `turn_phases` line the turn runtime writes at settle for every harness and
// the `execution_setup` line each adapter writes when its engine is ready.
// Domain: conformance benchmark (the runner-clock axes).
//
// The line is one JSON object per stdout line with a string `stigmer_timing`
// field naming the event, the emitter's context beside it, `total_ms` and
// `segments[]` (runner shared/cold-start-timing.ts `emitTimingLog`). Every
// other line of the log — the Temporal SDK's five-line objects, prose, a
// torn last line still being flushed — is skipped, never a failure: the
// reader's caller re-reads the file until the line it wants is present.
// Both lines are kept WHOLE on the sample, segments included, because the
// warm-session work reads `execution_setup`'s segments on turn 2 of a
// session, and the axes are derived from them here so the derivation has one
// home.
import { readFile } from "node:fs/promises";
import { pollUntil } from "../support/execution-poll";
import type { BenchmarkAxes, TimingLine, TimingSegment } from "./report";

export const TURN_PHASES_EVENT = "turn_phases";
export const EXECUTION_SETUP_EVENT = "execution_setup";

// How long a reader waits for an execution's `turn_phases` line to land in
// the tee'd file after the execution turned terminal. The line is written at
// settle, before the terminal persist, but the tee's file write trails the
// runner's stdout; five seconds is generous against a loaded host and short
// against the cost of a whole sample.
export const TIMING_LINE_WAIT_MS = 5_000;

/**
 * Re-reads the log on the poll core's rhythm until the execution's
 * `turn_phases` line is present, then returns both of its lines. On timeout
 * it returns whatever was there (the missing line reads as `null` on the
 * sample, the fact rather than a failure), because a turn that settled
 * during resolution writes no line at all and that is a finding, not a bug.
 */
export async function awaitTimingLines(logFile: string, executionId: string): Promise<ExecutionTiming> {
  try {
    return await pollUntil(
      async () => timingFor(parseTimingLines(await readFile(logFile, "utf8")), executionId),
      (timing) => timing.turn_phases !== null,
      () => `no turn_phases line for ${executionId} in ${logFile} within ${TIMING_LINE_WAIT_MS}ms`,
      { timeoutMs: TIMING_LINE_WAIT_MS },
    );
  } catch {
    return timingFor(parseTimingLines(await readFile(logFile, "utf8")), executionId);
  }
}

/** Every `stigmer_timing` line in the text, in order; anything else is skipped. */
export function parseTimingLines(text: string): TimingLine[] {
  const lines: TimingLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{") || !trimmed.includes('"stigmer_timing"')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const line = asTimingLine(parsed);
    if (line !== undefined) lines.push(line);
  }
  return lines;
}

export interface ExecutionTiming {
  turn_phases: TimingLine | null;
  execution_setup: TimingLine | null;
}

/** The two lines of one execution, by its `execution_id`; `null` for a line not (yet) present. */
export function timingFor(lines: readonly TimingLine[], executionId: string): ExecutionTiming {
  const ofExecution = lines.filter((line) => line.context["execution_id"] === executionId);
  return {
    turn_phases: ofExecution.find((line) => line.event === TURN_PHASES_EVENT) ?? null,
    execution_setup: ofExecution.find((line) => line.event === EXECUTION_SETUP_EVENT) ?? null,
  };
}

/** The runner-clock axes the two lines carry; each `null` when its line or field is absent. */
export function axesFromTiming(
  timing: ExecutionTiming,
): Pick<
  BenchmarkAxes,
  "runner_first_visible_token_ms" | "runner_first_text_ms" | "execution_setup_ms" | "turn_total_ms" | "max_gap_ms" | "rounds" | "tool_calls"
> {
  const phases = timing.turn_phases;
  return {
    runner_first_visible_token_ms: numberField(phases, "first_visible_token_ms"),
    runner_first_text_ms: numberField(phases, "first_text_ms"),
    execution_setup_ms: timing.execution_setup?.total_ms ?? null,
    turn_total_ms: phases?.total_ms ?? null,
    max_gap_ms: numberField(phases, "max_gap_ms"),
    rounds: numberField(phases, "rounds"),
    tool_calls: numberField(phases, "tool_calls"),
  };
}

function numberField(line: TimingLine | null, key: string): number | null {
  const value = line?.context[key];
  return typeof value === "number" ? value : null;
}

function asTimingLine(value: unknown): TimingLine | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const event = record["stigmer_timing"];
  const totalMs = record["total_ms"];
  const segments = record["segments"];
  if (typeof event !== "string" || typeof totalMs !== "number" || !Array.isArray(segments)) return undefined;
  const context: TimingLine["context"] = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key === "stigmer_timing" || key === "total_ms" || key === "segments") continue;
    if (entry === null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      context[key] = entry;
    }
  }
  return {
    event,
    context,
    total_ms: totalMs,
    segments: segments.flatMap((segment) => {
      const parsed = asSegment(segment);
      return parsed === undefined ? [] : [parsed];
    }),
  };
}

function asSegment(value: unknown): TimingSegment | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const name = record["name"];
  const startMs = record["start_ms"];
  const durationMs = record["duration_ms"];
  if (typeof name !== "string" || typeof startMs !== "number" || typeof durationMs !== "number") return undefined;
  return { name, start_ms: startMs, duration_ms: durationMs };
}
