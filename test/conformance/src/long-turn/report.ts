// The real-clock run's report: one sample a minute, the run's end, and the
// transcript check, written whole every minute so a run that is stopped
// still leaves one.
// Domain: conformance long turn (the real-clock run's report).
//
// A stopped benchmark wrote nothing (stigmer#2011); this report is rewritten
// after every sample, as `report.json` beside a Markdown `summary.md`, each
// through a temporary file and a rename, so a reader never sees half of one.
//
// The transcript is judged twice: the session's log read back at the end must
// run unbroken, and a client that streamed the session from its first event,
// resuming from its last seq whenever a stream ended (a server restart ends
// every stream), must have been sent exactly that log, once and in order.
// Either failing makes the verdict broken, and the scripts exit non-zero on
// it: a lost or repeated event is the one thing a long run must never show.
//
// A queued message the turn reads moves to the head of the log, listed once
// where it was read, and streams a second time there; the seq it stood at
// first (which the follower was sent) is no gap and no extra
// (`movedSeqsOf`).
//
// A profile with a `message` step is judged on the message too: the person's
// message sent mid-tool must be read by the run, listed once, after the
// result of the step it was sent during; and a follower of what needs the
// person must have been told of the turn exactly once, `finished`. Either
// failing makes the run's verdict failed.
//
// Compaction is judged from the log, real-clock and live alike: every
// summary the engine wrote is one `agent.thread_context_compacted`, so on the
// mock the count must equal the summary calls it answered, and the turn's
// reply must never be the mock's summary (until the runner kept the summary
// off the stream it was, in every long run). A live run also checks its goal:
// the opening asked for `FINISHED.md` naming the first and the last step and
// how many ran, which only a model that kept its goal across its compactions
// can write right ({@link FinishedCheck}).

import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { MOCK_CONVERSATION_SUMMARY } from "@stigmer/test-support/mock-llm";

/** What the run saw in one minute. */
export interface MinuteSample {
  readonly elapsedMinutes: number;
  /** The run's phase name (`RUN_IN_PROGRESS`, ...). */
  readonly phase: string;
  /** The step whose shell (or subagent) was open, if any. */
  readonly openStep: string | undefined;
  readonly stepsStarted: number;
  readonly stepsEnded: number;
  /** Events on the session's log so far: the turn's persisted progress. */
  readonly sessionEvents: number;
  /**
   * Model calls the mock answered from its script, and the compaction
   * summaries it answered out of band. Absent on a live run, where no mock
   * sees them.
   */
  readonly modelCalls: number | undefined;
  readonly compactions: number | undefined;
  /** The run's error, when it has one. */
  readonly error: string;
}

/** Where a step's runner was ended, and when. */
export interface RunnerEvent {
  readonly elapsedMinutes: number;
  readonly step: string;
  readonly signal: "SIGKILL" | "SIGTERM";
}

/** Where the server was replaced, and whether the outgoing and the incoming server served together. */
export interface ServerRestartEvent {
  readonly elapsedMinutes: number;
  readonly step: string;
  readonly overlapped: boolean;
}

/** What the streaming follower was sent, checked against the session's log. */
export interface FollowerCheck {
  /** Events the follower was sent, repeats included. */
  readonly events: number;
  /** Streams it opened: one, plus one per ending it resumed from. */
  readonly streams: number;
  /** How each stream that ended before the run did ended (a status code's name). */
  readonly endings: readonly string[];
  /** Sequence numbers on the log the follower was never sent, as `[from, to]` ranges. */
  readonly missing: ReadonlyArray<readonly [number, number]>;
  /** Sequence numbers it was sent more than once. */
  readonly duplicates: readonly number[];
  /** Sequence numbers it was sent that the log does not hold. */
  readonly extra: readonly number[];
  /** Whether no event arrived after one with a higher seq (a repeat is counted under `duplicates`, not here). */
  readonly inOrder: boolean;
}

/** The session's log read back at the end: its sequence numbers, checked unbroken. */
export interface TranscriptCheck {
  readonly events: number;
  readonly firstSeq: number;
  readonly lastSeq: number;
  /** Missing sequence numbers, as `[from, to]` ranges. Empty when the log is whole. */
  readonly gaps: ReadonlyArray<readonly [number, number]>;
  /**
   * Where a queued message stood before the turn that read it moved it to
   * the log's head: not a gap (the message is listed once, where it was
   * read, and streams twice). Absent when none moved.
   */
  readonly moved?: readonly number[];
}

