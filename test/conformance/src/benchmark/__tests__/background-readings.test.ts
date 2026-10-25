// Unit arms for what a sample reads of the agent's background commands, over
// a hand-built session log folded (turn-events.ts) and turn timelines.
// Domain: conformance benchmark.
//
// Pinned: starts are the shell calls that asked; endings are the log's fold,
// a stop keyed by who stopped it; "worked while running" is the model and
// tool time inside any command's span; a poll is a call starting inside a
// command's span that names that command's output file, or a `sleep`
// there, and a read of the file once the command ended is none; a call is
// never judged against the command it started, though its span opens inside
// that command's (the live order), and a background start is never a sleep; a shell call
// inside a span would have paused the turn; a lone `&` or `nohup` is the
// agent backgrounding a command itself, and `&&` or `2>&1` is not; a
// foreground timeout is read from the shell's own line; waits and reminders
// come from the timeline alone; no timeline makes every runner-clock reading
// `null`, and calls the timeline cannot place (a sub-agent ran) make every
// reading that needs a call's start `null`.
import type { JsonObject } from "@bufbuild/protobuf";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { describe, expect, it } from "vitest";
import { backgroundReadings, endingKey, shellOutputs, summarizeBackground } from "../background-readings";
import type { BackgroundReadings, TimingLine } from "../report";
import { toolCallFacts } from "../tool-call-facts";
import { makeSample } from "./sample-fixture";
import { backgroundStatus, result, subAgentThread, turnFrom, use, userMessage } from "./turn-events";

type CallInit = { name: string; args?: JsonObject; result?: string; after?: SessionEvent[] };

function turnWith(calls: CallInit[], extra: SessionEvent[] = []) {
  const events: SessionEvent[] = [userMessage("go")];
  calls.forEach((call, index) => {
    events.push(use(`c${index}`, call.name, call.args ?? {}), result(`c${index}`, call.result ?? "ok"), ...(call.after ?? []));
  });
  return turnFrom([...events, ...extra]);
}

function timeline(segments: [string, number, number][], context: TimingLine["context"] = {}): TimingLine {
  return {
    event: "turn_phases",
    context,
    total_ms: Math.max(...segments.map(([, start, end]) => end)),
    segments: segments.map(([name, start, end]) => ({ name, start_ms: start, duration_ms: end - start })),
  };
}

const OUTPUT_FILE = "/large_tool_results/background-toolu_A.log";

// One command, `toolu_A`, runs from 11 to 100: the agent reads its output
// file, sleeps and edits while it runs, waits for it, and reads the file
// again once it ended.
const SLOW_SUITE_CALLS: CallInit[] = [
  {
    name: "execute",
    args: { command: "go test ./integration", background: true },
    result: `Started in the background (id toolu_A). Its output goes to ${OUTPUT_FILE}. Do not poll it.`,
    after: [
      backgroundStatus("c0", { phase: "running" }),
      backgroundStatus("c0", { phase: "ended", ending: "exited", exitCode: 0, output: "ok  \texample.com/orders-sync/integration\t60.8s" }),
    ],
  },
  { name: "read_file", args: { file_path: OUTPUT_FILE, limit: 50 } },
  { name: "execute", args: { command: "sleep 5" } },
  { name: "edit_file", args: { file_path: "/duration/duration.go" } },
  { name: "read_file", args: { file_path: OUTPUT_FILE } },
];

const SLOW_SUITE_TIMELINE = timeline(
  [
    ["model_round", 0, 10],
    ["tool:execute", 10, 12],
    ["background_command:toolu_A", 11, 100],
    ["model_round", 12, 20],
    ["tool:read_file", 20, 22],
    ["model_round", 22, 30],
    ["tool:execute", 30, 35],
    ["tool:edit_file", 35, 40],
    ["model_round", 40, 50],
    ["background_wait", 50, 100],
    ["model_round", 100, 110],
    ["tool:read_file", 110, 112],
  ],
  { background_commands: 1, background_reminders: 1 },
);

function readingsOf(calls: CallInit[], line: TimingLine | null, extra: SessionEvent[] = []): BackgroundReadings {
  const turn = turnWith(calls, extra);
  return backgroundReadings(turn, line, toolCallFacts(turn, line));
}

