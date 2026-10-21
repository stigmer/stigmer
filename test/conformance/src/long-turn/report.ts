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

import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  /** What the streaming follower was sent; absent when none ran. */
  readonly follower?: FollowerCheck;
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

export function transcriptCheckOf(seqs: readonly number[]): TranscriptCheck {
  return {
    events: seqs.length,
    firstSeq: seqs.length === 0 ? 0 : Math.min(...seqs),
    lastSeq: seqs.length === 0 ? 0 : Math.max(...seqs),
    gaps: seqGapsOf(seqs),
  };
}

/** What the follower was sent (`followed`, in arrival order) against the log's seqs, with the endings it resumed from. */
export function followerCheckOf(followed: readonly number[], logged: readonly number[], endings: readonly string[]): FollowerCheck {
  const seen = new Map<number, number>();
  for (const seq of followed) seen.set(seq, (seen.get(seq) ?? 0) + 1);
  const onLog = new Set(logged);
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
    if (end.compactions !== undefined) lines.push("", `Model calls: ${end.modelCalls ?? 0}; compactions: ${end.compactions}.`);
    if (end.error !== "") lines.push("", `Error: ${end.error}`);
    if (end.reply !== undefined && end.reply !== "") lines.push("", `Reply: ${end.reply.length > 600 ? `${end.reply.slice(0, 600)}…` : end.reply}`);
    if (end.transcript !== undefined) {
      const t = end.transcript;
      lines.push(
        "",
        t.gaps.length === 0
          ? `Transcript: ${t.events} events, seq ${t.firstSeq} to ${t.lastSeq}, unbroken.`
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
