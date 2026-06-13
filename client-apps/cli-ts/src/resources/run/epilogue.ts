// The post-stream epilogue, shared by every renderer (Go's streamAgentEpilogue +
// run_display_summary.go). After the stream ends we fetch the authoritative final
// execution and a usage report, then print a compact, copy-paste-friendly exit
// summary to stderr (AI content already went to stdout). A stream that failed
// before reaching a phase is re-raised as a CLI error.

import { create } from "@bufbuild/protobuf";
import { ExecutionPhase, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { GetExecutionUsageReportInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { UsageReportAggregate } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import type { Stigmer } from "@stigmer/sdk";
import { CliExitError, ExitCode } from "../../errors/index.js";
import { shouldColorize, styler } from "../../output/style.js";
import { mapPhaseToString } from "../stream/convert.js";
import type { HeadlessResult } from "../stream/headless.js";

/**
 * Fetch the final execution + usage and print the exit summary. Returns the
 * final execution so the caller can act on its artifacts (e.g. --download).
 */
export async function runEpilogue(
  client: Stigmer,
  sessionId: string,
  executionId: string,
  result: HeadlessResult,
): Promise<AgentExecution> {
  // A stream error before any phase is a hard failure (Go: epilogue returns it).
  if (result.error !== "" && result.phase === "") {
    throw new CliExitError(result.error, ExitCode.General);
  }

  const exec = await client.agentExecution.get(executionId);
  const usage = await fetchUsage(client, executionId);

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
async function fetchUsage(client: Stigmer, executionId: string): Promise<UsageReportAggregate | undefined> {
  try {
    const report = await client.agentExecution.getExecutionUsageReport(
      create(GetExecutionUsageReportInputSchema, { executionId }),
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
  exec: AgentExecution,
  usage: UsageReportAggregate | undefined,
): void {
  const phase = exec.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  const duration = formatDuration(exec.status?.startedAt ?? "", exec.status?.completedAt ?? "");
  const cost = usage !== undefined && usage.billableCostMicros > 0n ? formatCost(usage.billableCostMicros) : "";

  switch (phase) {
    case ExecutionPhase.EXECUTION_COMPLETED:
      write(s.green(completedLine(duration, cost)));
      break;
    case ExecutionPhase.EXECUTION_FAILED:
      write(s.red(`✗ Failed: ${resolveFailureError(exec)}`));
      break;
    case ExecutionPhase.EXECUTION_CANCELLED:
      write(s.yellow("Cancelled"));
      break;
    case ExecutionPhase.EXECUTION_TERMINATED:
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
function printCompletion(write: Write, s: Styler, exec: AgentExecution): void {
  const phase = exec.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  if (phase === ExecutionPhase.EXECUTION_FAILED) {
    write(s.red(`✗ Execution failed: ${resolveFailureError(exec)}`));
    return;
  }
  write(s.green(`✓ Execution ${mapPhaseToString(phase)}`));
}

function completedLine(duration: string, cost: string): string {
  if (duration !== "" && cost !== "") return `✓ Completed (${duration} · ${cost})`;
  if (duration !== "") return `✓ Completed (${duration})`;
  return "✓ Completed";
}

function resumeVerb(phase: ExecutionPhase): string {
  switch (phase) {
    case ExecutionPhase.EXECUTION_COMPLETED:
      return "To continue:";
    case ExecutionPhase.EXECUTION_FAILED:
      return "To retry:   ";
    default:
      return "To resume:  ";
  }
}

// Mirrors Go's resolveFailureError: canonical error, else last system message,
// else first failed tool call's error, else a generic pointer to the logs.
function resolveFailureError(exec: AgentExecution): string {
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

const GENERIC_FAILURE = "Execution failed (error details unavailable — check execution logs)";

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