describe("backgroundReadings", () => {
  it("reads a command's life, the work beside it, the polls and the wait on the runner's clock", () => {
    expect(readingsOf(SLOW_SUITE_CALLS, SLOW_SUITE_TIMELINE)).toEqual({
      starts: 1,
      endings: {
        exited: 1,
        timed_out: 0,
        stopped_by_agent: 0,
        stopped_by_person: 0,
        stopped_by_approval: 0,
        stopped_by_turn: 0,
        failed_to_start: 0,
        running: 0,
      },
      // The work's union, 0-50 and 100-112, inside the command's 11-100.
      worked_while_running_ms: 39,
      // The read at 20 and the sleep at 30; the read at 110 came after it ended.
      polls: 2,
      sleeps: 1,
      self_backgrounded: 0,
      foreground_timeouts: 0,
      waits: 1,
      wait_ms: 50,
      reminders: 1,
      // The sleep, the one shell call that started while it ran.
      gated_while_running: 1,
      orphans: null,
    });
  });

  it("never judges a call against the command it started, whose span opens first, nor counts a background start as sleeping", () => {
    // The registry reports a start inside the starting call, often before
    // that call's own start is folded: the live order.
    const calls: CallInit[] = [
      { name: "execute", args: { command: "sleep 1; echo suite-ok", background: true } },
      { name: "execute", args: { command: "go run ./cmd/server", background: true } },
    ];
    const line = timeline([
      ["model_round", 0, 10],
      ["background_command:c0", 10, 50],
      ["tool:execute", 11, 12],
      ["background_command:c1", 20, 60],
      ["tool:execute", 21, 22],
    ]);
    const readings = readingsOf(calls, line);
    expect(readings.polls, "neither start polls").toBe(0);
    expect(readings.sleeps, "a background start is no sleep").toBe(0);
    expect(readings.gated_while_running, "the second start began while the first command ran").toBe(1);
  });

  it("does not take a read of another command's output file for a poll of the one running", () => {
    const calls: CallInit[] = [SLOW_SUITE_CALLS[0]!, { name: "grep", args: { pattern: "FAIL", path: "/large_tool_results/background-toolu_B.log" } }];
    const line = timeline([
      ["model_round", 0, 10],
      ["tool:execute", 10, 12],
      ["background_command:toolu_A", 11, 100],
      ["tool:grep", 20, 22],
    ]);
    expect(readingsOf(calls, line).polls).toBe(0);
  });

  it("matches a call id the runner sanitized in the output file's name", () => {
    const calls: CallInit[] = [
      { name: "execute", args: { command: "npm test", background: true } },
      { name: "execute", args: { command: "tail -n 20 /large_tool_results/background-call_1_2.log" } },
    ];
    const line = timeline([
      ["tool:execute", 0, 2],
      ["background_command:call.1:2", 1, 50],
      ["tool:execute", 10, 11],
    ]);
    expect(readingsOf(calls, line)).toMatchObject({ polls: 1, gated_while_running: 1 });
  });

  it("counts the agent backgrounding a command itself, and the shell's own timeout line, without a timeline", () => {
    const readings = readingsOf(
      [
        { name: "execute", args: { command: "go run ./cmd/server & sleep 2; curl -s 127.0.0.1:8765/minutes?d=1h30m" } },
        { name: "execute", args: { command: "nohup go run ./cmd/server > /tmp/server.log 2>&1 &" } },
        { name: "execute", args: { command: "go vet ./... && go test ./... 2>&1 | tail -5" } },
        { name: "execute", args: { command: "go run ./cmd/server" }, result: "[Command timed out after 120 seconds; its processes were stopped]" },
        { name: "execute", args: { command: "sleep 3" } },
      ],
      null,
    );
    expect(readings).toEqual({
      starts: 0,
      endings: expect.objectContaining({ exited: 0, running: 0 }) as BackgroundReadings["endings"],
      worked_while_running_ms: null,
      polls: null,
      sleeps: 1,
      self_backgrounded: 2,
      foreground_timeouts: 1,
      waits: null,
      wait_ms: null,
      reminders: null,
      gated_while_running: null,
      orphans: null,
    });
  });

  it("leaves every reading that needs a call's start null when a sub-agent ran, and keeps the spans' own", () => {
    const line = timeline([
      ["model_round", 0, 10],
      ["tool:execute", 10, 12],
      ["background_command:toolu_A", 11, 100],
      ["sub_agent:reviewer", 12, 40],
      ["model_round", 14, 20],
    ]);
    const readings = readingsOf([SLOW_SUITE_CALLS[0]!], line, subAgentThread("task1", "reviewing"));
    expect(readings).toMatchObject({ starts: 1, polls: null, gated_while_running: null, worked_while_running_ms: 7, waits: 0, wait_ms: 0 });
    expect(readings.reminders, "a line without the count is an older runner's").toBeNull();
  });

  it("reads nothing on an attempt that never ran", () => {
    expect(backgroundReadings(undefined, null, [])).toMatchObject({ starts: 0, sleeps: 0, polls: null, worked_while_running_ms: null });
  });
});

