// Compares benchmark reports arm by arm and says, cell by cell, whether each
// arm holds the bar a reference arm sets (`npm run benchmark:compare`, a thin
// script over this module). Domain: conformance benchmark (the readout).
//
// An arm is a harness on one model at one endpoint, on one version of the
// code: native on the report's `models.parity_native` at its
// `models.native_endpoint`, or Cursor on `models.parity_cursor`, each on the
// report's `git.code_sha` (the server and runner it booted; the script's
// `--stack`). One run measures one native model on one version of the code
// (cells.ts, run.ts), so another model or another version is another report,
// and the comparison is across reports. Reports are compared only when one
// instrument measured them on the same ground: one clean `git.head_sha` (the
// tree the script ran from, whose clients and readers did the measuring),
// the same `methodology.reps`, `methodology.quality_reps` and thinking mode,
// one `host`, and timestamps within COMPARABLE_WINDOW_MS of each other.
// Anything else is refused by naming the field, because a gap between arms
// taken by different instruments, on different machines or days measures
// those differences too; a `-dirty` instrument is refused by name, because no
// commit names what measured. Reports of one arm pool: a scenario measured in
// more than one is read from the latest (a re-run replaces), and so is the
// arm's quality target. Two versions of the code are two arms, never one,
// and so is a native report taken with the runner's background commands
// turned off (`methodology.shell_background`): `+background-off`, read beside
// the arm with them on rather than pooled into it.
//
// Each report's runner marker counts (`runner_log`, per run, every cell and
// the quality arm together) are printed beside the arms, and never gated.
//
// The bar is fixed before any number is read, and is three clauses per arm
// against the reference:
// - Quality: the mean of the cases' `aggregates.score` over the cases graded
//   on both arms (the eval run's result document scores each case itself; an
//   ungraded case is `null` and left out) is at least the reference's minus
//   QUALITY_TOLERANCE. pass^k counts are printed beside it.
// - Failures, per timing cell: no more failed samples than the reference's.
// - Rounds wasted, per timing cell: the share of settled primary-thread tool
//   calls (sampled and sibling turns) that ended `not_found`, `not_unique` or
//   `failed` is at most the reference's plus WASTE_TOLERANCE. `skipped` and
//   `unsettled` calls are not settled by the model and are left out.
// Timing, rounds, cost and the input-token median are printed and never
// gated: on another model they measure the model's speed and price, not the
// engine, and between two arms of one model the input tokens show what a
// longer tool declaration costs every turn. So is what each arm did with
// background commands, cell by cell (`background-readings.ts`
// `summarizeBackground`), printed whenever an arm's samples carry it. A cell with fewer than
// MIN_SAMPLES samples that ran (a sample that failed at create is the
// benchmark's stack, not the arm, and is left out of both clauses), or a
// quality reading over fewer than MIN_SAMPLES cases graded on both arms,
// reads "not measured". A cell the reference measured and the arm's own
// report refused by design (a flag, or the pinned native model) is expected,
// not unmeasured. An arm holds the bar when no clause misses and every
// clause was measured.
//
// Pure: reports in, a comparison out; the script reads the files and prints.
import { summarizeBackground, type BackgroundSummary } from "./background-readings";
import { PARITY_MODEL } from "./cells";
import { renderRunnerLog } from "./log-markers";
import type {
  BenchmarkComparison,
  BenchmarkHarness,
  BenchmarkReport,
  BenchmarkSample,
  BenchmarkStat,
  RefusalReason,
  RunnerLogMarkers,
  ToolCallFact,
} from "./report";

/** At least this many samples (or cases graded on both arms) on each side, or the clause is "not measured". */
export const MIN_SAMPLES = 3;
/** The quality mean may sit this far below the reference's. */
export const QUALITY_TOLERANCE = 0.05;
/** The wasted share of tool calls may sit this many points (as a fraction) above the reference's. */
export const WASTE_TOLERANCE = 0.05;
/** Reports taken further apart than this are not compared. */
export const COMPARABLE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Refusals a report makes by design, which never mean a cell went unmeasured. */
export const EXPECTED_REFUSALS: ReadonlySet<RefusalReason> = new Set<RefusalReason>([
  "excluded by --only",
  "excluded by --cells",
  "the native model is pinned by --native-model",
  "thinking needs a pinned model",
  "thinking needs a catalog Claude model",
  "runs only when --cells names it",
]);

