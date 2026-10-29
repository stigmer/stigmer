/**
 * `TurnTimeline` (`harness/turn-timeline.ts`), driven with `TranscriptEvent`s
 * on a scripted clock — one arm per rule the module's header lists, in the
 * order it lists them, plus the shape of the `turn_phases` line it writes.
 *
 * What these arms protect: the parity comparison reads this line for both
 * harnesses, so a rule that quietly favoured one (a sub-agent's token
 * counted as the user's first visible token) would bias a published number. Every
 * instant here is asserted exactly, which the scripted clock makes possible;
 * the hermetic proofs under each adapter assert structure only.
 *
 * Fence-clean: names the runtime's timing primitive and the transcript's
 * union, nothing of any engine.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { TURN_PHASES_EVENT, TurnTimeline, type TurnTimelineClock } from "../turn-timeline.js";
import type { TranscriptEvent } from "../transcript/events.js";

/** A clock the test advances by hand. `performance.now()` scale starts at the origin 10_000. */
const ORIGIN_MS = 10_000;

class ScriptedClock implements TurnTimelineClock {
  readonly originMs = ORIGIN_MS;
  private nowMs = ORIGIN_MS;

  readonly now = (): number => this.nowMs;

  /** Move the clock to `offset` ms after the origin. */
  at(offset: number): void {
    this.nowMs = ORIGIN_MS + offset;
  }
}


interface EmittedLine {
  readonly stigmer_timing: string;
  readonly total_ms: number;
  readonly segments: Array<{ name: string; start_ms: number; duration_ms: number }>;
  readonly [key: string]: unknown;
}

/** Drive `steps` (an offset and the event to observe at it), emit, and parse the one line. */
function run(steps: Array<[number, TranscriptEvent]>, settleAt: number, context: Record<string, string | number> = {}): EmittedLine {
  const clock = new ScriptedClock();
  const timeline = new TurnTimeline(clock);
  for (const [offset, event] of steps) {
    clock.at(offset);
    timeline.observe(event);
  }
  clock.at(settleAt);
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  timeline.emit(context);
  expect(spy).toHaveBeenCalledTimes(1);
  return JSON.parse(spy.mock.calls[0]![0] as string) as EmittedLine;
}

function segment(line: EmittedLine, name: string) {
  const found = line.segments.filter((s) => s.name === name);
  expect(found, `one segment named ${name}`).toHaveLength(1);
  return found[0]!;
}

const START: TranscriptEvent = { kind: "message_start", runId: "r1" };
const TEXT: TranscriptEvent = { kind: "text_delta", runId: "r1", text: "hi" };
const THINK: TranscriptEvent = { kind: "reasoning_delta", runId: "r1", text: "hmm" };
const FINISH: TranscriptEvent = { kind: "message_finish", runId: "r1" };
const TOOL_START: TranscriptEvent = { kind: "tool_started", callId: "c1", name: "read_file", input: { path: "a" }, mcpServerSlug: "" };
const TOOL_DONE: TranscriptEvent = { kind: "tool_finished", callId: "c1", result: "ok" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TurnTimeline — the three root instants", () => {
  it("first_event is the first event of any kind; visible and text follow the first text delta", () => {
    const line = run([[100, START], [250, TEXT], [400, FINISH]], 500);
    expect(line.first_event_ms).toBe(100);
    expect(line.first_visible_token_ms).toBe(250);
    expect(line.first_text_ms).toBe(250);
  });

  it("a reasoning delta is visible but not text: thinking on moves the two instants apart", () => {
    const line = run([[100, START], [180, THINK], [420, TEXT]], 500);
    expect(line.first_visible_token_ms).toBe(180);
    expect(line.first_text_ms).toBe(420);
  });

  it("a sub-agent's tokens set no root instant: the user watches the thread, not the sub-agent's row", () => {
    const sub: TranscriptEvent[] = [
      { kind: "sub_agent_started", subAgentId: "s1", name: "researcher", subject: "look", input: "look" },
      { kind: "message_start", runId: "sr", subAgentId: "s1" },
      { kind: "text_delta", runId: "sr", text: "reading", subAgentId: "s1" },
    ];
    const line = run([[50, sub[0]!], [60, sub[1]!], [70, sub[2]!], [900, TEXT]], 1000);
    expect(line.first_event_ms).toBe(50);
    expect(line.first_visible_token_ms).toBe(900);
    expect(line.first_text_ms).toBe(900);
  });

  it("an instant that never happened is null, and an empty turn has zero of everything", () => {
    const line = run([], 300);
    expect(line.first_event_ms).toBeNull();
    expect(line.first_visible_token_ms).toBeNull();
    expect(line.first_text_ms).toBeNull();
    expect(line.rounds).toBe(0);
    expect(line.tool_calls).toBe(0);
    expect(line.sub_agents).toBe(0);
    expect(line.max_gap_ms).toBeNull();
    expect(line.segments).toEqual([]);
    expect(line.total_ms).toBe(0);
  });
});

