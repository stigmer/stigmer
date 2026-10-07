// The post-stream epilogue, shared by every renderer (Go's streamAgentEpilogue +
// run_display_summary.go). After the stream ends we fetch the authoritative final
// run and a usage report, then print a compact, copy-paste-friendly exit
// summary to stderr (AI content already went to stdout). A stream that failed
// before reaching a phase is re-raised as a CLI error.

import { create } from "@bufbuild/protobuf";
import { RunPhase, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { GetRunUsageReportInputSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import type { UsageReportAggregate } from "@stigmer/protos/ai/stigmer/agentic/run/v1/usage_pb";
import type { Stigmer } from "@stigmer/sdk";
import { CliExitError, ExitCode } from "../../errors/index.js";
import { shouldColorize, styler } from "../../output/style.js";
import { mapPhaseToString } from "../stream/convert.js";
import type { HeadlessResult } from "../stream/headless.js";

/**
 * Fetch the final run + usage and print the exit summary. Returns the
 * final run so the caller can act on its artifacts (e.g. --download).
 */
export async function runEpilogue(
  client: Stigmer,
  sessionId: string,
  runId: string,
  result: HeadlessResult,
): Promise<Run> {
  // A stream error before any phase is a hard failure (Go: epilogue returns it).
  if (result.error !== "" && result.phase === "") {
    throw new CliExitError(result.error, ExitCode.General);
  }

  const exec = await client.run.get(runId);
  const usage = await fetchUsage(client, runId);

  const write = (line: string): void => void process.stderr.write(`${line}\n`);
  const s = styler(shouldColorize(process.stderr));
  write("");
  if (sessionId !== "") {
    printSessionExit(write, s, sessionId, exec, usage);
  } else {
    printCompletion(write, s, exec);
  }
  return exec;
}

// Best-effort usage fetch; a failure here must not fail the run (Go tolerates a
// nil usage report and renders without the cost line).
async function fetchUsage(client: Stigmer, runId: string): Promise<UsageReportAggregate | undefined> {
  try {
    const report = await client.run.getRunUsageReport(
      create(GetRunUsageReportInputSchema, { runId }),
    );
    return report.aggregate;
  } catch {
    return undefined;
  }
}

type Styler = ReturnType<typeof styler>;
type Write = (line: string) => void;

// Compact session summary + a copy-paste resume command. Mirrors Go's
// displaySessionExitLine + sessionResumeVerb.
function printSessionExit(
  write: Write,
  s: Styler,
  sessionId: string,
  exec: Run,
  usage: UsageReportAggregate | undefined,
): void {
  const phase = exec.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  const duration = formatDuration(exec.status?.startedAt ?? "", exec.status?.completedAt ?? "");
  const cost = usage !== undefined && usage.billableCostMicros > 0n ? formatCost(usage.billableCostMicros) : "";

  switch (phase) {
    case RunPhase.RUN_COMPLETED:
      write(s.green(completedLine(duration, cost)));
      break;
    case RunPhase.RUN_FAILED:
      write(s.red(`✗ Failed: ${resolveFailureError(exec)}`));
      break;
    case RunPhase.RUN_CANCELLED:
      write(s.yellow("Cancelled"));
      break;
    case RunPhase.RUN_TERMINATED:
      write(s.yellow(`Stopped: ${resolveFailureError(exec)}`));
      break;
    default:
      write(s.yellow(`Exited (${mapPhaseToString(phase)})`));
  }

  write("");
  write(`  ${resumeVerb(phase)}  stigmer resume ${sessionId}`);
}

// Non-session completion (rare for run; e.g. a degraded backend). Mirrors the
// information of Go's displayAgentExecutionComplete without the panel chrome.
function printCompletion(write: Write, s: Styler, exec: Run): void {
  const phase = exec.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  if (phase === RunPhase.RUN_FAILED) {
    write(s.red(`✗ Run failed: ${resolveFailureError(exec)}`));
    return;
  }
  write(s.green(`✓ Run ${mapPhaseToString(phase)}`));
}

function completedLine(duration: string, cost: string): string {
  if (duration !== "" && cost !== "") return `✓ Completed (${duration} · ${cost})`;
  if (duration !== "") return `✓ Completed (${duration})`;
  return "✓ Completed";
}

function resumeVerb(phase: RunPhase): string {
  switch (phase) {
    case RunPhase.RUN_COMPLETED:
      return "To continue:";
    case RunPhase.RUN_FAILED:
      return "To retry:   ";
    default:
      return "To resume:  ";
  }
}

// Mirrors Go's resolveFailureError: canonical error, else last system message,
// else first failed tool call's error, else a generic pointer to the logs.
function resolveFailureError(exec: Run): string {
  const status = exec.status;
  if (status === undefined) return GENERIC_FAILURE;
  if (status.error !== "") return status.error;

  for (let i = status.messages.length - 1; i >= 0; i--) {
    const msg = status.messages[i];
    if (msg.type === MessageType.MESSAGE_SYSTEM && msg.content !== "") return msg.content;
  }
  for (const msg of status.messages) {
    for (const tc of msg.toolCalls) {
      if (tc.status === ToolCallStatus.TOOL_CALL_FAILED && tc.error !== "") return tc.error;
    }
  }
  return GENERIC_FAILURE;
}

const GENERIC_FAILURE = "Run failed (error details unavailable — check run logs)";

// "1m23s"/"45s" between two RFC3339 timestamps, or "" when unknown. Mirrors Go's
// parseDuration + Round(time.Second).
function formatDuration(startedAt: string, completedAt: string): string {
  if (startedAt === "" || completedAt === "") return "";
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "";
  const totalSeconds = Math.round((end - start) / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`;
}

// USD from micros. Mirrors usage.ts's formatCost precision tiers.
function formatCost(micros: bigint): string {
  const usd = Number(micros) / 1_000_000;
  if (usd === 0) return "$0.00";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
