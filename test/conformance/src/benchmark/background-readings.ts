// Reads what the agent did with background commands in one turn into the
// sample: how many it started and how they ended, how much it worked while
// one ran, whether it polled one instead of waiting to be told, and the
// shell habits the same jobs show without the feature (a `sleep`, a lone
// `&`, a foreground command that ran out its time).
// Domain: conformance benchmark (the session's log and the runner's timeline, per turn).
//
// Where each reading comes from, and why there:
// - The calls, their inputs and their results are the turn's primary-thread
//   tool uses in the session's log (`Turn`, @stigmer/session-log), the same
//   list `tool-call-facts.ts` reads, so the facts and these readings index
//   alike. How a command ended is the log's fold of its status
//   (`ToolUse.background`).
// - WHEN anything happened is read from the runner's turn timeline alone
//   (runner harness/turn-timeline.ts): a `background_command:<callId>` span
//   per command, a `background_wait` span per wait at a round's end, the
//   `model_round` and `tool:` spans, and the line's `background_reminders`
//   count. The log cannot say whether a call ran while a command did: a
//   command's start and a call's `processedAt` are the server's append time,
//   its end is the runner's, and the runner coalesces writes, so calls in
//   one batch share one stamp. A call's own start is the span
//   `tool-call-facts.ts` placed it on (`start_ms`).
// - Polling is OpenCode's definition made checkable (anomalyco/opencode
//   packages/core/src/tool/plugin/shell.ts: "Repeatedly sleeping and reading
//   or searching the output file is polling, not useful work"): a call that
//   starts while a command runs and names that command's output file in any
//   of its arguments, or a shell call that begins with `sleep` while one
//   runs. A command's output file is `background-<id>.log`, the id kept to
//   the characters every filesystem takes (runner
//   shared/shell/background-commands.ts `backgroundOutputFileName`); a file
//   whose id names no running command is a read of a finished one's output.
// - "Would have paused" (`gated_while_running`) counts shell calls that
//   start while a command runs. In the benchmark's workspace only a shell
//   call asks under the default policy (a write is captured for review
//   instead), and each pause stops every running command; the benchmark
//   approves everything, so this is the estimate, labelled as one.
// - A call is never judged against the command it started (its span can
//   open inside that command's: the registry reports the start inside the
//   call), and a background start is never the agent sleeping, whatever its
//   command begins with.
//
// Never a guess: with no timeline every runner-clock reading is `null`, and
// with calls the timeline cannot place (a sub-agent ran) every reading that
// needs a call's start is `null` too.
import type { ToolUse, Turn } from "@stigmer/session-log";
import { median, type BackgroundEndingKey, type BackgroundReadings, type BenchmarkSample, type TimingLine, type TimingSegment, type ToolCallFact } from "./report";
import { SHELL_TOOL } from "./tool-call-facts";

const COMMAND_SEGMENT_PREFIX = "background_command:";
const WAIT_SEGMENT = "background_wait";
const MODEL_ROUND_SEGMENT = "model_round";
const TOOL_SEGMENT_PREFIX = "tool:";
const REMINDERS_FIELD = "background_reminders";

/** The line a foreground command that ran out its time returns (runner execute-deep-agent/shell-tool.ts). */
const FOREGROUND_TIMEOUT_MARKER = "[Command timed out after";

