// `usage` reports: token/cost/model breakdowns at three granularities (session,
// agent, org). Mirrors Go's internal/cli usage_* renderers, including the cost,
// token-count, share, and date formatting helpers.
//
// A deliberate divergence from the retired Go CLI, which serialized usage
// reports with the standard library (encoding/json + yaml.v3) directly on the
// proto messages, a *different* shape (lowerCamel keys, integer enums, numeric
// int64) than the protojson used by every other command. We emit protojson
// here for consistency with the rest of the CLI (string enums/int64,
// snake_case keys).

import { create } from "@bufbuild/protobuf";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
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
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import type { UsageReportAggregate } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/usage_pb";
import type { Stigmer } from "@stigmer/sdk";
import type { OutputFormat } from "../output/index.js";
import { renderProtoJson, renderProtoYaml, renderTable } from "../output/index.js";

export interface DateRange {
  readonly from: string;
  readonly to: string;
}

// --- Fetch ---

export async function getSessionUsageReport(client: Stigmer, sessionId: string): Promise<GetSessionUsageReportOutput> {
  return client.agentRun.getSessionUsageReport(create(GetSessionUsageReportInputSchema, { sessionId }));
}

export async function getAgentUsageReport(
  client: Stigmer,
  agentId: string,
  org: string,
  range: DateRange,
): Promise<GetAgentUsageReportOutput> {
  return client.agentRun.getAgentUsageReport(
    create(GetAgentUsageReportInputSchema, { agentId, org, fromDate: range.from, toDate: range.to }),
  );
}

export async function getOrgUsageReport(
  client: Stigmer,
  org: string,
  range: DateRange,
): Promise<GetOrgUsageReportOutput> {
  return client.agentRun.getOrgUsageReport(
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
    lines.push(`Runs: ${report.runCount}`);
  }
  lines.push("");

  if (report.modelBreakdown.length > 0) {
    let totalInput = 0n;
    let totalOutput = 0n;
    let totalCached = 0n;
    let totalCost = 0n;
    const rows = report.modelBreakdown.map((m) => {
      totalInput += m.inputTokens;
      totalOutput += m.outputTokens;
      totalCached += m.cacheReadInputTokens;
      totalCost += m.billableCostMicros;
      return [
        m.model,
        formatTokenCount(m.inputTokens),
        formatTokenCount(m.outputTokens),
        formatTokenCount(m.cacheReadInputTokens),
        formatCost(m.billableCostMicros),
      ];
    });
    if (report.modelBreakdown.length > 1) {
      rows.push([
        "Total",
        formatTokenCount(totalInput),
        formatTokenCount(totalOutput),
        formatTokenCount(totalCached),
        formatCost(totalCost),
      ]);
    }
    lines.push(renderTable(["MODEL", "INPUT", "OUTPUT", "CACHED", "COST"], rows), "");
  }

  const cacheRate = formatCacheHitRate(report.totalUsage);
  if (cacheRate !== "") lines.push(`Cache hit rate: ${cacheRate}`);

  if (report.runs.length > 0) {
    lines.push("");
    const rows = report.runs.map((exec, i) => [
      String(i + 1),
      formatDate(exec.startedAt),
      formatTokenCount(exec.inputTokens + exec.outputTokens),
      formatCost(exec.billableCostMicros),
      exec.primaryModel,
      mapPhaseToString(exec.phase),
    ]);
    lines.push(renderTable(["#", "DATE", "TOKENS", "COST", "MODEL", "STATUS"], rows));
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
  lines.push("");
  lines.push(`  Sessions:     ${report.totalSessions}`);
  lines.push(`  Runs:         ${report.totalRuns}`);
  lines.push(`  Total cost:   ${formatCost(report.totalBillableCostMicros)}`);
  if (report.totalRuns > 0) {
    const avg = report.totalBillableCostMicros / BigInt(report.totalRuns);
    lines.push(`  Avg/run:      ${formatCost(avg)}`);
  }
  lines.push("");

  const totalCost = report.totalBillableCostMicros;
  if (report.modelBreakdown.length > 0) {
    const rows = report.modelBreakdown.map((m) => [
      m.model,
      formatTokenCount(m.inputTokens + m.outputTokens + m.cacheCreationInputTokens + m.cacheReadInputTokens),
      formatCost(m.billableCostMicros),
      formatShare(m.billableCostMicros, totalCost),
    ]);
    lines.push(renderTable(["MODEL", "TOKENS", "COST", "SHARE"], rows), "");
  }

  if (report.sessions.length > 0) {
    const rows = report.sessions.map((sess, i) => [
      String(i + 1),
      formatDateRange(sess.firstRunAt, sess.lastRunAt),
      String(sess.runCount),
      formatCost(sess.billableCostMicros),
    ]);
    lines.push(renderTable(["#", "PERIOD", "RUNS", "COST"], rows));
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

  const lines: string[] = ["", "Organization Usage Report", `Period: ${formatInputDateRange(range.from, range.to)}`, ""];
  lines.push(`  Agents:       ${report.totalAgents}`);
  lines.push(`  Sessions:     ${report.totalSessions}`);
  lines.push(`  Runs:         ${report.totalRuns}`);
  lines.push(`  Total cost:   ${formatCost(report.totalBillableCostMicros)}`);
  lines.push("");

  const totalCost = report.totalBillableCostMicros;
  if (report.modelBreakdown.length > 0) {
    const rows = report.modelBreakdown.map((m) => [
      m.model,
      formatTokenCount(m.inputTokens + m.outputTokens + m.cacheCreationInputTokens + m.cacheReadInputTokens),
      formatCost(m.billableCostMicros),
      formatShare(m.billableCostMicros, totalCost),
    ]);
    lines.push(renderTable(["MODEL", "TOKENS", "COST", "SHARE"], rows), "");
  }

  if (report.topAgentsByCost.length > 0) {
    const rows = report.topAgentsByCost.map((a) => [
      a.agentName === "" ? a.agentId : a.agentName,
      String(a.runCount),
      formatCost(a.billableCostMicros),
      formatShare(a.billableCostMicros, totalCost),
    ]);
    lines.push(renderTable(["AGENT", "RUNS", "COST", "SHARE"], rows), "");
  }

  if (report.dailyCosts.length > 0) {
    const rows = report.dailyCosts.map((day) => [
      day.date,
      String(day.runCount),
      formatCost(day.billableCostMicros),
    ]);
    lines.push(renderTable(["DATE", "RUNS", "COST"], rows));
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

// --- Formatting helpers (mirror Go's usage_format.go) ---

function formatCost(micros: bigint): string {
  const usd = Number(micros) / 1_000_000;
  if (usd === 0) return "$0.00";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokenCount(count: bigint): string {
  const n = Number(count);
  if (n < 1000) return String(count);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatShare(part: bigint, total: bigint): string {
  if (total === 0n) return "0.0%";
  return `${((Number(part) / Number(total)) * 100).toFixed(1)}%`;
}

function formatCacheHitRate(usage: UsageReportAggregate | undefined): string {
  if (usage === undefined || usage.inputTokens === 0n || usage.cacheReadInputTokens === 0n) return "";
  const rate = (Number(usage.cacheReadInputTokens) / Number(usage.inputTokens)) * 100;
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
