// The post-stream epilogue, shared by every renderer (Go's streamAgentEpilogue +
// run_display_summary.go). After the stream ends we fetch the authoritative final
// run and its usage report, then print a compact, copy-paste-friendly exit
// summary to stderr (AI content already went to stdout). A completed turn
// names its duration and its tokens, never a price; tokens counted from the
// runner's own report rather than the meter carry a "~". A stream that failed
// before reaching a phase is re-raised as a CLI error.
//
// What went wrong with a failed or stopped turn is read from the turn as the
// session's log folds it: the run's own error, else the turn's status error,
// its last error event, the platform's last note, the first failed tool use's
// output. The headless stream hands its folded turn over; after the Ink view,
// the turn's events are listed only when the summary needs them.

import { create } from "@bufbuild/protobuf";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { GetRunUsageReportInputSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import type { UsageReportAggregate } from "@stigmer/apis/ai/stigmer/agentic/run/v1/usage_pb";
import { foldSession, turnOf, type Stigmer, type NoteItem, type Turn, type TurnItem } from "@stigmer/client";
import { CliExitError, ExitCode } from "../../errors/index.js";
import { shouldColorize, styler } from "../../output/style.js";
import { formatTokenCount } from "../run-format.js";
import { formatAgentPhase } from "../runs.js";
import { listSessionEvents } from "../session.js";
import type { HeadlessResult } from "../stream/headless.js";

/**
 * Fetch the final run + usage and print the exit summary. Returns the
 * final run so the caller can act on its outputs (e.g. --download).
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

  const failure = (): Promise<string> => resolveFailureError(client, sessionId, runId, exec, result.turn);

  const write = (line: string): void => void process.stderr.write(`${line}\n`);
  const s = styler(shouldColorize(process.stderr));
  write("");
  if (sessionId !== "") {
    await printSessionExit(write, s, sessionId, exec, usage, failure);
  } else {
    await printCompletion(write, s, exec, failure);
  }
  return exec;
}

// Best-effort usage fetch; a failure here must not fail the run (the summary
// renders without the token count).
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
async function printSessionExit(
  write: Write,
  s: Styler,
  sessionId: string,
  exec: Run,
  usage: UsageReportAggregate | undefined,
  failure: () => Promise<string>,
): Promise<void> {
  const phase = exec.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  const duration = formatDuration(exec.status?.startedAt ?? "", exec.status?.completedAt ?? "");
  const tokens = formatRunTokens(usage);

  switch (phase) {
    case RunPhase.RUN_COMPLETED:
      write(s.green(completedLine(duration, tokens)));
      break;
    case RunPhase.RUN_FAILED:
      write(s.red(`✗ Failed: ${await failure()}`));
      break;
    case RunPhase.RUN_CANCELLED:
      write(s.yellow("Cancelled"));
      break;
    case RunPhase.RUN_TERMINATED:
      write(s.yellow(`Stopped: ${await failure()}`));
      break;
    default:
      write(s.yellow(`Exited (${formatAgentPhase(phase)})`));
  }

  write("");
  write(`  ${resumeVerb(phase)}  stigmer resume ${sessionId}`);
}

// Non-session completion (rare for run; e.g. a degraded backend). Mirrors the
// information of Go's displayAgentExecutionComplete without the panel chrome.
async function printCompletion(write: Write, s: Styler, exec: Run, failure: () => Promise<string>): Promise<void> {
  const phase = exec.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  if (phase === RunPhase.RUN_FAILED) {
    write(s.red(`✗ Run failed: ${await failure()}`));
    return;
  }
  write(s.green(`✓ Run ${formatAgentPhase(phase)}`));
}

function completedLine(duration: string, tokens: string): string {
  const parts = [duration, tokens].filter((part) => part !== "");
  return parts.length > 0 ? `✓ Completed (${parts.join(" · ")})` : "✓ Completed";
}

// "18.4k tokens", or "" when the report is missing or counted none. The run
// aggregate carries no estimated flag of its own: a run counted from its
// runner's report adds tokens and no metered calls, so tokens with zero calls
// read as estimated ("~18.4k tokens").
function formatRunTokens(usage: UsageReportAggregate | undefined): string {
  if (usage === undefined || usage.totalTokens <= 0n) return "";
  const estimated = usage.llmCallCount === 0 ? "~" : "";
  return `${estimated}${formatTokenCount(usage.totalTokens)} tokens`;
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

// The run's own error, else what the turn's events say (module header), else
// a generic pointer to the logs.
async function resolveFailureError(
  client: Stigmer,
  sessionId: string,
  runId: string,
  exec: Run,
  folded: Turn | undefined,
): Promise<string> {
  const error = exec.status?.error ?? "";
  if (error !== "") return error;
  const turn = folded ?? (await readTurn(client, sessionId, runId));
  if (turn === undefined) return GENERIC_FAILURE;
  if (turn.status !== undefined && turn.status.error !== "") return turn.status.error;
  const lastError = turn.errors.at(-1);
  if (lastError !== undefined && lastError.message !== "") return lastError.message;
  const note = [...turn.items].reverse().find((item): item is NoteItem => item.kind === "note" && item.text !== "");
  if (note !== undefined) return note.text;
  return firstFailedOutput(turn.items) ?? GENERIC_FAILURE;
}

// The turn as its events fold; undefined outside a session.
async function readTurn(client: Stigmer, sessionId: string, runId: string): Promise<Turn | undefined> {
  if (sessionId === "") return undefined;
  return turnOf(foldSession(await listSessionEvents(client, sessionId, runId)), runId);
}

// The output of the first tool use that failed, a subagent's included.
function firstFailedOutput(items: readonly TurnItem[]): string | undefined {
  for (const item of items) {
    if (item.kind !== "tool_use") continue;
    const text = item.result?.text ?? "";
    if (item.state === "failed" && text !== "") return text;
    const nested = item.thread === undefined ? undefined : firstFailedOutput(item.thread.items);
    if (nested !== undefined) return nested;
  }
  return undefined;
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