describe("endingKey", () => {
  it("keys a stop by who stopped it, a stop naming no one by the turn's end, and every other ending by its state", () => {
    const view = { timeoutSeconds: 0, exitCode: undefined, stoppedByToolUseId: "", output: "", startedAt: "", endedAt: "", liveOutput: "", stopRequested: false };
    expect(endingKey({ ...view, state: "stopped", stoppedBy: "agent" })).toBe("stopped_by_agent");
    expect(endingKey({ ...view, state: "stopped", stoppedBy: "approval" })).toBe("stopped_by_approval");
    expect(endingKey({ ...view, state: "stopped", stoppedBy: undefined })).toBe("stopped_by_turn");
    expect(endingKey({ ...view, state: "timed_out", stoppedBy: undefined })).toBe("timed_out");
    expect(endingKey({ ...view, state: "running", stoppedBy: undefined })).toBe("running");
  });

  it("is what the readings count, from the log's own status", () => {
    const readings = readingsOf(
      [
        {
          name: "execute",
          args: { command: "go run ./cmd/server", background: true },
          after: [backgroundStatus("c0", { phase: "running" }), backgroundStatus("c0", { phase: "ended", ending: "stopped", stoppedBy: "agent", stoppedByCall: "c1" })],
        },
        { name: "stop_background_command", args: { id: "toolu_A" } },
        {
          name: "execute",
          args: { command: "sleep 600", background: true, timeout: 1 },
          after: [backgroundStatus("c2", { phase: "running", timeoutSeconds: 1 }), backgroundStatus("c2", { phase: "ended", ending: "timed_out" })],
        },
      ],
      null,
    );
    expect(readings.starts).toBe(2);
    expect(readings.endings).toMatchObject({ stopped_by_agent: 1, timed_out: 1, exited: 0 });
  });
});

describe("shellOutputs", () => {
  it("is each shell call's result and each background command's output once it ended, and nothing of other tools", () => {
    const turn = turnWith([...SLOW_SUITE_CALLS.slice(0, 2), { name: "execute", args: { command: "go vet ./..." }, result: "" }]);
    expect(shellOutputs(turn)).toEqual([
      `Started in the background (id toolu_A). Its output goes to ${OUTPUT_FILE}. Do not poll it.`,
      "ok  \texample.com/orders-sync/integration\t60.8s",
    ]);
    expect(shellOutputs(undefined)).toEqual([]);
  });
});

describe("summarizeBackground", () => {
  const readings = (overrides: Partial<BackgroundReadings>): BackgroundReadings => ({
    ...readingsOf(SLOW_SUITE_CALLS, SLOW_SUITE_TIMELINE),
    ...overrides,
  });

  it("sums a cell's samples that ran, medians the polls and the work of the samples that used it, and counts the checks that held", () => {
    const summary = summarizeBackground([
      makeSample({ background: readings({ orphans: 0 }), task_done: true }),
      makeSample({ background: readings({ starts: 0, worked_while_running_ms: 0, polls: 0, orphans: 1, self_backgrounded: 1 }), task_done: false }),
      makeSample({ background: readings({ polls: 0, worked_while_running_ms: 20_000, orphans: 0 }), task_done: true }),
      makeSample({ background: null, outcome: "failed" }),
    ]);
    expect(summary).toEqual({
      ran: 3,
      used: 2,
      starts: 2,
      polls_median: 0,
      polls_max: 2,
      worked_while_running_ms: 20_000,
      waits: 3,
      reminders: 3,
      sleeps: 3,
      self_backgrounded: 1,
      foreground_timeouts: 0,
      gated_while_running: 3,
      orphans: 1,
      task_done: { done: 2, of: 3 },
    });
  });

  it("is null where no sample carries readings, and leaves the checks out of a cell that names none", () => {
    expect(summarizeBackground([makeSample({ background: null })])).toBeNull();
    const unread = summarizeBackground([makeSample({ background: readings({ polls: null, worked_while_running_ms: null }) })]);
    expect(unread).toMatchObject({ polls_median: null, polls_max: null, worked_while_running_ms: null, task_done: null });
  });
});