/** A report as read, with the path it was read from (for refusals that name it). */
export interface ComparedReport {
  path: string;
  report: BenchmarkReport;
}

export type ClauseStatus = "holds" | "misses" | "not measured";

export interface CellReading {
  scenario: string;
  /** "expected refusal" when the arm's report refused the cell by design. */
  status: ClauseStatus | "expected refusal";
  why: string;
  failures?: { arm: number; reference: number; status: ClauseStatus };
  wasted?: { arm: number; reference: number; status: ClauseStatus };
  /** Printed, never gated: the medians of each side. */
  printed?: { arm: PrintedAxes; reference: PrintedAxes };
  /** Printed, never gated: what each side did with background commands, over its samples that ran. */
  background?: { arm: BackgroundSummary | null; reference: BackgroundSummary | null };
}

export interface PrintedAxes {
  end_to_end_ms: number | null;
  rounds: number | null;
  estimated_cost_micros: number | null;
  input_tokens: number | null;
}

export interface QualityReading {
  status: ClauseStatus;
  why: string;
  /** Cases graded on both arms. */
  cases: number;
  armMean: number | null;
  referenceMean: number | null;
  passK: { arm: number; reference: number };
}

export interface ArmReading {
  arm: string;
  verdict: "holds the bar" | "misses the bar" | "not measured";
  quality: QualityReading;
  cells: CellReading[];
}

/** One report's runner marker counts, with the arms it measured: printed, never gated. */
export interface RunnerLogReading {
  path: string;
  arms: string[];
  markers: RunnerLogMarkers;
}

export interface ReportComparison {
  reference: string;
  /** Every arm the reports carry, the reference included. */
  arms: string[];
  readings: ArmReading[];
  /** Per report, in time order. */
  runnerLogs: RunnerLogReading[];
}

/** One arm's data, pooled over its reports. */
interface PooledArm {
  label: string;
  harness: BenchmarkHarness;
  model: string;
  /** Per scenario, the latest report's stat for this arm. */
  stats: Map<string, { stat: BenchmarkStat; comparison: BenchmarkComparison }>;
  /** Per cell id, the reasons the arm's reports refused it. */
  refused: Map<string, RefusalReason[]>;
  /** The arm's cases in the latest report whose quality document carries its target. */
  cases: QualityCase[] | null;
}

interface QualityCase {
  name: string;
  score: number | null;
  passK: boolean;
}

/** `native/<model>@<endpoint>#<code>`, with `+background-off` when the runner's background commands were off, or `cursor/<model>#<code>`; the code as the first ten characters of `git.code_sha`. */
export function armLabel(report: BenchmarkReport, harness: BenchmarkHarness): string {
  const code = `#${shortSha(report.git.code_sha)}`;
  if (harness === "cursor") return `cursor/${report.models.parity_cursor}${code}`;
  const off = report.methodology.shell_background === "off" ? "+background-off" : "";
  return `native/${report.models.parity_native}@${report.models.native_endpoint}${code}${off}`;
}

/** A SHA's first ten characters, keeping a `-dirty` mark. */
function shortSha(sha: string): string {
  const dirty = sha.endsWith("-dirty");
  return `${sha.replace(/-dirty$/, "").slice(0, 10)}${dirty ? "-dirty" : ""}`;
}

/**
 * Refuses reports that cannot be compared, naming the field and the two
 * reports that differ on it.
 */
