// `agent quality` dispatch: how one agent's runs in the active
// organization were graded over the last few days, or, with `--flagged`,
// the failed grades behind those numbers.
//
// The report counts three metrics: the platform's run-health checks, the AI
// judge's rubrics and people's thumbs (up counts as passed, down as
// failed). The table shows the window's totals, then one row per agent
// version, most recently seen first, named by its tag when the agent's
// history has one, else by the short hash the Versions tab shows. A rate is
// never printed without the counts it divides, and a metric graded by two
// versions of its checks or rubrics shows the current one (the first the
// server lists) and says that older ones exist, since two versions' grades
// are never added together.
//
// `--agreement` reads the same report and shows its agreement part: per
// version of the judge's rubrics, for the runs that have both a judge grade
// and a person's thumbs, how each rubric's verdicts line up with the
// thumbs. A rubric that fails runs people liked may be too strict; one that
// passes runs people disliked may be too lenient; runs people disliked
// where no rubric failed point at a failure no rubric catches. Counts and
// rubric names only, like the rest of the report.
//
// `--flagged` reads up to `--limit` failed grades of runs the caller can
// open, newest first, through the cursor walk every paged list uses: the
// server may answer a short page, even an empty one, with a token, and that
// is followed, not shown as the end. A row names the failed criteria only:
// never a reason or a comment, which may quote the conversation.
//
// `-o json` and `-o yaml` print the server's report (or the flagged scores)
// undecorated, as `usage agent` prints its report. The days and the limit
// are checked here, before any request, so a bad flag is refused with the
// accepted range rather than a validation error from the server.

import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ListAgentVersionsInputSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import { ScoreSchema, type Score } from "@stigmer/apis/ai/stigmer/agentic/score/v1/api_pb";
import { CriterionResult } from "@stigmer/apis/ai/stigmer/agentic/score/v1/enum_pb";
import {
  AgentQualityReportSchema,
  GetAgentQualityReportRequestSchema,
  ListFlaggedScoresByAgentRequestSchema,
  JudgeAgreementSchema,
  type AgentQualityReport,
  type JudgeAgreement,
  type MetricTally,
  type QualitySummary,
} from "@stigmer/apis/ai/stigmer/agentic/score/v1/io_pb";
import type { Stigmer } from "@stigmer/client";
import { requireOrganization } from "../../client/single-org.js";
import { UsageError } from "../../errors/index.js";
import {
  type OutputFormat,
  renderEmpty,
  renderProtoJson,
  renderProtoListJson,
  renderProtoListYaml,
  renderProtoYaml,
  renderTable,
  terminalWidth,
  type TerminalStream,
} from "../../output/index.js";
import { readCursorPages } from "../cursor-pages.js";
import { oneLine } from "../run-scores.js";
import { resolveAgent } from "./resolve.js";

/** The days a report counts when `--days` is not given. */
export const DEFAULT_DAYS = 30;

/** The most days the server counts. */
export const MAX_DAYS = 90;

/** The flagged grades `--flagged` lists when `--limit` is not given. */
export const DEFAULT_FLAGGED_LIMIT = 20;

/** How many hex characters of a version hash a label shows, as the console's Versions tab does. */
const SHORT_HASH_LENGTH = 12;

/** How many entries of the agent's history are read to name versions by tag. */
const VERSION_HISTORY_PAGE_SIZE = 50;

/** The metrics the report counts, by their wire names. */
const RUN_HEALTH = "run-health";
const JUDGE = "judge";
const FEEDBACK = "feedback";

/** The commands that set the organization the report is read in, when none is set. */
const SET_ORG_WITH = ["stigmer config context set --org <org>", "stigmer agent quality --org <org> <agent>"] as const;

/** `agent quality`'s flags as commander parses them. */
export interface AgentQualityFlags {
  readonly days?: string;
  readonly flagged?: boolean;
  readonly limit?: string;
  readonly agreement?: boolean;
}

/** `agent quality`'s options, checked. */
export interface AgentQualityOptions {
  readonly days: number;
  readonly flagged: boolean;
  readonly agreement: boolean;
  /** The most flagged grades to list; zero lists them all. */
  readonly limit: number;
  readonly format: OutputFormat;
}