export interface LongTurnReport {
  readonly profile: string;
  readonly model: string;
  readonly startedAt: string;
  readonly steps: readonly string[];
  /** What this run cannot see, said once (the static runner token is never re-minted against the mock). */
  readonly notes: readonly string[];
  readonly samples: readonly MinuteSample[];
  readonly runnerEvents: readonly RunnerEvent[];
  /** Where the server was replaced; absent on a run that replaced none. */
  readonly serverRestarts?: readonly ServerRestartEvent[];
  /** The person's message, once sent; absent before then and on a profile with no `message` step. */
  readonly message?: SentMessage;
  /** Absent while the run is going. */
  readonly end?: LongTurnEnd;
}

/** How the run ended and what its transcript held. */
export interface LongTurnEnd {
  readonly phase: string;
  readonly error: string;
  readonly elapsedMinutes: number;
  /** The step open when the turn stopped, or the last that ended. */
  readonly atStep: string | undefined;
  readonly stepsEnded: number;
  readonly stoppedByBudget: boolean;
  readonly transcript: TranscriptCheck | undefined;
  /** The agent's final reply on the turn (its last message's text), "" when it wrote none: what a live model answered instead of acting, when it did. */
  readonly reply?: string;
  /** The mock's counts at the end (absent on a live run): a run shorter than a minute has no sample to carry them. */
  readonly modelCalls?: number;
  readonly compactions?: number;
  /** The `agent.thread_context_compacted` events in the log read back, every thread's. */
  readonly compactedEvents?: number;
  /** What the live run's `FINISHED.md` said against what the opening asked for; absent on the mock. */
  readonly finished?: FinishedCheck;
  /** What the streaming follower was sent; absent when none ran. */
  readonly follower?: FollowerCheck;
  /** What became of the person's message; absent on a profile with no `message` step. */
  readonly message?: MessageCheck;
  /** What the follower of what needs the person was told of this turn; absent when none ran. */
  readonly attention?: AttentionCheck;
}

/** The person's message sent mid-tool, as the run sent it. */
/** The goal the live opening set at its start and asked for only at its end (`FINISHED.md`), against what the model wrote. */
export interface FinishedCheck {
  /** The three lines asked for: the first step's id, the last step's id, the number of steps. */
  readonly expected: readonly string[];
  /** The file's non-empty lines, trimmed; absent when the model wrote no file. */
  readonly found?: readonly string[];
}

/** The goal check from what the model wrote (`undefined` when it wrote nothing). */
export function finishedCheckOf(steps: readonly string[], written: string | undefined): FinishedCheck {
  const expected = [steps[0] ?? "", steps.at(-1) ?? "", String(steps.length)];
  if (written === undefined) return { expected };
  return { expected, found: written.split("\n").map((l) => l.trim()).filter((l) => l !== "") };
}

/** Whether the model kept its goal: it wrote exactly the three lines asked for. */
export function goalKept(check: FinishedCheck): boolean {
  return check.found !== undefined && check.found.length === check.expected.length && check.found.every((l, i) => l === check.expected[i]);
}

/** The compaction markers in a log read back, every thread's. */
export function compactedEventsOf(log: readonly SessionEvent[]): number {
  return log.filter((e) => e.event.case === "agentThreadContextCompacted").length;
}

export interface SentMessage {
  readonly step: string;
  readonly sentAtMinutes: number;
  /** The message's `user.message` event id. */
  readonly eventId: string;
  /** Whether it waited in the session's queue when sent: the turn was working. */
  readonly queuedWhenSent: boolean;
  /** Whether the server was replaced while it waited. */
  readonly serverRestartedWhileQueued: boolean;
}

/** What the session's log says became of the person's message. */
export interface MessageCheck extends SentMessage {
  /** How many times the log lists it: once. */
  readonly listed: number;
  /** The run that read it; "" when none did. */
  readonly readBy: string;
  /** Whether it sits in the log after the result of the step it was sent during. */
  readonly afterStepResult: boolean;
}