export function assertComparable(reports: readonly ComparedReport[]): void {
  if (reports.length === 0) throw new Error("no reports to compare");
  for (const { path, report } of reports) {
    if (report.git.head_sha.endsWith("-dirty")) {
      throw new Error(
        `report was measured by an instrument with uncommitted changes (git.head_sha ${report.git.head_sha}): ${path}; commit the instrument and measure again`,
      );
    }
  }
  const first = reports[0]!;
  const fields: [string, (report: BenchmarkReport) => string | number][] = [
    ["git.head_sha", (report) => report.git.head_sha],
    ["methodology.reps", (report) => report.methodology.reps],
    ["methodology.quality_reps", (report) => report.methodology.quality_reps],
    ["methodology.thinking_mode", (report) => report.methodology.thinking_mode ?? "default"],
    ["host", (report) => `${report.host.platform} ${report.host.node}`],
  ];
  for (const other of reports.slice(1)) {
    for (const [field, read] of fields) {
      if (read(first.report) !== read(other.report)) {
        throw new Error(
          `reports differ on ${field}: ${JSON.stringify(read(first.report))} (${first.path}) and ${JSON.stringify(read(other.report))} (${other.path})`,
        );
      }
    }
  }
  const times = reports.map((entry) => ({ path: entry.path, ms: Date.parse(entry.report.timestamp) }));
  for (const time of times) {
    if (Number.isNaN(time.ms)) throw new Error(`report timestamp is not a time: ${time.path}`);
  }
  const earliest = times.reduce((a, b) => (b.ms < a.ms ? b : a));
  const latest = times.reduce((a, b) => (b.ms > a.ms ? b : a));
  if (latest.ms - earliest.ms > COMPARABLE_WINDOW_MS) {
    throw new Error(
      `reports differ on timestamp by more than ${COMPARABLE_WINDOW_MS / 3_600_000} hours: ${earliest.path} and ${latest.path}`,
    );
  }
}

/**
 * Reads every arm against `reference` (an arm label, or a prefix of one that
 * ends where the label's endpoint or code begins or inside its code, when one
 * arm matches; default native on PARITY_MODEL["deep-agent"]).
 */
export function compareReports(reports: readonly ComparedReport[], reference?: string): ReportComparison {
  assertComparable(reports);
  const arms = poolArms(reports);
  const labels = [...arms.keys()];
  const referenceLabel = resolveReference(labels, reference ?? `native/${PARITY_MODEL["deep-agent"]}`);
  const referenceArm = arms.get(referenceLabel)!;
  const readings = labels
    .filter((label) => label !== referenceLabel)
    .map((label) => readArm(arms.get(label)!, referenceArm));
  return { reference: referenceLabel, arms: labels, readings, runnerLogs: runnerLogsOf(reports) };
}

function runnerLogsOf(reports: readonly ComparedReport[]): RunnerLogReading[] {
  return [...reports]
    .sort((a, b) => Date.parse(a.report.timestamp) - Date.parse(b.report.timestamp))
    .map(({ path, report }) => ({
      path,
      arms: (["deep-agent", "cursor"] as const)
        .filter((harness) => report.comparisons.some((comparison) => sideOf(comparison, harness) !== undefined) || qualityCases(report, harness) !== null)
        .map((harness) => armLabel(report, harness)),
      markers: report.runner_log,
    }));
}

function resolveReference(labels: readonly string[], wanted: string): string {
  if (labels.includes(wanted)) return wanted;
  const inCode = wanted.includes("#");
  const matches = labels.filter(
    (label) => label.startsWith(`${wanted}@`) || label.startsWith(`${wanted}#`) || (inCode && label.startsWith(wanted)),
  );
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new Error(`reference ${wanted} matches several arms: ${matches.join(", ")}; name one`);
  throw new Error(`no report carries the reference arm ${wanted} (arms: ${labels.join(", ") || "none"})`);
}

function poolArms(reports: readonly ComparedReport[]): Map<string, PooledArm> {
  const ordered = [...reports].sort((a, b) => Date.parse(a.report.timestamp) - Date.parse(b.report.timestamp));
  const arms = new Map<string, PooledArm>();
  const armFor = (report: BenchmarkReport, harness: BenchmarkHarness): PooledArm => {
    const label = armLabel(report, harness);
    let arm = arms.get(label);
    if (arm === undefined) {
      const model = harness === "deep-agent" ? report.models.parity_native : report.models.parity_cursor;
      arm = { label, harness, model, stats: new Map(), refused: new Map(), cases: null };
      arms.set(label, arm);
    }
    return arm;
  };
  for (const { report } of ordered) {
    for (const harness of ["deep-agent", "cursor"] as const) {
      const sides = report.comparisons.filter((comparison) => sideOf(comparison, harness) !== undefined);
      const cases = qualityCases(report, harness);
      if (sides.length === 0 && cases === null) continue;
      const arm = armFor(report, harness);
      for (const comparison of sides) arm.stats.set(comparison.scenario, { stat: sideOf(comparison, harness)!, comparison });
      if (cases !== null) arm.cases = cases;
      for (const refusal of report.refused) {
        if (!refusal.cell.endsWith(`/${harness}`)) continue;
        arm.refused.set(refusal.cell, [...(arm.refused.get(refusal.cell) ?? []), refusal.reason]);
      }
    }
  }
  return arms;
}