describe("TurnTimeline — one model_round span per runId", () => {
  it("opens on message_start and closes on message_finish; two runs are two rounds", () => {
    const line = run([
      [100, START], [300, FINISH],
      [350, { kind: "message_start", runId: "r2" }], [700, { kind: "message_finish", runId: "r2" }],
    ], 800);
    expect(line.rounds).toBe(2);
    expect(line.segments.filter((s) => s.name === "model_round").map((s) => [s.start_ms, s.duration_ms])).toEqual([[100, 200], [350, 350]]);
  });

  it("a re-emitted start for a known run keeps the first start", () => {
    const line = run([[100, START], [200, START], [300, FINISH]], 400);
    expect(segment(line, "model_round")).toEqual({ name: "model_round", start_ms: 100, duration_ms: 200 });
  });
});

describe("TurnTimeline — one tool span per callId", () => {
  it("opens on tool_started and closes on the first tool_finished; the name carries the tool", () => {
    const line = run([[100, TOOL_START], [340, TOOL_DONE]], 400);
    expect(line.tool_calls).toBe(1);
    expect(segment(line, "tool:read_file")).toEqual({ name: "tool:read_file", start_ms: 100, duration_ms: 240 });
  });

  it("an MCP tool's span names its server, so the MCP phase is legible", () => {
    const start: TranscriptEvent = { kind: "tool_started", callId: "m1", name: "search", input: {}, mcpServerSlug: "github" };
    const line = run([[100, start], [500, { kind: "tool_finished", callId: "m1", result: "" }]], 600);
    expect(segment(line, "tool:github/search").duration_ms).toBe(400);
  });

  it("a tool_error closes the span like a finish", () => {
    const line = run([[100, TOOL_START], [150, { kind: "tool_error", callId: "c1", message: "boom" }]], 200);
    expect(segment(line, "tool:read_file").duration_ms).toBe(50);
  });

  it("a second finish for a settled span changes nothing", () => {
    const line = run([[100, TOOL_START], [300, TOOL_DONE], [900, TOOL_DONE]], 1_000);
    expect(segment(line, "tool:read_file").duration_ms).toBe(200);
    expect(line.tool_calls).toBe(1);
  });

  it("a finish for a call that never started is ignored", () => {
    const line = run([[300, TOOL_DONE]], 400);
    expect(line.tool_calls).toBe(0);
    expect(line.segments).toEqual([]);
  });

  it("approval_proposed opens no span: a held call is not a tool phase", () => {
    const proposed: TranscriptEvent = { kind: "approval_proposed", callId: "g1", name: "shell", mcpServerSlug: "", message: "Run?" };
    const line = run([[100, proposed]], 200);
    expect(line.tool_calls).toBe(0);
    expect(line.first_event_ms, "it is still an event").toBe(100);
  });

  it("arg and output deltas are events for the gap but open nothing", () => {
    const line = run([
      [100, TOOL_START],
      [150, { kind: "tool_arg_delta", callId: "c1", argsChunk: "{" }],
      [200, { kind: "tool_output_delta", callId: "c1", delta: "partial" }],
      [400, TOOL_DONE],
    ], 500);
    expect(line.tool_calls).toBe(1);
    expect(line.segments).toHaveLength(1);
  });
});