/** What a follower of what needs the person was told of the turn's session. */
export interface AttentionCheck {
  readonly told: ReadonlyArray<{ readonly reason: string; readonly runId: string }>;
}

/** What the log says of the message `sent`: whether it is listed once, read by `runId`, after its step's result. */
export function messageCheckOf(log: readonly SessionEvent[], sent: SentMessage): MessageCheck {
  const at = log.flatMap((event, index) => (event.event.case === "userMessage" && event.event.value.id === sent.eventId ? [index] : []));
  const read = at.length === 1 ? log[at[0]!]! : undefined;
  // The step's call is the tool use whose command marks the step's start.
  const callIndex = log.findIndex(
    (event) =>
      event.event.case === "agentToolUse" &&
      JSON.stringify(event.event.value.input ?? {}).includes(`start ${sent.step}`),
  );
  const call = callIndex >= 0 && log[callIndex]!.event.case === "agentToolUse" ? log[callIndex]!.event.value.id : undefined;
  const resultIndex = log.findIndex((event) => event.event.case === "agentToolResult" && event.event.value.toolUseId === call);
  return {
    ...sent,
    listed: at.length,
    readBy: read?.runId ?? "",
    afterStepResult: read !== undefined && resultIndex >= 0 && at[0]! > resultIndex,
  };
}

/** The gaps in a log's sequence numbers, as inclusive ranges. */
export function seqGapsOf(seqs: readonly number[]): Array<[number, number]> {
  const sorted = [...new Set(seqs)].sort((a, b) => a - b);
  const gaps: Array<[number, number]> = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const next = sorted[i]!;
    if (next > prev + 1) gaps.push([prev + 1, next - 1]);
  }
  return gaps;
}

export function transcriptCheckOf(seqs: readonly number[], moved: readonly number[] = []): TranscriptCheck {
  return {
    events: seqs.length,
    firstSeq: seqs.length === 0 ? 0 : Math.min(...seqs),
    lastSeq: seqs.length === 0 ? 0 : Math.max(...seqs),
    gaps: seqGapsOf([...seqs, ...moved]),
    ...(moved.length === 0 ? {} : { moved: [...moved].sort((a, b) => a - b) }),
  };
}

/**
 * The seqs a queued message stood at before it moved to the log's head:
 * those the follower was sent (as `[seq, event id]`) whose event the log now
 * lists at another seq.
 */
export function movedSeqsOf(followed: ReadonlyArray<readonly [number, string]>, logged: ReadonlyArray<readonly [number, string]>): number[] {
  const at = new Map(logged.map(([seq, id]) => [id, seq]));
  const moved = followed.filter(([seq, id]) => id !== "" && at.has(id) && at.get(id) !== seq).map(([seq]) => seq);
  return [...new Set(moved)].sort((a, b) => a - b);
}

/** What the follower was sent (`followed`, in arrival order) against the log's seqs, with the endings it resumed from. */
export function followerCheckOf(
  followed: readonly number[],
  logged: readonly number[],
  endings: readonly string[],
  moved: readonly number[] = [],
): FollowerCheck {
  const seen = new Map<number, number>();
  for (const seq of followed) seen.set(seq, (seen.get(seq) ?? 0) + 1);
  // A moved message's first place was streamed, as the contract streams it twice.
  const onLog = new Set([...logged, ...moved]);
  const never = [...onLog].filter((seq) => !seen.has(seq)).sort((a, b) => a - b);
  return {
    events: followed.length,
    streams: endings.length + 1,
    endings,
    missing: rangesOf(never),
    duplicates: [...seen].filter(([, n]) => n > 1).map(([seq]) => seq).sort((a, b) => a - b),
    extra: [...seen.keys()].filter((seq) => !onLog.has(seq)).sort((a, b) => a - b),
    inOrder: followed.every((seq, i) => i === 0 || seq >= followed[i - 1]!),
  };
}

/** Sorted numbers as inclusive runs. */
function rangesOf(sorted: readonly number[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const n of sorted) {
    const last = ranges.at(-1);
    if (last !== undefined && n === last[1] + 1) last[1] = n;
    else ranges.push([n, n]);
  }
  return ranges;
}

const rangeText = (ranges: ReadonlyArray<readonly [number, number]>): string => ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ");

