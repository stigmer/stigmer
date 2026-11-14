// What `stigmer load-test` reports: each run's start and ending, read apart,
// and the burst's summary, as a table with sentences or as one JSON (or
// YAML) document. Pure: the engine (burst.ts) hands in what it saw, and this
// module decides the words.
//
// A run's start is one of five words. `started` once the runner stamped
// `status.started_at`; `refused` when the create itself was answered with an
// error (its code and the server's own sentence, verbatim, so a plan's limit
// reads in the server's words without this tool knowing them); `wait ran out`
// when the run ended `no_sandbox_room`; `never started` for any other ending
// before a start; `still waiting` when the watch ended first.
//
// Two times per run, both from the server's side, never this machine's clock:
//   - to start: `status.started_at` (the runner) minus
//     `status.audit.spec_audit.created_at` (the server, when it accepted the
//     message). A `started_at` written without milliseconds (it is a
//     string; the create's stamp is a Timestamp), or a negative difference,
//     is "unclear" and left out of the figures.
//   - waited for a sandbox: the longest `awaiting_sandbox_for` the run's
//     liveness carried. The server's own number counts from its first "no
//     room" to the answer that found room, and liveness is sent on each "no
//     room" answer, at most one backoff (15 s) apart, so the server's figure
//     is at least this one and at most "to start": the report writes "≥".
//     Liveness is the serving process's memory, so the report says a run
//     "reported" a wait, and when none did it says so in its own line: a
//     fleet that cannot run out of room never reads as one that held.
//
// Spend is the sum of the runs' own estimates
// (`status.streaming_usage.estimated_cost_usd`), the number each run's
// budget share is enforced against.

import { timestampMs } from "@bufbuild/protobuf/wkt";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { formatElapsed, turnPhaseOf } from "@stigmer/client";
import { stringify } from "yaml";
import type { OutputFormat } from "../../output/index.js";
import { renderTable } from "../../output/index.js";

/** How a run's start went. */
export type StartOutcome = "started" | "refused" | "wait ran out" | "never started" | "still waiting";

/** The server's answer to a create it refused: its code word and its own sentence. */
export interface Refusal {
  readonly code: string;
  readonly message: string;
}

/** What the engine saw of one run. */
export interface RunSighting {
  /** 1-based, in the order the creates were sent. */
  readonly index: number;
  /** The create's refusal; the run was never made. */
  readonly refusal?: Refusal;
  /** The run as read after the watch; absent when it was refused, or could not be read. */
  readonly run?: Run;
  readonly runId: string;
  readonly sessionId: string;
  /** The longest wait for a sandbox any liveness frame carried, in ms; undefined when none was reported. */
  readonly waitedMs?: number;
}

/** One run's row of the report. */
export interface RunOutcome {
  readonly index: number;
  readonly runId: string;
  readonly sessionId: string;
  readonly start: StartOutcome;
  /** Ms from the message accepted to the agent starting; null when not started or unclear. */
  readonly toStartMs: number | null;
  /** Whether a started run's stamps were too coarse, or out of order, to time it. */
  readonly toStartUnclear: boolean;
  /** The longest wait for a sandbox the run reported, in ms (at least); null when it reported none. */
  readonly waitedForRoomMs: number | null;
  /** How a started run ended, or what ended one that never started; "" while it works or when refused. */
  readonly ending: string;
  readonly stopCause: string;
  readonly stopKind: string;
  /** The run's own spend estimate in USD; null when it has none. */
  readonly costUsd: number | null;
  readonly refusal: Refusal | null;
}

/** Median, 90th percentile (nearest rank) and longest of a set of times, in ms. */
export interface Figures {
  readonly median: number | null;
  readonly p90: number | null;
  readonly longest: number | null;
}

/** The whole report, as `-o json` prints it. */
export interface LoadTestReport {
  readonly server: string;
  readonly org: string;
  readonly agent: string;
  readonly requested: number;
  readonly budgetUsd: number;
  readonly shareUsd: number;
  readonly counts: {
    readonly started: number;
    readonly refused: number;
    readonly waitRanOut: number;
    readonly neverStarted: number;
    readonly stillWaiting: number;
  };
  readonly toStartMs: Figures & { readonly unclear: number };
  readonly waitedForRoomMs: Figures & { readonly runs: number };
  readonly anyWaitReported: boolean;
  readonly refusals: ReadonlyArray<Refusal & { readonly count: number }>;
  readonly spentUsd: number;
  readonly runs: readonly RunOutcome[];
  /** What cleanup could not delete, as "<kind> <id>". */
  readonly leftBehind: readonly string[];
}