describe("TurnTimeline — one sub_agent span per subAgentId", () => {
  it("opens on sub_agent_started, closes on finished or failed, named after the sub-agent", () => {
    const line = run([
      [100, { kind: "sub_agent_started", subAgentId: "s1", name: "researcher", subject: "x", input: "x" }],
      [900, { kind: "sub_agent_finished", subAgentId: "s1", output: "done" }],
      [950, { kind: "sub_agent_started", subAgentId: "s2", name: "writer", subject: "y", input: "y" }],
      [1_000, { kind: "sub_agent_failed", subAgentId: "s2", error: "no" }],
    ], 1_100);
    expect(line.sub_agents).toBe(2);
    expect(segment(line, "sub_agent:researcher").duration_ms).toBe(800);
    expect(segment(line, "sub_agent:writer").duration_ms).toBe(50);
  });
});

describe("TurnTimeline — delegated work in the counts", () => {
  it("counts a sub-agent's rounds and tool calls in the turn's, and the delegation in sub_agents", () => {
    const line = run([
      [0, START],
      [100, { kind: "sub_agent_started", subAgentId: "s1", name: "researcher", subject: "x", input: "x" }],
      [200, { kind: "message_start", runId: "sr1", subAgentId: "s1" }],
      [300, { kind: "tool_started", callId: "sc1", name: "read_file", input: { path: "a" }, mcpServerSlug: "", subAgentId: "s1" }],
      [400, { kind: "tool_finished", callId: "sc1", result: "ok", subAgentId: "s1" }],
      [500, { kind: "message_finish", runId: "sr1", subAgentId: "s1" }],
      [600, { kind: "message_start", runId: "sr2", subAgentId: "s1" }],
      [700, { kind: "message_finish", runId: "sr2", subAgentId: "s1" }],
      [800, { kind: "sub_agent_finished", subAgentId: "s1", output: "done" }],
      [900, FINISH],
    ], 1_000);
    expect(line.rounds, "the main agent's one round and the sub-agent's two").toBe(3);
    expect(line.tool_calls, "the sub-agent's call").toBe(1);
    expect(line.sub_agents).toBe(1);
  });
});

describe("TurnTimeline — background commands, waits and reminders", () => {
  it("spans each command by its starting call, from its start to its first end", () => {
    const line = run([
      [100, { kind: "background_command_started", callId: "bg_1", timeoutSeconds: 3300 }],
      [150, { kind: "background_output_delta", callId: "bg_1", delta: "ok" }],
      [700, { kind: "background_command_ended", callId: "bg_1", ending: "exited", exitCode: 0, output: "ok" }],
      [950, { kind: "background_command_ended", callId: "bg_1", ending: "stopped", stoppedBy: "turn", output: "" }],
      [960, { kind: "background_command_ended", callId: "unknown", ending: "exited", output: "" }],
    ], 1_000);
    expect(segment(line, "background_command:bg_1")).toEqual({ name: "background_command:bg_1", start_ms: 100, duration_ms: 600 });
    expect(line.background_commands).toBe(1);
    expect(line.tool_calls, "a command is no tool call").toBe(0);
  });

  it("closes a command still running at settle there, as every open span", () => {
    const line = run([[100, { kind: "background_command_started", callId: "bg_1", timeoutSeconds: 60 }]], 800);
    expect(segment(line, "background_command:bg_1").duration_ms).toBe(700);
  });

  it("spans each wait in its scope, a repeated start inside one wait changing nothing, and counts the reminders", () => {
    const line = run([
      [100, { kind: "background_reminded" }],
      [200, { kind: "background_wait_started" }],
      [250, { kind: "background_wait_started" }],
      [300, { kind: "background_wait_started", subAgentId: "s1" }],
      [500, { kind: "background_wait_finished" }],
      [550, { kind: "background_wait_finished" }],
      [600, { kind: "background_reminded", subAgentId: "s1" }],
      [700, { kind: "background_wait_started" }],
      [800, { kind: "background_wait_finished", subAgentId: "s1" }],
    ], 1_000);
    expect(line.segments.filter((s) => s.name === "background_wait")).toEqual([
      { name: "background_wait", start_ms: 200, duration_ms: 300 },
      { name: "background_wait", start_ms: 300, duration_ms: 500 },
      { name: "background_wait", start_ms: 700, duration_ms: 300 },
    ]);
    expect(line.background_reminders).toBe(2);
    expect(line.rounds, "a reminder is no round of its own").toBe(0);
  });

  it("reads zero commands and reminders on a turn that started none", () => {
    const line = run([[100, START], [200, FINISH]], 300);
    expect(line.background_commands).toBe(0);
    expect(line.background_reminders).toBe(0);
  });
});

