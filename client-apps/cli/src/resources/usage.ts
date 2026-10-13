// `usage` reports: token and model breakdowns at three granularities
// (session, agent, org). Usage is counted in tokens and never priced, so the
// tables show TOKENS and a SHARE of the report's tokens; no dollar figure
// appears. A served-by line says whose provider credential served the tokens
// (the organization's own keys or Stigmer's free model), and "estimated"
// marks numbers counted from a run's own runner report rather than the
// deployment's meter. Mirrors the retired Go CLI's usage_* renderers for
// layout and date formatting.
//
// A deliberate divergence from the retired Go CLI, which serialized usage
// reports with the standard library (encoding/json + yaml.v3) directly on the
// proto messages, a *different* shape (lowerCamel keys, integer enums, numeric
// int64) than the protojson used by every other command. We emit protojson
// here for consistency with the rest of the CLI (string enums/int64,
// snake_case keys).

import { create } from "@bufbuild/protobuf";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  GetAgentUsageReportInputSchema,
  GetAgentUsageReportOutputSchema,
  GetOrgUsageReportInputSchema,
  GetOrgUsageReportOutputSchema,
  GetSessionUsageReportInputSchema,
  GetSessionUsageReportOutputSchema,
  type GetAgentUsageReportOutput,
  type GetOrgUsageReportOutput,
  type GetSessionUsageReportOutput,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import {
  ProviderKeySource,
  type ModelUsage,
  type UsageReportAggregate,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/usage_pb";
import type { Stigmer } from "@stigmer/sdk";
import type { OutputFormat } from "../output/index.js";
import { renderProtoJson, renderProtoYaml, renderTable } from "../output/index.js";
import { formatTokenCount } from "./run-format.js";

export interface DateRange {
  readonly from: string;
  readonly to: string;
}

// --- Fetch ---

export async function getSessionUsageReport(client: Stigmer, sessionId: string): Promise<GetSessionUsageReportOutput> {
  return client.run.getSessionUsageReport(create(GetSessionUsageReportInputSchema, { sessionId }));
}

export async function getAgentUsageReport(
  client: Stigmer,
  agentId: string,
  org: string,
  range: DateRange,
): Promise<GetAgentUsageReportOutput> {
  return client.run.getAgentUsageReport(
    create(GetAgentUsageReportInputSchema, { agentId, org, fromDate: range.from, toDate: range.to }),
  );
}

export async function getOrgUsageReport(
  client: Stigmer,
  org: string,
  range: DateRange,
): Promise<GetOrgUsageReportOutput> {
  return client.run.getOrgUsageReport(
    create(GetOrgUsageReportInputSchema, { org, fromDate: range.from, toDate: range.to }),
  );
}

// --- Render: session ---

export function renderSessionUsage(report: GetSessionUsageReportOutput, format: OutputFormat): string {
  if (format === "json") return renderProtoJson(GetSessionUsageReportOutputSchema, report);
  if (format === "yaml") return renderProtoYaml(GetSessionUsageReportOutputSchema, report);

  const lines: string[] = ["", `Session: ${report.sessionId}`];
  const period = formatDateRange(report.firstRunAt, report.lastRunAt);
  if (period !== "") {
    lines.push(`Period:  ${period} (${report.runCount} runs)`);
  } else {
    lines.push(`Runs:    ${report.runCount}`);
  }
  const totalTokens = reportTokens(report.totalUsage, report.modelBreakdown);
  lines.push(`Tokens:  ${formatTokenCount(totalTokens)}${report.isEstimated ? " (estimated)" : ""}`);
  const servedBy = formatServedBy(report.totalUsage);
  if (servedBy !== "") lines.push(`Served by: ${servedBy}`);
  lines.push("");

  if (report.modelBreakdown.length > 0) {
    const rows = report.modelBreakdown.map((m) => [
      m.model,
      formatTokenCount(m.inputTokens),
      formatTokenCount(m.outputTokens),
      formatTokenCount(m.cacheReadInputTokens),
      formatTokenCount(m.totalTokens),
      formatShare(m.totalTokens, totalTokens),
    ]);
    lines.push(renderTable(["MODEL", "INPUT", "OUTPUT", "CACHED", "TOKENS", "SHARE"], rows), "");
  }

  const cacheRate = formatCacheHitRate(report.totalUsage);
  if (cacheRate !== "") lines.push(`Cache hit rate: ${cacheRate}`);

  if (report.runs.length > 0) {
    lines.push("");
    const rows = report.runs.map((exec, i) => [
      String(i + 1),
      formatDate(exec.startedAt),
      `${exec.isEstimated ? ESTIMATED_MARK : ""}${formatTokenCount(exec.totalTokens)}`,
      exec.primaryModel,
      mapPhaseToString(exec.phase),
    ]);
    lines.push(renderTable(["#", "DATE", "TOKENS", "MODEL", "STATUS"], rows));
    if (report.runs.some((exec) => exec.isEstimated)) {
      lines.push(`${ESTIMATED_MARK} estimated from the run's own report`);
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

// --- Render: agent ---

export function renderAgentUsage(
  report: GetAgentUsageReportOutput,
  range: DateRange,
  format: OutputFormat,
): string {
  if (format === "json") return renderProtoJson(GetAgentUsageReportOutputSchema, report);
  if (format === "yaml") return renderProtoYaml(GetAgentUsageReportOutputSchema, report);

  const name = report.agentName === "" ? report.agentId : report.agentName;
  const lines: string[] = ["", `Agent:  ${name}`];
  if (range.from !== "" || range.to !== "") {
    lines.push(`Period: ${formatInputDateRange(range.from, range.to)}`);
  }
  const totalTokens = reportTokens(report.totalUsage, report.modelBreakdown);
  lines.push("");
  lines.push(`  Sessions:     ${report.totalSessions}`);
  lines.push(`  Runs:         ${report.totalRuns}`);
  lines.push(`  Total tokens: ${formatTokenCount(totalTokens)}`);
  if (report.totalRuns > 0) {
    lines.push(`  Avg/run:      ${formatTokenCount(totalTokens / BigInt(report.totalRuns))}`);
  }
  const servedBy = formatServedBy(report.totalUsage);
  if (servedBy !== "") lines.push(`  Served by:    ${servedBy}`);
  lines.push("");

  if (report.modelBreakdown.length > 0) {
    const rows = report.modelBreakdown.map((m) => [
      m.model,
      formatTokenCount(m.totalTokens),
      formatShare(m.totalTokens, totalTokens),
    ]);
    lines.push(renderTable(["MODEL", "TOKENS", "SHARE"], rows), "");
  }

  if (report.sessions.length > 0) {
    const rows = report.sessions.map((sess, i) => [
      String(i + 1),
      formatDateRange(sess.firstRunAt, sess.lastRunAt),
      String(sess.runCount),
      formatTokenCount(sess.totalTokens),
    ]);
    lines.push(renderTable(["#", "PERIOD", "RUNS", "TOKENS"], rows));
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

// --- Render: org ---

export function renderOrgUsage(
  report: GetOrgUsageReportOutput,
  range: DateRange,
  format: OutputFormat,
): string {
  if (format === "json") return renderProtoJson(GetOrgUsageReportOutputSchema, report);
  if (format === "yaml") return renderProtoYaml(GetOrgUsageReportOutputSchema, report);

  const totalTokens = reportTokens(report.totalUsage, report.modelBreakdown);
  const lines: string[] = ["", "Organization Usage Report", `Period: ${formatInputDateRange(range.from, range.to)}`, ""];
  lines.push(`  Agents:       ${report.totalAgents}`);
  lines.push(`  Sessions:     ${report.totalSessions}`);
  lines.push(`  Runs:         ${report.totalRuns}`);
  lines.push(`  Total tokens: ${formatTokenCount(totalTokens)}`);
  const servedBy = formatServedBy(report.totalUsage);
  if (servedBy !== "") lines.push(`  Served by:    ${servedBy}`);
  lines.push("");

  if (report.modelBreakdown.length > 0) {
    const rows = report.modelBreakdown.map((m) => [
      m.model,
      formatTokenCount(m.totalTokens),
      formatShare(m.totalTokens, totalTokens),
    ]);
    lines.push(renderTable(["MODEL", "TOKENS", "SHARE"], rows), "");
  }

  if (report.topAgents.length > 0) {
    const rows = report.topAgents.map((a) => [
      a.agentName === "" ? a.agentId : a.agentName,
      String(a.runCount),
      formatTokenCount(a.totalTokens),
      formatShare(a.totalTokens, totalTokens),
    ]);
    lines.push(renderTable(["AGENT", "RUNS", "TOKENS", "SHARE"], rows), "");
  }

  if (report.harnessUsage.length > 0) {
    const rows = report.harnessUsage.map((h) => [
      h.harness,
      String(h.runCount),
      formatTokenCount(h.totalTokens),
      formatShare(h.totalTokens, totalTokens),
    ]);
    lines.push(renderTable(["HARNESS", "RUNS", "TOKENS", "SHARE"], rows), "");
  }

  if (report.dailyUsage.length > 0) {
    const rows = report.dailyUsage.map((day) => [day.date, String(day.runCount), formatTokenCount(day.totalTokens)]);
    lines.push(renderTable(["DATE", "RUNS", "TOKENS"], rows));
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

// --- Formatting helpers ---

// Prefixes a run's tokens when they were counted from its runner's own report.
const ESTIMATED_MARK = "~";

// The report's token total: the aggregate's, or the model rows' sum when the
// aggregate is absent (a report with no runs may carry none).
function reportTokens(usage: UsageReportAggregate | undefined, models: readonly ModelUsage[]): bigint {
  if (usage !== undefined) return usage.totalTokens;
  return models.reduce((sum, m) => sum + m.totalTokens, 0n);
}

/**
 * Whose provider credential served a report's tokens, as one line. The split
 * shows only when more than one known source served tokens; a single known
 * source reads as its name, with any tokens whose server was not recorded
 * noted beside it. No known source (every run counted from its runner's own
 * report, or metered records older than the field) prints nothing, since
 * there is nothing to tell apart.
 */
export function formatServedBy(usage: UsageReportAggregate | undefined): string {
  if (usage === undefined) return "";
  const rows = usage.servedBy.filter((row) => row.totalTokens > 0n);
  const isKnown = (source: ProviderKeySource): boolean =>
    source !== ProviderKeySource.UNSPECIFIED;
  const known = rows.filter((row) => isKnown(row.providerKeySource));
  if (known.length === 0) return "";
  if (known.length === 1) {
    const label = servedByLabel(known[0].providerKeySource);
    const unrecorded = rows
      .filter((row) => !isKnown(row.providerKeySource))
      .reduce((sum, row) => sum + row.totalTokens, 0n);
    return unrecorded > 0n ? `${label} (${formatTokenCount(unrecorded)} tokens not recorded)` : label;
  }
  const total = rows.reduce((sum, row) => sum + row.totalTokens, 0n);
  return rows
    .map(
      (row) =>
        `${servedByLabel(row.providerKeySource)} ${formatTokenCount(row.totalTokens)} (${formatShare(row.totalTokens, total)})`,
    )
    .join(" · ");
}

function servedByLabel(source: ProviderKeySource): string {
  switch (source) {
    case ProviderKeySource.ORGANIZATION:
      return "your keys";
    case ProviderKeySource.PLATFORM:
      return "Stigmer's free model";
    case ProviderKeySource.UNSPECIFIED:
      return "not recorded";
    default: {
      const unknown: never = source;
      return `source ${String(unknown)}`;
    }
  }
}

function formatShare(part: bigint, total: bigint): string {
  if (total === 0n) return "0.0%";
  return `${((Number(part) / Number(total)) * 100).toFixed(1)}%`;
}

// The share of all input served from the cache. The aggregate's input_tokens
// excludes both cache buckets, so the whole input is the three summed.
function formatCacheHitRate(usage: UsageReportAggregate | undefined): string {
  if (usage === undefined || usage.cacheReadInputTokens === 0n) return "";
  const allInput = usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
  const rate = (Number(usage.cacheReadInputTokens) / Number(allInput)) * 100;
  return `${Math.round(rate)}% cached`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

// "Jan 02" from an ISO 8601 timestamp; raw (≤10 chars) on parse failure.
function formatDate(iso: string): string {
  if (iso === "") return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.length >= 10 ? iso.slice(0, 10) : iso;
  return `${MONTHS[date.getMonth()]} ${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateRange(from: string, to: string): string {
  const f = formatDate(from);
  const t = formatDate(to);
  if (f === "" && t === "") return "";
  if (f === "") return `to ${t}`;
  if (t === "") return `from ${f}`;
  return `${f} to ${t}`;
}

// Plain user-supplied date strings (e.g. "2026-03-01"), shown verbatim.
function formatInputDateRange(from: string, to: string): string {
  if (from === "" && to === "") return "";
  if (from === "") return `to ${to}`;
  if (to === "") return `from ${from}`;
  return `${from} to ${to}`;
}

// Matches Go's mapPhaseToString (snake_case phase labels for the usage table).
function mapPhaseToString(phase: RunPhase): string {
  switch (phase) {
    case RunPhase.RUN_PENDING:
      return "pending";
    case RunPhase.RUN_IN_PROGRESS:
      return "in_progress";
    case RunPhase.RUN_COMPLETED:
      return "completed";
    case RunPhase.RUN_FAILED:
      return "failed";
    case RunPhase.RUN_CANCELLED:
      return "cancelled";
    case RunPhase.RUN_WAITING_FOR_APPROVAL:
      return "waiting_for_approval";
    case RunPhase.RUN_TERMINATED:
      return "terminated";
    default:
      return "unknown";
  }
}