function sideOf(comparison: BenchmarkComparison, harness: BenchmarkHarness): BenchmarkStat | undefined {
  return harness === "deep-agent" ? comparison.native : comparison.cursor;
}

/** The arm's cases from the report's quality document, or `null` when the document carries no target for it. */
function qualityCases(report: BenchmarkReport, harness: BenchmarkHarness): QualityCase[] | null {
  const document = report.quality?.document;
  if (document === null || document === undefined) return null;
  const model = harness === "deep-agent" ? report.models.parity_native : report.models.parity_cursor;
  const wanted = `${harness === "deep-agent" ? "native" : "cursor"}/${model}`;
  const block = recordOf(arrayOf(document["plugins"])[0]);
  const target = arrayOf(block["targets"]).map(recordOf).find((entry) => entry["label"] === wanted);
  if (target === undefined) return null;
  return arrayOf(target["cases"]).map((entry) => {
    const evalCase = recordOf(entry);
    const score = recordOf(evalCase["aggregates"])["score"];
    return {
      name: typeof evalCase["name"] === "string" ? evalCase["name"] : "",
      score: typeof score === "number" ? score : null,
      passK: evalCase["passK"] === true,
    };
  });
}

function readArm(arm: PooledArm, reference: PooledArm): ArmReading {
  const quality = readQuality(arm, reference);
  const cells = [...reference.stats.keys()].map((scenario) => readCell(scenario, arm, reference));
  const statuses: (ClauseStatus | "expected refusal")[] = [quality.status, ...cells.map((cell) => cell.status)];
  const verdict = statuses.includes("misses")
    ? "misses the bar"
    : statuses.includes("not measured")
      ? "not measured"
      : "holds the bar";
  return { arm: arm.label, verdict, quality, cells };
}

function readQuality(arm: PooledArm, reference: PooledArm): QualityReading {
  const passK = { arm: (arm.cases ?? []).filter((c) => c.passK).length, reference: (reference.cases ?? []).filter((c) => c.passK).length };
  if (arm.cases === null || reference.cases === null) {
    const absent = arm.cases === null ? arm.label : reference.label;
    return { status: "not measured", why: `no quality target for ${absent}`, cases: 0, armMean: null, referenceMean: null, passK };
  }
  const referenceScores = new Map(reference.cases.map((c) => [c.name, c.score]));
  const pairs = arm.cases.flatMap((c) => {
    const theirs = referenceScores.get(c.name);
    return c.score !== null && typeof theirs === "number" ? [{ arm: c.score, reference: theirs }] : [];
  });
  if (pairs.length < MIN_SAMPLES) {
    return {
      status: "not measured",
      why: `${pairs.length} cases graded on both arms (need ${MIN_SAMPLES})`,
      cases: pairs.length,
      armMean: null,
      referenceMean: null,
      passK,
    };
  }
  const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  const armMean = mean(pairs.map((pair) => pair.arm));
  const referenceMean = mean(pairs.map((pair) => pair.reference));
  const holds = armMean >= referenceMean - QUALITY_TOLERANCE - 1e-9;
  return {
    status: holds ? "holds" : "misses",
    why: `mean ${armMean.toFixed(3)} against ${referenceMean.toFixed(3)} over ${pairs.length} cases (tolerance ${QUALITY_TOLERANCE})`,
    cases: pairs.length,
    armMean,
    referenceMean,
    passK,
  };
}

