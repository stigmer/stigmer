// The real-clock run's report: one sample a minute, the run's end, and the
// transcript check, written whole every minute so a run that is stopped
// still leaves one.
// Domain: conformance long turn (the real-clock run's report).
//
// A stopped benchmark wrote nothing (stigmer#2011); this report is rewritten
// after every sample, as `report.json` beside a Markdown `summary.md`, each
// through a temporary file and a rename, so a reader never sees half of one.

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
  /** Absent while the run is going. */
  readonly end?: {
    readonly phase: string;
    readonly error: string;
    readonly elapsedMinutes: number;
    /** The step open when the turn stopped, or the last that ended. */
    readonly atStep: string | undefined;
    readonly stepsEnded: number;
    readonly stoppedByBudget: boolean;
    readonly transcript: TranscriptCheck | undefined;
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

export function transcriptCheckOf(seqs: readonly number[]): TranscriptCheck {
  return {
    events: seqs.length,
    firstSeq: seqs.length === 0 ? 0 : Math.min(...seqs),
    lastSeq: seqs.length === 0 ? 0 : Math.max(...seqs),
    gaps: seqGapsOf(seqs),
  };
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
    if (end.error !== "") lines.push("", `Error: ${end.error}`);
    if (end.transcript !== undefined) {
      const t = end.transcript;
      lines.push(
        "",
        t.gaps.length === 0
          ? `Transcript: ${t.events} events, seq ${t.firstSeq} to ${t.lastSeq}, unbroken.`
          : `Transcript: ${t.events} events, seq ${t.firstSeq} to ${t.lastSeq}, gaps ${t.gaps.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ")}.`,
      );
    }
  }
  for (const note of report.notes) lines.push("", `Note: ${note}`);
  if (report.runnerEvents.length > 0) {
    lines.push("", "## Runner ends", "");
    for (const event of report.runnerEvents) lines.push(`- minute ${event.elapsedMinutes}: ${event.signal} during \`${event.step}\``);
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