/** Checks the flags, refusing a value out of range with the range it accepts. */
export function readAgentQualityOptions(flags: AgentQualityFlags, format: OutputFormat): AgentQualityOptions {
  const flagged = flags.flagged === true;
  const agreement = flags.agreement === true;
  if (agreement && (flagged || flags.limit !== undefined)) {
    throw new UsageError(
      "--agreement shows the report's thumbs-against-judge counts and takes no --flagged or --limit\n\nShow it with:\n  stigmer agent quality <agent> --agreement",
    );
  }
  if (flags.limit !== undefined && !flagged) {
    throw new UsageError(
      "--limit applies to --flagged only\n\nList the flagged grades with:\n  stigmer agent quality <agent> --flagged --limit <n>",
    );
  }
  return {
    days: readDays(flags.days),
    flagged,
    agreement,
    limit: readLimit(flags.limit),
    format,
  };
}

function readDays(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_DAYS;
  const days = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
  if (!(days >= 1 && days <= MAX_DAYS)) {
    throw new UsageError(`invalid --days value "${raw}": give a whole number of days from 1 to ${MAX_DAYS}`);
  }
  return days;
}

function readLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_FLAGGED_LIMIT;
  if (!/^\d+$/.test(raw)) {
    throw new UsageError(`invalid --limit value "${raw}": give a whole number, or 0 to list every flagged grade`);
  }
  return Number.parseInt(raw, 10);
}

/** Reads the agent and its report (or its flagged grades) and renders them in `options.format`. */
export async function showAgentQuality(
  client: Stigmer,
  org: string,
  ref: string,
  options: AgentQualityOptions,
): Promise<string> {
  await requireOrganization(client, org, SET_ORG_WITH);
  const agent = await resolveAgent(client, ref, org, SET_ORG_WITH);
  const agentId = agent.metadata?.id ?? "";

  if (options.flagged) {
    // --limit 0 walks every page: no request asks for the whole list.
    const scores = await readCursorPages(options.limit, (pageSize, pageToken) =>
      client.score.listFlaggedByAgent(
        create(ListFlaggedScoresByAgentRequestSchema, { org, agentId, days: options.days, pageSize, pageToken }),
      ),
    );
    return renderFlaggedScores(scores, options.format);
  }

  const report = await client.score.getAgentQualityReport(
    create(GetAgentQualityReportRequestSchema, { org, agentId, days: options.days }),
  );
  if (options.agreement) {
    return renderAgreement(report, agentLabel(agent, ref), options.format);
  }
  if (options.format !== "table") {
    return renderQualityReport(report, agentLabel(agent, ref), new Map(), options.format);
  }
  return renderQualityReport(report, agentLabel(agent, ref), await versionTags(client, agent, report), "table");
}

function agentLabel(agent: Agent, ref: string): string {
  return agent.metadata?.slug || agent.metadata?.name || ref;
}

/**
 * The tags of the versions the report names, from one read of the agent's
 * history. A history that cannot be read names every version by its hash,
 * as the console does while its history loads.
 */
async function versionTags(client: Stigmer, agent: Agent, report: AgentQualityReport): Promise<ReadonlyMap<string, string>> {
  const slug = agent.metadata?.slug ?? "";
  if (slug === "" || !report.versions.some((version) => version.agentVersionHash !== "")) {
    return new Map();
  }
  try {
    const history = await client.agent.listVersions(
      create(ListAgentVersionsInputSchema, { org: agent.metadata?.org ?? "", slug, pageSize: VERSION_HISTORY_PAGE_SIZE }),
    );
    return new Map(history.entries.filter((entry) => entry.tag !== "").map((entry) => [entry.versionHash, entry.tag]));
  } catch {
    return new Map();
  }
}

// --- Render: the report ---