/** The burst's frame: where it ran and what it was allowed to spend. */
export interface BurstFrame {
  readonly server: string;
  readonly org: string;
  readonly agent: string;
  readonly requested: number;
  readonly budgetUsd: number;
  readonly shareUsd: number;
}

const NO_SANDBOX_ROOM = "no_sandbox_room";
const COST_CAP = "cost_cap";

// A stamp's fraction of a second: three digits or more is millisecond-precise.
const FRACTION = /\.(\d+)/;

/** One run's row, from what the engine saw. */
export function outcomeOf(sighting: RunSighting): RunOutcome {
  const base = {
    index: sighting.index,
    runId: sighting.runId,
    sessionId: sighting.sessionId,
    waitedForRoomMs: sighting.waitedMs ?? null,
  };
  if (sighting.refusal !== undefined) {
    return { ...base, start: "refused", toStartMs: null, toStartUnclear: false, ending: "", stopCause: "", stopKind: "", costUsd: null, refusal: sighting.refusal };
  }
  const status = sighting.run?.status;
  const stopCause = status?.stopCause ?? "";
  const stopKind = status?.stopDetail?.kind ?? "";
  const phase = turnPhaseOf(status?.phase ?? 0);
  const ended = phase === "completed" || phase === "failed" || phase === "cancelled" || phase === "terminated";
  const cost = status?.streamingUsage?.estimatedCostUsd;
  const common = { ...base, stopCause, stopKind, costUsd: cost === undefined ? null : cost, refusal: null };
  const startedAt = status?.startedAt ?? "";
  if (startedAt !== "") {
    const toStart = toStartOf(sighting.run, startedAt);
    return {
      ...common,
      start: "started",
      toStartMs: toStart,
      toStartUnclear: toStart === null,
      ending: ended ? endingOf(phase, stopCause, stopKind) : "",
    };
  }
  const notStarted = { ...common, toStartMs: null, toStartUnclear: false };
  if (stopKind === NO_SANDBOX_ROOM) return { ...notStarted, start: "wait ran out", ending: "" };
  if (ended) return { ...notStarted, start: "never started", ending: endingOf(phase, stopCause, stopKind) };
  return { ...notStarted, start: "still waiting", ending: "" };
}

/** The report of a burst: every run's row, the counts, the figures and the spend. */
export function buildReport(frame: BurstFrame, sightings: readonly RunSighting[], leftBehind: readonly string[]): LoadTestReport {
  const runs = sightings.map(outcomeOf);
  const count = (start: StartOutcome): number => runs.filter((run) => run.start === start).length;
  const started = runs.filter((run) => run.start === "started");
  const waits = runs.flatMap((run) => (run.waitedForRoomMs === null ? [] : [run.waitedForRoomMs]));
  return {
    ...frame,
    counts: {
      started: started.length,
      refused: count("refused"),
      waitRanOut: count("wait ran out"),
      neverStarted: count("never started"),
      stillWaiting: count("still waiting"),
    },
    toStartMs: {
      ...figuresOf(started.flatMap((run) => (run.toStartMs === null ? [] : [run.toStartMs]))),
      unclear: started.filter((run) => run.toStartUnclear).length,
    },
    waitedForRoomMs: { ...figuresOf(waits), runs: waits.length },
    anyWaitReported: waits.length > 0,
    refusals: groupRefusals(runs),
    spentUsd: runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0),
    runs,
    leftBehind,
  };
}

/** The report in the asked format: table and summary, or the JSON or YAML document. */
export function renderReport(report: LoadTestReport, format: OutputFormat): string {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format === "yaml") return stringify(report);
  return `${renderRuns(report.runs)}\n${summaryLines(report).join("\n")}\n`;
}