describe("TurnTimeline — the longest silence", () => {
  it("max_gap is the largest wait between two consecutive events, of any kind", () => {
    const line = run([[100, START], [150, TEXT], [1_350, TOOL_START], [1_400, TOOL_DONE]], 1_500);
    expect(line.max_gap_ms).toBe(1_200);
  });

  it("is null under two events", () => {
    expect(run([[100, START]], 200).max_gap_ms).toBeNull();
  });
});

describe("TurnTimeline — settle and the line's shape", () => {
  it("a span still open at settle closes at settle", () => {
    const line = run([[100, START], [200, TOOL_START]], 1_000);
    expect(segment(line, "model_round")).toEqual({ name: "model_round", start_ms: 100, duration_ms: 900 });
    expect(segment(line, "tool:read_file")).toEqual({ name: "tool:read_file", start_ms: 200, duration_ms: 800 });
    expect(line.total_ms).toBe(1_000);
  });

  it("segments overlap and come out in start order; total is the latest end, not a sum", () => {
    const line = run([
      [100, START],
      [200, TOOL_START],
      [300, { kind: "sub_agent_started", subAgentId: "s1", name: "researcher", subject: "x", input: "x" }],
      [400, TOOL_DONE],
      [500, FINISH],
      [600, { kind: "message_start", runId: "r2" }],
      [700, { kind: "sub_agent_finished", subAgentId: "s1" }],
      [800, { kind: "message_finish", runId: "r2" }],
    ], 850);
    expect(line.segments.map((s) => s.name)).toEqual(["model_round", "tool:read_file", "sub_agent:researcher", "model_round"]);
    const sum = line.segments.reduce((acc, s) => acc + s.duration_ms, 0);
    expect(sum).toBeGreaterThan(line.total_ms);
    expect(line.total_ms).toBe(800);
  });

  it("writes the turn_phases selector and the runtime's context beside the fold's facts", () => {
    const line = run([[100, START], [200, TEXT], [300, FINISH]], 400, {
      execution_id: "exe_1",
      session_id: "ses_1",
      turn_seq: 2,
      harness: "stigmer",
      outcome: "completed",
    });
    expect(line.stigmer_timing).toBe(TURN_PHASES_EVENT);
    expect(line.execution_id).toBe("exe_1");
    expect(line.session_id).toBe("ses_1");
    expect(line.turn_seq).toBe(2);
    expect(line.harness).toBe("stigmer");
    expect(line.outcome).toBe("completed");
    expect(Object.keys(line).sort()).toEqual([
      "background_commands", "background_reminders", "execution_id", "first_event_ms", "first_text_ms", "first_visible_token_ms",
      "harness", "max_gap_ms", "outcome", "rounds", "segments", "session_id", "stigmer_timing", "sub_agents", "tool_calls",
      "total_ms", "turn_seq",
    ]);
  });

  it("places a relayed event at the instant it was folded, not when it arrived (the agent host's builder folds it)", () => {
    const clock = new ScriptedClock();
    const timeline = new TurnTimeline(clock);
    clock.at(900);
    timeline.observe(START, ORIGIN_MS + 100);
    timeline.observe(TEXT, ORIGIN_MS + 200);
    timeline.observe(FINISH, ORIGIN_MS + 300);
    clock.at(950);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    timeline.emit({});
    const line = JSON.parse(spy.mock.calls[0]![0] as string) as EmittedLine;

    expect(line.first_visible_token_ms).toBe(200);
    expect(segment(line, "model_round")).toEqual({ name: "model_round", start_ms: 100, duration_ms: 200 });
  });
});