/** Whether the transcript came through whole, and each reason it did not. */
export function transcriptVerdictOf(end: LongTurnEnd): { readonly whole: boolean; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  if (end.transcript === undefined) reasons.push("the log was not read back");
  else if (end.transcript.gaps.length > 0) reasons.push(`the log has gaps ${rangeText(end.transcript.gaps)}`);
  const f = end.follower;
  if (f === undefined) reasons.push("no streaming follower ran");
  else {
    if (f.missing.length > 0) reasons.push(`the follower missed ${rangeText(f.missing)}`);
    if (f.duplicates.length > 0) reasons.push(`the follower was sent ${f.duplicates.join(", ")} twice`);
    if (f.extra.length > 0) reasons.push(`the follower was sent ${f.extra.join(", ")}, which the log lacks`);
    if (!f.inOrder) reasons.push("the follower was sent the log out of order");
  }
  return { whole: reasons.length === 0, reasons };
}

/** Whether every compaction was marked in the log, and the summary never stood as the turn's reply. */
export function compactionVerdictOf(end: LongTurnEnd): { readonly marked: boolean; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  if (end.reply === MOCK_CONVERSATION_SUMMARY) reasons.push("the turn's reply is the summarizer's text, not the agent's");
  if (end.compactions !== undefined && end.compactedEvents !== undefined && end.compactions !== end.compactedEvents) {
    reasons.push(`the engine summarized ${end.compactions} times and the log marks ${end.compactedEvents}`);
  }
  return { marked: reasons.length === 0, reasons };
}

/** Whether the person's message was read by the run, once, after its step, and they were told of the turn once, finished. */
export function messageVerdictOf(end: LongTurnEnd, runId: string): { readonly read: boolean; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  const m = end.message;
  if (m !== undefined) {
    if (!m.queuedWhenSent) reasons.push("the message did not wait for the working turn: it was sent with nothing working");
    if (m.listed !== 1) reasons.push(`the log lists the message ${m.listed} times`);
    if (m.readBy !== runId) reasons.push(m.readBy === "" ? "no run read the message" : `run ${m.readBy} read the message, not the turn`);
    if (!m.afterStepResult) reasons.push(`the message is not in the log after the result of \`${m.step}\``);
  }
  const a = end.attention;
  if (a !== undefined) {
    const told = a.told.map((t) => `${t.reason} (${t.runId})`).join(", ");
    if (a.told.length !== 1 || a.told[0]!.reason !== "finished" || a.told[0]!.runId !== runId) {
      reasons.push(`the person was told ${told === "" ? "nothing" : told}, not once that the turn finished`);
    }
  }
  return { read: reasons.length === 0, reasons };
}