/** The burst's summary sentences, in the order the report prints them. */
export function summaryLines(report: LoadTestReport): string[] {
  const lines = [countsLine(report)];
  const toStart = report.toStartMs;
  if (toStart.median !== null) {
    lines.push(`To start: ${figuresText(toStart)}.`);
  }
  if (toStart.unclear > 0) {
    lines.push(`To start was unclear for ${plural(toStart.unclear, "run")}: a stamp was too coarse to time it.`);
  }
  if (report.anyWaitReported) {
    const waited = report.waitedForRoomMs;
    lines.push(`Waited for a sandbox, ${plural(waited.runs, "run")}: ${figuresText(waited)} (at least).`);
  } else {
    lines.push("No run reported waiting for a sandbox during the burst.");
  }
  for (const refusal of report.refusals) {
    lines.push(`Refused ${refusal.count}: ${refusal.code}, "${refusal.message}"`);
  }
  lines.push(`Spent about ${usd(report.spentUsd)}, by the runs' own estimates.`);
  return lines;
}

/** A dollar amount: cents, or four places below a cent so a tiny spend is not "$0.00". */
export function usd(amount: number): string {
  return amount > 0 && amount < 0.01 ? `$${amount.toFixed(4)}` : `$${amount.toFixed(2)}`;
}

function renderRuns(runs: readonly RunOutcome[]): string {
  const rows = runs.map((run) => [
    String(run.index),
    run.start,
    run.toStartUnclear ? "unclear" : duration(run.toStartMs),
    run.waitedForRoomMs === null ? "-" : `≥ ${formatElapsed(run.waitedForRoomMs)}`,
    run.ending === "" ? "-" : run.ending,
    run.costUsd === null ? "-" : usd(run.costUsd),
  ]);
  return renderTable(["#", "START", "TO START", "WAITED FOR A SANDBOX", "ENDING", "COST"], rows);
}

function countsLine(report: LoadTestReport): string {
  const { counts } = report;
  const parts = [
    `${counts.started} started`,
    counts.refused > 0 ? `${counts.refused} refused` : "",
    counts.waitRanOut > 0 ? `${counts.waitRanOut} wait ran out` : "",
    counts.neverStarted > 0 ? `${counts.neverStarted} never started` : "",
    counts.stillWaiting > 0 ? `${counts.stillWaiting} still waiting` : "",
  ].filter((part) => part !== "");
  return `${plural(report.requested, "agent")}: ${parts.join(", ")}.`;
}

function figuresText(figures: Figures): string {
  return `median ${duration(figures.median)}, 90th percentile ${duration(figures.p90)}, longest ${duration(figures.longest)}`;
}

function duration(ms: number | null): string {
  return ms === null ? "-" : formatElapsed(ms);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// How an ended run ended, in the report's words: a completion, its budget,
// or the stop's cause and kind as the run names them.
function endingOf(phase: string | undefined, stopCause: string, stopKind: string): string {
  if (stopKind === COST_CAP) return "stopped at its budget";
  if (stopCause === "" && phase === "completed") return "completed";
  const cause = stopCause === "" ? (phase ?? "ended") : stopCause;
  return stopKind === "" ? cause : `${cause} (${stopKind})`;
}

// `started_at` minus the create's stamp, when `started_at` is
// millisecond-precise and the pair is in order; null otherwise.
function toStartOf(run: Run | undefined, startedAt: string): number | null {
  const created = run?.status?.audit?.specAudit?.createdAt;
  const fraction = FRACTION.exec(startedAt);
  if (created === undefined || fraction === null || fraction[1].length < 3) return null;
  const started = Date.parse(startedAt);
  const ms = started - timestampMs(created);
  return Number.isNaN(started) || ms < 0 ? null : ms;
}

function figuresOf(values: readonly number[]): Figures {
  if (values.length === 0) return { median: null, p90: null, longest: null };
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number): number => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return { median: rank(0.5), p90: rank(0.9), longest: sorted[sorted.length - 1] };
}

function groupRefusals(runs: readonly RunOutcome[]): Array<Refusal & { count: number }> {
  const groups = new Map<string, Refusal & { count: number }>();
  for (const run of runs) {
    if (run.refusal === null) continue;
    const key = `${run.refusal.code}\u0000${run.refusal.message}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { ...run.refusal, count: 1 });
    else group.count += 1;
  }
  return [...groups.values()];
}