/** The report as a table (totals, then one row per version), or the message itself as json or yaml. */
export function renderQualityReport(
  report: AgentQualityReport,
  agent: string,
  tags: ReadonlyMap<string, string>,
  format: OutputFormat,
): string {
  if (format === "json") return renderProtoJson(AgentQualityReportSchema, report);
  if (format === "yaml") return renderProtoYaml(AgentQualityReportSchema, report);

  const total = report.total;
  const lines: string[] = [
    "",
    `Agent:   ${agent}`,
    `Window:  ${report.fromDate} to ${report.toDate} (UTC)`,
    `Runs:    ${total?.runs ?? 0} graded`,
    "",
  ];
  if (total === undefined || total.runs === 0) {
    lines.push("No graded runs in this window.", "");
    return `${lines.join("\n")}\n`;
  }

  lines.push(...totalLines(total), "");

  const older = olderVersionsNote(total);
  if (older !== "") lines.push(older, "");

  if (report.versions.length > 0) {
    let marked = false;
    const rows = report.versions.map((version) => {
      const summary = version.summary;
      const mark = summary !== undefined && hasOlderVersions(summary) ? " *" : "";
      if (mark !== "") marked = true;
      return [
        versionLabel(version.agentVersionHash, tags) + mark,
        version.firstDate === version.lastDate ? version.firstDate : `${version.firstDate} to ${version.lastDate}`,
        String(summary?.runs ?? 0),
        rateCell(current(summary, RUN_HEALTH)),
        rateCell(current(summary, JUDGE)),
        thumbsCell(current(summary, FEEDBACK)),
      ];
    });
    lines.push(renderTable(["VERSION", "SEEN", "RUNS", "HEALTH", "JUDGE", "THUMBS"], rows).trimEnd());
    if (marked) {
      lines.push(
        "",
        "* older checks or rubrics also graded this version's runs; only the current ones are counted (-o json shows every one)",
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

/** The totals: health and judge rates with their counts, each rubric's, and the thumbs. */
function totalLines(total: QualitySummary): string[] {
  const lines: string[] = [];
  const health = current(total, RUN_HEALTH);
  lines.push(`  Health:  ${health === undefined ? "not graded" : rateLine(health)}`);

  const judge = current(total, JUDGE);
  lines.push(`  Judge:   ${judge === undefined ? "not graded" : rateLine(judge)}`);
  if (judge !== undefined && judge.criteria.length > 0) {
    const width = Math.max(...judge.criteria.map((criterion) => oneLine(criterion.name).length));
    for (const criterion of judge.criteria) {
      const graded = criterion.passed + criterion.failed;
      const rate = graded === 0 ? "not graded" : `${criterion.passed} of ${graded} passed (${percent(criterion.passed, graded)})`;
      const notApplicable = criterion.notApplicable > 0 ? `, ${criterion.notApplicable} not applicable` : "";
      lines.push(`    ${oneLine(criterion.name).padEnd(width)}   ${rate}${notApplicable}`);
    }
  }

  const feedback = current(total, FEEDBACK);
  lines.push(`  Thumbs:  ${feedback === undefined ? "none" : thumbsCell(feedback)}`);
  return lines;
}

/** "38 of 40 passed (95%)", with the runs not graded or still grading after it. */
function rateLine(tally: MetricTally): string {
  const graded = tally.passed + tally.failed;
  const parts = [graded === 0 ? "none graded" : `${tally.passed} of ${graded} passed (${percent(tally.passed, graded)})`];
  if (tally.notGraded > 0) parts.push(`${tally.notGraded} not graded`);
  if (tally.pending > 0) parts.push(`${tally.pending} grading`);
  return parts.join(", ");
}

/** "19/20 (95%)", or "-" when nothing was graded. */
function rateCell(tally: MetricTally | undefined): string {
  const graded = tally === undefined ? 0 : tally.passed + tally.failed;
  if (tally === undefined || graded === 0) return "-";
  return `${tally.passed}/${graded} (${percent(tally.passed, graded)})`;
}

/** "3 up, 1 down", or "-" when no one gave a thumb. */
function thumbsCell(tally: MetricTally | undefined): string {
  if (tally === undefined || tally.passed + tally.failed === 0) return "-";
  return `${tally.passed} up, ${tally.failed} down`;
}

/**
 * A whole percentage that never reads as all or nothing when it is not:
 * 199 of 200 is 99%, not 100%, and 1 of 200 is 1%, not 0%.
 */
function percent(passed: number, graded: number): string {
  let value = Math.round((passed / graded) * 100);
  if (value === 100 && passed < graded) value = 99;
  if (value === 0 && passed > 0) value = 1;
  return `${value}%`;
}

/** The current tally of a metric: the first the server lists, the most recently seen version. */
function current(summary: QualitySummary | undefined, metric: string): MetricTally | undefined {
  return summary?.metrics.find((tally) => tally.metric === metric);
}

/** How many tallies of each metric sit behind its current one. */
function olderVersionCounts(summary: QualitySummary): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tally of summary.metrics) {
    counts.set(tally.metric, (counts.get(tally.metric) ?? -1) + 1);
  }
  return counts;
}

function hasOlderVersions(summary: QualitySummary): boolean {
  return [...olderVersionCounts(summary).values()].some((count) => count > 0);
}

/** One line naming the metrics older evaluator versions also graded, or "" when none did. */
function olderVersionsNote(total: QualitySummary): string {
  const named = [...olderVersionCounts(total)]
    .filter(([, count]) => count > 0)
    .map(([metric, count]) => `${oneLine(metric)} (${count} older ${count === 1 ? "version" : "versions"})`);
  if (named.length === 0) return "";
  return `Older checks or rubrics also graded runs in this window and are not counted above: ${named.join(", ")}. -o json shows every one.`;
}

/** A version's tag, else its short hash; "unversioned" for runs of an agent with no recorded version. */
function versionLabel(hash: string, tags: ReadonlyMap<string, string>): string {
  if (hash === "") return "unversioned";
  return oneLine(tags.get(hash) ?? hash.slice(0, SHORT_HASH_LENGTH));
}

// --- Render: the agreement ---

/**
 * The report's agreement as one table per judge rubric version, the current
 * one first, fitted to `stream`'s width, or the agreement entries as json or
 * yaml.
 */
export function renderAgreement(
  report: AgentQualityReport,
  agent: string,
  format: OutputFormat,
  stream: TerminalStream = process.stdout,
): string {
  if (format === "json") return renderProtoListJson(JudgeAgreementSchema, report.agreement);
  if (format === "yaml") return renderProtoListYaml(JudgeAgreementSchema, report.agreement);

  const lines: string[] = ["", `Agent:   ${agent}`, `Window:  ${report.fromDate} to ${report.toDate} (UTC)`, ""];
  if (report.agreement.length === 0) {
    lines.push("No run in this window has both an AI judge grade and a person's thumbs.", "");
    return `${lines.join("\n")}\n`;
  }
  const width = terminalWidth(stream);
  report.agreement.forEach((entry, index) => lines.push(...agreementLines(entry, index === 0, width), ""));
  lines.push(
    "FAILED, UP: the rubric failed runs people liked (it may be too strict).",
    "PASSED, DOWN: the rubric passed runs people disliked (it may be too lenient).",
    "",
  );
  return `${lines.join("\n")}\n`;
}

// A RUBRIC is a rule's name as its author wrote it: free text, so it gives up width first.
function agreementLines(entry: JudgeAgreement, isCurrent: boolean, width: number | undefined): string[] {
  const version = oneLine(entry.evaluatorVersion.slice(0, SHORT_HASH_LENGTH));
  const runs = `${entry.runs} ${entry.runs === 1 ? "run" : "runs"} with a judge grade and thumbs`;
  const missed =
    entry.thumbsDownNoneFailed === 0
      ? ""
      : `; ${entry.thumbsDownNoneFailed} disliked where no rubric failed (a failure no rubric catches)`;
  const rows = entry.rules.map((rule) => [
    oneLine(rule.name),
    String(rule.failedThumbsDown),
    String(rule.failedThumbsUp),
    String(rule.passedThumbsDown),
    String(rule.passedThumbsUp),
  ]);
  return [
    `Rubrics ${version}${isCurrent ? " (current)" : ""}: ${runs}${missed}`,
    renderTable(["RUBRIC", "FAILED, DOWN", "FAILED, UP", "PASSED, DOWN", "PASSED, UP"], rows, {
      width,
      shrink: ["RUBRIC"],
    }).trimEnd(),
  ];
}

// --- Render: the flagged grades ---

/**
 * The flagged grades as a table (time, run, metric, failed criteria) fitted
 * to `stream`'s width, the criteria's names giving up width first, or the
 * scores as json or yaml.
 */
export function renderFlaggedScores(
  scores: readonly Score[],
  format: OutputFormat,
  stream: TerminalStream = process.stdout,
): string {
  if (format === "json") return renderProtoListJson(ScoreSchema, scores);
  if (format === "yaml") return renderProtoListYaml(ScoreSchema, scores);
  if (scores.length === 0) return renderEmpty("flagged runs");
  const rows = scores.map((score) => [
    createdAt(score),
    score.spec?.runId ?? "",
    oneLine(score.spec?.metric ?? ""),
    failedLabel(score),
  ]);
  return `\n${renderTable(["TIME", "RUN", "METRIC", "FAILED"], rows, { width: terminalWidth(stream), shrink: ["FAILED"] })}\n`;
}

/** When the grade was given, in UTC to the minute, as the report's days are UTC. */
function createdAt(score: Score): string {
  const at = score.status?.audit?.specAudit?.createdAt;
  if (at === undefined) return "-";
  return `${timestampDate(at).toISOString().slice(0, 16).replace("T", " ")}Z`;
}

/** The names of the failed criteria; a person's failed grade is a thumbs down. */
function failedLabel(score: Score): string {
  if (score.spec?.metric === FEEDBACK) return "thumbs down";
  const names = (score.spec?.criteria ?? [])
    .filter((criterion) => criterion.result === CriterionResult.failed)
    .map((criterion) => oneLine(criterion.name));
  return names.length === 0 ? "-" : names.join(", ");
}