const OUTPUT_FILE = /background-([A-Za-z0-9_-]+)\.log/g;
const SLEEP = /^\s*sleep\b/;
// A lone `&`: not `&&`, nor a redirection's `&>`, `>&`, `<&` or `|&`.
const LONE_AMPERSAND = /(?<![&><|])&(?![&>])/;
const NOHUP = /(^|[\s;&|(])nohup\s/;

const ENDING_KEYS: readonly BackgroundEndingKey[] = [
  "exited",
  "timed_out",
  "stopped_by_agent",
  "stopped_by_person",
  "stopped_by_approval",
  "stopped_by_turn",
  "failed_to_start",
  "running",
];

interface Interval {
  start: number;
  end: number;
}

interface CommandSpan extends Interval {
  /** The starting call's id, as the runner keys the command. */
  callId: string;
  /** The command's output file id: its call id, sanitized as the runner names the file. */
  fileId: string;
}

/** The turn's background readings; `facts` are `toolCallFacts` over the same turn and timeline. */
export function backgroundReadings(
  turn: Turn | undefined,
  turnPhases: TimingLine | null,
  facts: readonly ToolCallFact[],
): BackgroundReadings {
  const uses = (turn?.items ?? []).filter((item): item is ToolUse => item.kind === "tool_use");
  const shell = uses.filter((use) => use.name === SHELL_TOOL);
  const commandOf = (use: ToolUse): string => {
    const command = use.input["command"];
    return typeof command === "string" ? command : "";
  };

  const endings = Object.fromEntries(ENDING_KEYS.map((key) => [key, 0])) as Record<BackgroundEndingKey, number>;
  for (const use of shell) {
    if (use.background !== undefined) endings[endingKey(use.background)] += 1;
  }

  const timeline = turnPhases === null ? null : readTimeline(turnPhases);
  const placed = timeline !== null && facts.length === uses.length && facts.every((fact) => fact.start_ms !== null);
  let polls: number | null = null;
  let gated: number | null = null;
  if (timeline !== null && placed) {
    polls = 0;
    gated = 0;
    uses.forEach((use, index) => {
      const start = facts[index]!.start_ms!;
      // A call is never judged against the command it started: the
      // registry reports a start inside the starting call, often before
      // that call's own start is folded, so its span begins inside the
      // command's.
      const running = timeline.commands.filter((span) => start >= span.start && start < span.end && !startedBy(use, span));
      if (running.length === 0) return;
      if (use.name === SHELL_TOOL) gated! += 1;
      const sleeping = use.name === SHELL_TOOL && use.input["background"] !== true && SLEEP.test(commandOf(use));
      const files = outputFilesNamed(use);
      if (sleeping || running.some((span) => files.has(span.fileId))) polls! += 1;
    });
  }

  return {
    starts: shell.filter((use) => use.input["background"] === true).length,
    endings,
    worked_while_running_ms: timeline === null ? null : round1(overlap(timeline.work, timeline.commands)),
    polls,
    sleeps: shell.filter((use) => use.input["background"] !== true && SLEEP.test(commandOf(use))).length,
    self_backgrounded: shell.filter((use) => LONE_AMPERSAND.test(commandOf(use)) || NOHUP.test(commandOf(use))).length,
    foreground_timeouts: shell.filter((use) => (use.result?.text ?? "").includes(FOREGROUND_TIMEOUT_MARKER)).length,
    waits: timeline === null ? null : timeline.waits.length,
    wait_ms: timeline === null ? null : round1(timeline.waits.reduce((sum, wait) => sum + (wait.end - wait.start), 0)),
    reminders: turnPhases === null ? null : numberOrNull(turnPhases.context[REMINDERS_FIELD]),
    gated_while_running: gated,
    orphans: null,
  };
}

/** A cell's readings over its samples that ran, as the run's summary and `benchmark-compare` print them. */
export interface BackgroundSummary {
  /** Samples that ran (a sample that failed at create has no readings). */
  ran: number;
  /** Samples that started at least one command in the background. */
  used: number;
  starts: number;
  /** Over the samples whose polls were readable. */
  polls_median: number | null;
  polls_max: number | null;
  /** Median over the samples that used the background. */
  worked_while_running_ms: number | null;
  waits: number;
  reminders: number;
  sleeps: number;
  self_backgrounded: number;
  foreground_timeouts: number;
  gated_while_running: number;
  orphans: number;
  /** Samples whose checks held, of those that ran; `null` on a cell with no checks. */
  task_done: { done: number; of: number } | null;
}

/** The summary of `samples`; `null` when none carries readings. */
export function summarizeBackground(samples: readonly BenchmarkSample[]): BackgroundSummary | null {
  const ran = samples.filter((sample) => sample.background !== null);
  if (ran.length === 0) return null;
  const readings = ran.map((sample) => sample.background!);
  const sum = (read: (reading: BackgroundReadings) => number | null): number =>
    readings.reduce((total, reading) => total + (read(reading) ?? 0), 0);
  const polls = readings.flatMap((reading) => (reading.polls === null ? [] : [reading.polls]));
  const worked = readings.flatMap((reading) =>
    reading.starts > 0 && reading.worked_while_running_ms !== null ? [reading.worked_while_running_ms] : [],
  );
  const checked = ran.filter((sample) => sample.task_done !== null);
  return {
    ran: ran.length,
    used: readings.filter((reading) => reading.starts > 0).length,
    starts: sum((reading) => reading.starts),
    polls_median: median(polls),
    polls_max: polls.length === 0 ? null : Math.max(...polls),
    worked_while_running_ms: median(worked),
    waits: sum((reading) => reading.waits),
    reminders: sum((reading) => reading.reminders),
    sleeps: sum((reading) => reading.sleeps),
    self_backgrounded: sum((reading) => reading.self_backgrounded),
    foreground_timeouts: sum((reading) => reading.foreground_timeouts),
    gated_while_running: sum((reading) => reading.gated_while_running),
    orphans: sum((reading) => reading.orphans),
    task_done: checked.length === 0 ? null : { done: checked.filter((sample) => sample.task_done === true).length, of: checked.length },
  };
}

/** What each primary-thread shell call printed: a foreground call's result, a background command's output once it ended. */
export function shellOutputs(turn: Turn | undefined): string[] {
  return (turn?.items ?? []).flatMap((item) => {
    if (item.kind !== "tool_use" || item.name !== SHELL_TOOL) return [];
    return [item.result?.text ?? "", item.background?.output ?? ""].filter((text) => text !== "");
  });
}

/** How a command ended, as one key (`BackgroundEndingKey`). */
export function endingKey(view: NonNullable<ToolUse["background"]>): BackgroundEndingKey {
  if (view.state === "stopped") return `stopped_by_${view.stoppedBy ?? "turn"}`;
  return view.state;
}

function readTimeline(line: TimingLine): { commands: CommandSpan[]; waits: Interval[]; work: Interval[] } {
  const interval = (segment: TimingSegment): Interval => ({ start: segment.start_ms, end: segment.start_ms + segment.duration_ms });
  const commands: CommandSpan[] = [];
  const waits: Interval[] = [];
  const work: Interval[] = [];
  for (const segment of line.segments) {
    if (segment.name.startsWith(COMMAND_SEGMENT_PREFIX)) {
      const callId = segment.name.slice(COMMAND_SEGMENT_PREFIX.length);
      commands.push({ ...interval(segment), callId, fileId: callId.replace(/[^A-Za-z0-9_-]/g, "_") });
    } else if (segment.name === WAIT_SEGMENT) {
      waits.push(interval(segment));
    } else if (segment.name === MODEL_ROUND_SEGMENT || segment.name.startsWith(TOOL_SEGMENT_PREFIX)) {
      work.push(interval(segment));
    }
  }
  return { commands, waits, work };
}

/**
 * Whether `use` is the call that started the command `span` spans: a tool
 * use's id is its run's id and the call's, `<run>.<call>` (runner
 * harness/events/ids.ts `toolUseEventId`; a call id too long for an event id
 * is hashed there, and such a start is not recognised).
 */
function startedBy(use: ToolUse, span: CommandSpan): boolean {
  return use.id.endsWith(`.${span.callId}`);
}

/** The output-file ids any string argument of the call names. */
function outputFilesNamed(use: ToolUse): Set<string> {
  const ids = new Set<string>();
  for (const value of Object.values(use.input)) {
    if (typeof value !== "string") continue;
    for (const match of value.matchAll(OUTPUT_FILE)) ids.add(match[1]!);
  }
  return ids;
}

/** The length of the union of `a` that lies inside the union of `b`. */
function overlap(a: readonly Interval[], b: readonly Interval[]): number {
  const left = union(a);
  const right = union(b);
  let total = 0;
  for (const x of left) {
    for (const y of right) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) total += end - start;
    }
  }
  return total;
}

function union(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function round1(ms: number): number {
  return Math.round(ms * 10) / 10;
}