function readCell(scenario: string, arm: PooledArm, reference: PooledArm): CellReading {
  const ours = arm.stats.get(scenario)?.stat;
  const theirs = reference.stats.get(scenario)!.stat;
  if (ours === undefined) {
    const reasons = arm.refused.get(`${scenario}/${arm.harness}`) ?? [];
    const expected = reasons.find((reason) => EXPECTED_REFUSALS.has(reason));
    if (expected !== undefined) return { scenario, status: "expected refusal", why: expected };
    return { scenario, status: "not measured", why: reasons.length > 0 ? `refused: ${reasons.join("; ")}` : "absent from the arm's reports" };
  }
  const printed = { arm: printedAxes(ours), reference: printedAxes(theirs) };
  const ran = (stat: BenchmarkStat): BenchmarkSample[] => stat.samples.filter((sample) => sample.failure?.stage !== "create");
  const oursRan = ran(ours);
  const theirsRan = ran(theirs);
  const backgroundArm = summarizeBackground(oursRan);
  const backgroundReference = summarizeBackground(theirsRan);
  const background =
    backgroundArm === null && backgroundReference === null ? {} : { background: { arm: backgroundArm, reference: backgroundReference } };
  if (oursRan.length < MIN_SAMPLES || theirsRan.length < MIN_SAMPLES) {
    return {
      scenario,
      status: "not measured",
      why: `samples that ran: arm ${oursRan.length}, reference ${theirsRan.length} (need ${MIN_SAMPLES})`,
      printed,
      ...background,
    };
  }
  const failedOf = (samples: BenchmarkSample[]): number => samples.filter((sample) => sample.outcome !== "completed").length;
  const failuresArm = failedOf(oursRan);
  const failuresReference = failedOf(theirsRan);
  const failures = { arm: failuresArm, reference: failuresReference, status: (failuresArm <= failuresReference ? "holds" : "misses") as ClauseStatus };
  const wastedArm = wastedShare(oursRan);
  const wastedReference = wastedShare(theirsRan);
  const wasted = {
    arm: wastedArm,
    reference: wastedReference,
    status: (wastedArm <= wastedReference + WASTE_TOLERANCE + 1e-9 ? "holds" : "misses") as ClauseStatus,
  };
  const status: ClauseStatus = failures.status === "misses" || wasted.status === "misses" ? "misses" : "holds";
  return {
    scenario,
    status,
    why: `failed ${failuresArm} against ${failuresReference}; wasted ${percent(wastedArm)} against ${percent(wastedReference)}`,
    failures,
    wasted,
    printed,
    ...background,
  };
}

const WASTED: ReadonlySet<ToolCallFact["outcome"]> = new Set(["not_found", "not_unique", "failed"]);
const SETTLED: ReadonlySet<ToolCallFact["outcome"]> = new Set(["ok", "not_found", "not_unique", "failed"]);

/** Wasted over settled tool calls, sampled and sibling turns pooled; 0 when no call settled. */
export function wastedShare(samples: readonly BenchmarkSample[]): number {
  let settled = 0;
  let wasted = 0;
  for (const sample of samples) {
    const calls = [...sample.tool_calls, ...(sample.sibling_turns ?? []).flatMap((turn) => turn.tool_calls)];
    for (const call of calls) {
      if (!SETTLED.has(call.outcome)) continue;
      settled += 1;
      if (WASTED.has(call.outcome)) wasted += 1;
    }
  }
  return settled === 0 ? 0 : wasted / settled;
}

