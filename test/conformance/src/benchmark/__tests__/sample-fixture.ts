// A hand-built benchmark sample for the unit arms: every field present and
// plausible, so a test overrides only what it is about and the rest of the
// contract stays satisfied.
// Domain: conformance benchmark (test support).
import type { BenchmarkAxes, BenchmarkMeasures, BenchmarkSample, SampleOutcome } from "../report";

export const NULL_AXES: BenchmarkAxes = {
  end_to_end_ms: null,
  client_first_visible_token_ms: null,
  client_first_text_ms: null,
  before_activity_ms: null,
  ensure_thread_ms: null,
  runner_first_visible_token_ms: null,
  runner_first_text_ms: null,
  execution_setup_ms: null,
  turn_total_ms: null,
  max_gap_ms: null,
  rounds: null,
  tool_calls: null,
};

export function makeMeasures(overrides: Partial<BenchmarkMeasures> = {}): BenchmarkMeasures {
  return {
    ...NULL_AXES,
    end_to_end_ms: 1000,
    client_first_visible_token_ms: 400,
    client_first_text_ms: 400,
    rounds: 1,
    tool_calls: 0,
    estimated_cost_micros: 3000,
    tokens: { input: 1000, output: 20, cache_read: 900, cache_write: 0, total: 1020 },
    ...overrides,
  };
}

export function makeSample(
  overrides: Partial<Omit<BenchmarkSample, "measures">> & { measures?: Partial<BenchmarkMeasures>; outcome?: SampleOutcome } = {},
): BenchmarkSample {
  const { measures, ...rest } = overrides;
  return {
    execution_id: "aex_test",
    session_id: "ses_test",
    model_requested: "claude-sonnet-4.6",
    model_reported: "claude-sonnet-4-6",
    measures: makeMeasures(measures),
    cost_source: "runner-rate-card-estimate",
    server: { created_at: "2026-09-19T00:00:00Z", started_at: "2026-09-19T00:00:00Z", completed_at: "2026-09-19T00:00:01Z" },
    timing: { turn_phases: null, execution_setup: null },
    outcome: "completed",
    ...rest,
  };
}