/** The Markdown summary: the outcome first, then the minute table. */
export function renderSummary(report: LongTurnReport): string {
  const lines: string[] = [`# Long turn, real clock: ${report.profile}`, ""];
  lines.push(`Model \`${report.model}\`, started ${report.startedAt}, ${report.steps.length} steps.`, "");
  if (report.end === undefined) {
    const last = report.samples.at(-1);
    lines.push(`**Running**: ${last === undefined ? "no sample yet" : `minute ${last.elapsedMinutes}, ${last.phase}, open step ${last.openStep ?? "none"}`}.`);
  } else {
    const { end } = report;
    const outcome = end.stoppedByBudget
      ? `stopped by the run's budget at minute ${end.elapsedMinutes}`
      : `ended ${end.phase} at minute ${end.elapsedMinutes}`;
    lines.push(`**Outcome**: ${outcome}, at step \`${end.atStep ?? "none"}\`, ${end.stepsEnded} of ${report.steps.length} steps ended.`);
    const verdict = transcriptVerdictOf(end);
    lines.push(
      "",
      verdict.whole
        ? "**Transcript**: whole: the log is unbroken, and the follower was sent every event of it once, in order."
        : `**Transcript**: broken: ${verdict.reasons.join("; ")}.`,
    );
    if (end.message !== undefined || end.attention !== undefined) {
      const m = end.message;
      if (m !== undefined) {
        lines.push(
          "",
          `Message: sent at minute ${m.sentAtMinutes} during \`${m.step}\`${m.queuedWhenSent ? ", waited in the queue" : ""}${m.serverRestartedWhileQueued ? ", the server replaced while it waited" : ""}; listed ${m.listed} time${m.listed === 1 ? "" : "s"}, read by ${m.readBy === "" ? "no run" : m.readBy}${m.afterStepResult ? ", after the step's result" : ""}.`,
        );
      }
      if (end.attention !== undefined) {
        const told = end.attention.told.map((t) => t.reason).join(", ");
        lines.push("", `Attention: told ${told === "" ? "nothing" : told}.`);
      }
    }
    if (end.compactions !== undefined) lines.push("", `Model calls: ${end.modelCalls ?? 0}; compactions: ${end.compactions}.`);
    if (end.compactedEvents !== undefined) {
      const compaction = compactionVerdictOf(end);
      lines.push("", `Compactions marked in the log: ${end.compactedEvents}${compaction.marked ? "." : `; ${compaction.reasons.join("; ")}.`}`);
    }
    if (end.finished !== undefined) {
      const f = end.finished;
      lines.push(
        "",
        goalKept(f)
          ? `**Goal**: kept: FINISHED.md names ${f.expected.join(", ")}, as the opening asked.`
          : `**Goal**: lost: the opening asked FINISHED.md for ${f.expected.join(", ")}; ${f.found === undefined ? "no file was written" : `it holds ${f.found.length === 0 ? "nothing" : f.found.join(", ")}`}.`,
      );
    }
    if (end.error !== "") lines.push("", `Error: ${end.error}`);
    if (end.reply !== undefined && end.reply !== "") lines.push("", `Reply: ${end.reply.length > 600 ? `${end.reply.slice(0, 600)}…` : end.reply}`);
    if (end.transcript !== undefined) {
      const t = end.transcript;
      lines.push(
        "",
        t.gaps.length === 0
          ? `Transcript: ${t.events} events, seq ${t.firstSeq} to ${t.lastSeq}, unbroken${t.moved === undefined ? "" : ` (moved to the head as read: ${t.moved.join(", ")})`}.`
          : `Transcript: ${t.events} events, seq ${t.firstSeq} to ${t.lastSeq}, gaps ${rangeText(t.gaps)}.`,
      );
    }
    if (end.follower !== undefined) {
      const f = end.follower;
      lines.push("", `Follower: ${f.events} events over ${f.streams} stream${f.streams === 1 ? "" : "s"}${f.endings.length === 0 ? "" : ` (ended: ${f.endings.join(", ")})`}.`);
    }
  }
  for (const note of report.notes) lines.push("", `Note: ${note}`);
  if (report.runnerEvents.length > 0) {
    lines.push("", "## Runner ends", "");
    for (const event of report.runnerEvents) lines.push(`- minute ${event.elapsedMinutes}: ${event.signal} during \`${event.step}\``);
  }
  if (report.serverRestarts !== undefined && report.serverRestarts.length > 0) {
    lines.push("", "## Server restarts", "");
    for (const event of report.serverRestarts) {
      lines.push(`- minute ${event.elapsedMinutes}: the server ${event.overlapped ? "replaced, overlapping," : "stopped and started,"} during \`${event.step}\``);
    }
  }
  lines.push("", "## Minutes", "", "| min | phase | open step | started | ended | events | model calls | compactions | error |", "|---|---|---|---|---|---|---|---|---|");
  for (const s of report.samples) {
    lines.push(`| ${s.elapsedMinutes} | ${s.phase} | ${s.openStep ?? ""} | ${s.stepsStarted} | ${s.stepsEnded} | ${s.sessionEvents} | ${s.modelCalls ?? "n/a"} | ${s.compactions ?? "n/a"} | ${tableCell(s.error)} |`);
  }
  return `${lines.join("\n")}\n`;
}

/** Text as one Markdown table cell: backslashes and pipes escaped (backslashes first), cut to 120 characters. */
function tableCell(text: string): string {
  return text.slice(0, 120).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/** Write the report and its summary into `dir`, each whole (a temporary file, then a rename). */
export async function writeLongTurnReport(dir: string, report: LongTurnReport): Promise<void> {
  for (const [name, body] of [
    ["report.json", `${JSON.stringify(report, null, 2)}\n`],
    ["summary.md", renderSummary(report)],
  ] as const) {
    const file = join(dir, name);
    await writeFile(`${file}.tmp`, body);
    await rename(`${file}.tmp`, file);
  }
}
