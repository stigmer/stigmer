// Unit arms for the timing-line reader, over a log excerpt in the shape the
// runner's `emitTimingLog` writes (shared/cold-start-timing.ts) with the
// noise a real tee carries between the lines.
// Domain: conformance benchmark.
//
// Pinned: prose, an unrelated JSON object and a torn last line are skipped;
// lines are matched to an execution by `execution_id`; the axes and counts
// read the fields and segments `turn_phases`, `execution_setup` and Cursor's
// `turn_first_event` carry, and are null when a line, field or segment is
// absent (native connects MCP only when a server is attached; only Cursor
// writes a first-event line); segments survive whole.
import { describe, expect, it } from "vitest";
import { axesFromTiming, parseTimingLines, timingFor } from "../timing-lines";

const SETUP_LINE = JSON.stringify({
  stigmer_timing: "execution_setup",
  execution_id: "aex_1",
  session_id: "ses_1",
  harness: "native",
  mcp_server_count: 1,
  skill_count: 8,
  workspace_entry_count: 1,
  total_ms: 812.4,
  segments: [
    { name: "resolve_artifact_storage", start_ms: 0, duration_ms: 3.1 },
    { name: "create_checkpointer", start_ms: 3.1, duration_ms: 40.2 },
    { name: "connect_mcp", start_ms: 43.3, duration_ms: 212.6 },
    { name: "create_agent_graph", start_ms: 255.9, duration_ms: 556.5 },
  ],
});

const PHASES_LINE = JSON.stringify({
  stigmer_timing: "turn_phases",
  execution_id: "aex_1",
  session_id: "ses_1",
  turn_seq: 1,
  harness: "deep-agent",
  outcome: "completed",
  first_event_ms: 1200.5,
  first_visible_token_ms: 2100.2,
  first_text_ms: 2100.2,
  rounds: 1,
  tool_calls: 3,
  sub_agents: 1,
  max_gap_ms: 1200.5,
  total_ms: 3400.9,
  segments: [{ name: "model_round", start_ms: 1200.5, duration_ms: 2200.4 }],
});

const CURSOR_SETUP_LINE = JSON.stringify({
  stigmer_timing: "execution_setup",
  execution_id: "aex_c",
  harness: "cursor",
  mcp_server_count: 1,
  skill_count: 8,
  workspace_entry_count: 1,
  total_ms: 1500,
  segments: [{ name: "resolve_agent", start_ms: 0, duration_ms: 1500 }],
});

const CURSOR_FIRST_EVENT_LINE = JSON.stringify({
  stigmer_timing: "turn_first_event",
  execution_id: "aex_c",
  harness: "cursor",
  agent_resumed: false,
  mcp_server_count: 1,
  total_ms: 3100,
  segments: [
    { name: "send_returned", start_ms: 0, duration_ms: 2400 },
    { name: "first_delta", start_ms: 2400, duration_ms: 700 },
  ],
});

const OTHER_EXECUTION = JSON.stringify({
  stigmer_timing: "turn_phases",
  execution_id: "aex_2",
  total_ms: 1,
  segments: [],
});

const LOG = [
  "Worker ready, polling for tasks",
  '{"level":"INFO","label":"TemporalWorker","message":"Worker state changed"}',
  SETUP_LINE,
  "ExecuteDeepAgent model resolved: execution=aex_1",
  PHASES_LINE,
  CURSOR_SETUP_LINE,
  CURSOR_FIRST_EVENT_LINE,
  OTHER_EXECUTION,
  '{"stigmer_timing":"turn_phases","execution_id":"aex_3","tot',
].join("\n");

describe("parseTimingLines", () => {
  it("keeps every stigmer_timing line and skips prose, other JSON and a torn line", () => {
    const lines = parseTimingLines(LOG);
    expect(lines.map((line) => `${line.event}:${String(line.context["execution_id"])}`)).toEqual([
      "execution_setup:aex_1",
      "turn_phases:aex_1",
      "execution_setup:aex_c",
      "turn_first_event:aex_c",
      "turn_phases:aex_2",
    ]);
  });

  it("keeps the segments whole", () => {
    const setup = parseTimingLines(SETUP_LINE)[0]!;
    expect(setup.segments).toHaveLength(4);
    expect(setup.segments[1]).toEqual({ name: "create_checkpointer", start_ms: 3.1, duration_ms: 40.2 });
  });
});

describe("timingFor and axesFromTiming", () => {
  it("joins the lines of one execution by execution_id and derives the runner axes and counts", () => {
    const timing = timingFor(parseTimingLines(LOG), "aex_1");
    expect(timing.execution_setup?.total_ms).toBe(812.4);
    expect(timing.turn_phases?.context["harness"]).toBe("deep-agent");
    expect(axesFromTiming(timing)).toEqual({
      runner_first_visible_token_ms: 2100.2,
      runner_first_text_ms: 2100.2,
      execution_setup_ms: 812.4,
      turn_total_ms: 3400.9,
      max_gap_ms: 1200.5,
      rounds: 1,
      tool_calls: 3,
      sub_agent_calls: 1,
      mcp_connect_ms: 212.6,
      cursor_send_returned_ms: null,
      mcp_server_count: 1,
      skill_count: 8,
      workspace_entry_count: 1,
    });
  });

  it("reads Cursor's send window off its first-event line, and no MCP connect segment off its setup", () => {
    const axes = axesFromTiming(timingFor(parseTimingLines(LOG), "aex_c"));
    expect(axes.cursor_send_returned_ms).toBe(2400);
    expect(axes.mcp_connect_ms).toBeNull();
    expect(axes.mcp_server_count).toBe(1);
  });

  it("reads null, never zero, for an execution whose lines are not present yet", () => {
    const timing = timingFor(parseTimingLines(LOG), "aex_missing");
    expect(timing).toEqual({ turn_phases: null, execution_setup: null, turn_first_event: null });
    expect(axesFromTiming(timing).runner_first_visible_token_ms).toBeNull();
    expect(axesFromTiming(timing).execution_setup_ms).toBeNull();
  });
});