function printedAxes(stat: BenchmarkStat): PrintedAxes {
  return {
    end_to_end_ms: stat.median?.end_to_end_ms ?? null,
    rounds: stat.median?.rounds ?? null,
    estimated_cost_micros: stat.median?.estimated_cost_micros ?? null,
    input_tokens: stat.median?.tokens.input ?? null,
  };
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/** The comparison as Markdown: one block per arm, its verdict, the quality line and one row per cell. */
export function renderComparison(comparison: ReportComparison, reports: readonly ComparedReport[]): string {
  const lines: string[] = [];
  const first = reports[0]!.report;
  lines.push(
    `Reference: ${comparison.reference}; instrument ${first.git.head_sha.slice(0, 10)}, ${first.methodology.reps} reps, ${first.methodology.quality_reps} quality tries, ${first.host.platform} ${first.host.node}`,
  );
  const costBasis = new Map<string, string>();
  for (const { report } of reports) costBasis.set(armLabel(report, "deep-agent"), report.models.native_cost_basis);
  const cost = (label: string, value: number | null): string => {
    if (value === null) return "n/a";
    return `${Math.round(value)}${costBasis.get(label) === "default-rate" ? "*" : ""}`;
  };
  const number = (value: number | null): string => (value === null ? "n/a" : String(Math.round(value)));
  for (const reading of comparison.readings) {
    lines.push("", `## ${reading.arm}: ${reading.verdict}`, "");
    const q = reading.quality;
    lines.push(`Quality: ${q.status} (${q.why}); pass^k ${q.passK.arm} against ${q.passK.reference}`, "");
    lines.push(
      "| cell | status | failed | wasted calls | e2e ms | rounds | est. cost µ$ | input tokens | why |",
      "|---|---|---|---|---|---|---|---|---|",
    );
    for (const cell of reading.cells) {
      const pair = (a: string, b: string): string => `${a} / ${b}`;
      const failed = cell.failures === undefined ? "n/a" : pair(String(cell.failures.arm), String(cell.failures.reference));
      const wasted = cell.wasted === undefined ? "n/a" : pair(percent(cell.wasted.arm), percent(cell.wasted.reference));
      const p = cell.printed;
      lines.push(
        `| ${cell.scenario} | ${cell.status} | ${failed} | ${wasted} | ${p === undefined ? "n/a" : pair(number(p.arm.end_to_end_ms), number(p.reference.end_to_end_ms))} | ${p === undefined ? "n/a" : pair(number(p.arm.rounds), number(p.reference.rounds))} | ${p === undefined ? "n/a" : pair(cost(reading.arm, p.arm.estimated_cost_micros), cost(comparison.reference, p.reference.estimated_cost_micros))} | ${p === undefined ? "n/a" : pair(number(p.arm.input_tokens), number(p.reference.input_tokens))} | ${cell.why} |`,
      );
    }
    lines.push(...renderBackgroundReadings(reading.cells));
  }
  lines.push("", "## Runner log, per run (printed, never gated)", "");
  for (const reading of comparison.runnerLogs) {
    lines.push(`- ${reading.arms.join(", ") || "no arm"} (${reading.path}): ${renderRunnerLog(reading.markers)}`);
  }
  if ([...costBasis.values()].includes("default-rate")) {
    lines.push("", "* the runner's default rate, not a price: the arm's model has no priced catalog row.");
  }
  lines.push("", "Each pair is arm / reference. Timing, rounds and cost are printed, never gated.");
  return lines.join("\n");
}

/** One arm's background table: each cell's summary, arm / reference; nothing when no cell carries one. */
function renderBackgroundReadings(cells: readonly CellReading[]): string[] {
  const rows = cells.filter((cell) => cell.background !== undefined);
  if (rows.length === 0) return [];
  const value = (n: number | null | undefined): string => (n === null || n === undefined ? "n/a" : String(Math.round(n)));
  const pair = (read: (summary: BackgroundSummary) => string, cell: CellReading): string => {
    const side = (summary: BackgroundSummary | null | undefined): string => (summary === null || summary === undefined ? "n/a" : read(summary));
    return `${side(cell.background?.arm)} / ${side(cell.background?.reference)}`;
  };
  return [
    "",
    "Background commands, over the samples that ran:",
    "",
    "| cell | used | starts | polls median (max) | worked while running ms | waits | reminders | own & | fg timeouts | would pause | left running | task done |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map(
      (cell) =>
        `| ${cell.scenario} | ${pair((s) => `${s.used}/${s.ran}`, cell)} | ${pair((s) => String(s.starts), cell)} | ${pair((s) => `${value(s.polls_median)} (${value(s.polls_max)})`, cell)} | ${pair((s) => value(s.worked_while_running_ms), cell)} | ${pair((s) => String(s.waits), cell)} | ${pair((s) => String(s.reminders), cell)} | ${pair((s) => String(s.self_backgrounded), cell)} | ${pair((s) => String(s.foreground_timeouts), cell)} | ${pair((s) => String(s.gated_while_running), cell)} | ${pair((s) => String(s.orphans), cell)} | ${pair((s) => (s.task_done === null ? "n/a" : `${s.task_done.done}/${s.task_done.of}`), cell)} |`,
    ),
  ];
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
