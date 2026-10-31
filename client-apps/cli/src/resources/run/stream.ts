// Renderer dispatch for a created run. One of three paths is selected from
// the output mode and TTY:
//
//   --json            → headless NDJSON (stdout): each session event as Managed Agents JSON
//   inline + TTY      → in-process Ink (SessionView), lazily imported
//   inline + non-TTY  → headless plaintext (piped stdout), drawn from the fold
//
// All three converge on the same epilogue (final Get + usage summary). The
// headless paths share one driver (runHeadlessStream) over the SDK's
// followSession, folded by SessionLog; asks are answered through the
// session's confirmToolUse / grantPermission.
//
// How it ends (the CLI's rule, client-apps/AGENTS.md):
// - Off a terminal and with -o json the stream returns when the run's turn
//   ends. On a terminal the view stays a conversation until the person
//   leaves (`until: "exit"`), or returns when the run's turn ends
//   (`until: "turn"`).
// - `downloadDir` saves each turn's outputs as that turn ends: in the view
//   for every turn seen ending (and the run this command started, even when
//   it ended before the view loaded), told as a note in the thread; headless,
//   the one turn, once it ends.
// - The returned Run is the session's newest turn, the one the exit summary
//   reports, and `exitByTurn` turns its phase into the exit code through the
//   shared table (`exitCodeOf`): 0 completed; 1 failed, cancelled or
//   stopped; 130 when the person left while it still works.

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { followSession, turnPhaseOf, type Stigmer, type Turn } from "@stigmer/client";
import { exitCodeOf } from "@stigmer/client/node";
import { CliExitError, ExitCode } from "../../errors/index.js";
import { downloadRunOutputs, type ProgressSink } from "../download.js";
import { listRunsBySession } from "../session.js";
import { runEpilogue } from "./epilogue.js";
import { renderSessionHeader, type SessionHeaderInfo } from "./header.js";
import type { RunMode } from "./prepare.js";
import { submitAnswer, type ApproveDefault } from "../stream/answer.js";
import { runHeadlessStream, type HeadlessRenderer, type HeadlessResult } from "../stream/headless.js";
import { NdjsonRenderer } from "../stream/render-ndjson.js";
import { PlaintextRenderer } from "../stream/render-plaintext.js";
import { isInkSupported } from "../stream/tty.js";

/** The user-selected output mode for a streaming command. */
export type RunOutputMode = "inline" | "json";

/** When a terminal run returns: when the person leaves, or when its turn ends. */
export type RunUntil = "turn" | "exit";

export interface StreamDeps {
  readonly client: Stigmer;
  readonly sessionId: string;
  readonly runId: string;
  /** Org slug, for follow-up runs created from the Ink composer. */
  readonly org: string;
  readonly mode: RunMode;
  readonly approveDefault: ApproveDefault;
  readonly outputMode: RunOutputMode;
  readonly header: SessionHeaderInfo;
  /** The session's local folders, which the Ink composer's `@` completes paths under. */
  readonly workspaceRoots?: readonly string[];
  /** Takes back the progress lines written before the run, so the Ink view starts clean. */
  readonly clearProgress?: () => void;
  /** On a terminal: return when the person leaves ("exit", the default) or when `runId`'s turn ends. */
  readonly until?: RunUntil;
  /** Where each turn's outputs are saved as it ends; "" or absent saves nothing. */
  readonly downloadDir?: string;
  /** Where headless download lines go (stderr on a terminal); none by default. */
  readonly progress?: ProgressSink;
}

/**
 * Stream the run to its end, then run the epilogue. Returns the
 * authoritative final run (for downloading its outputs).
 */
export async function streamAgentRun(deps: StreamDeps): Promise<Run> {
  if (deps.outputMode === "json") {
    renderSessionHeader(process.stderr, deps.header);
    const result = await runHeadless(deps, new NdjsonRenderer({ data: process.stdout, status: process.stderr }));
    return downloadHeadless(deps, await runEpilogue(deps.client, deps.sessionId, deps.runId, result));
  }

  if (isInkSupported(process.stdout)) {
    deps.clearProgress?.();
    await runInk(deps);
    // Ink owns the live view; the epilogue still prints the exit summary, of
    // the session's newest turn: the person may have sent follow-ups since
    // the run this command started (stigmer#2781).
    const runId = await newestRunId(deps.client, deps.sessionId, deps.runId);
    return runEpilogue(deps.client, deps.sessionId, runId, { phase: "", error: "", turn: undefined });
  }

  renderSessionHeader(process.stderr, deps.header);
  const result = await runHeadless(deps, new PlaintextRenderer({ data: process.stdout, status: process.stderr }));
  return downloadHeadless(deps, await runEpilogue(deps.client, deps.sessionId, deps.runId, result));
}

/**
 * The exit code for how a run's turn ended, from the shared table: 0
 * completed; 1 failed, cancelled or stopped; 130 still working (the person
 * left first). A run whose phase is unknown exits 1.
 */
export function turnExitCode(run: Run): ExitCode {
  const phase = turnPhaseOf(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED);
  return phase === undefined ? ExitCode.General : exitCodeOf({ phase });
}

/** Exit by the turn's code (`turnExitCode`): silently, since the summary already said how it ended. */
export function exitByTurn(run: Run): void {
  const code = turnExitCode(run);
  if (code !== ExitCode.Success) throw new CliExitError("", code);
}

// Off a terminal the stream returned at the turn's end: save its outputs now.
async function downloadHeadless(deps: StreamDeps, run: Run): Promise<Run> {
  if ((deps.downloadDir ?? "") !== "") {
    await saveTurnOutputs(deps.client, run.metadata?.id ?? "", deps.downloadDir ?? "", deps.progress ?? (() => undefined));
  }
  return run;
}

/** Save one turn's outputs under `outputDir`, saying so through `say`; a turn that saved none says that. */
export async function saveTurnOutputs(client: Stigmer, runId: string, outputDir: string, say: ProgressSink): Promise<void> {
  const outcome = await downloadRunOutputs(client, runId, { outputPath: "", outputDir }, say);
  if (outcome.noOutputs) say("No outputs saved in this turn.");
}

// Drive a headless renderer over the session's log, with Ctrl-C wired to stop
// the follow cleanly (the driver treats an aborted signal as a clean exit and
// the epilogue prints the phase).
async function runHeadless(deps: StreamDeps, renderer: HeadlessRenderer): Promise<HeadlessResult> {
  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    return await runHeadlessStream({
      follow: (signal) => followSession(deps.client, deps.sessionId, { signal }),
      answer: (toolUseId, answer) => submitAnswer(deps.client, deps.sessionId, toolUseId, answer),
      approveDefault: deps.approveDefault,
      renderer,
      sessionId: deps.sessionId,
      runId: deps.runId,
      signal: controller.signal,
    });
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

// The session's newest run, or `fallback` when the list cannot be read.
export async function newestRunId(client: Stigmer, sessionId: string, fallback: string): Promise<string> {
  try {
    const runs = await listRunsBySession(client, sessionId);
    return runs[0]?.metadata?.id || fallback;
  } catch {
    return fallback;
  }
}

// Lazily import the Ink renderer so React/Ink load only on the interactive path
// (non-streaming commands and --help never pay for them).
async function runInk(deps: StreamDeps): Promise<void> {
  const { runInkSession } = await import("../stream/ink.js");
  await runInkSession({
    client: deps.client,
    sessionId: deps.sessionId,
    org: deps.org,
    mode: deps.mode === "plan" ? "plan" : "agent",
    workspaceRoots: deps.workspaceRoots,
    until: deps.until ?? "exit",
    watchRunId: deps.runId,
    afterTurn: turnDownloader(deps.client, deps.downloadDir ?? "", deps.runId),
  });
}

/**
 * The view's per-turn action under `--download`: save each turn's outputs as
 * it ends, the turns that had ended before the view loaded left alone, except
 * the run this command started (it may end before the view loads). None
 * without a directory.
 */
export function turnDownloader(
  client: Stigmer,
  outputDir: string,
  startedRunId: string,
): ((turn: Turn, atLoad: boolean, say: ProgressSink) => Promise<void>) | undefined {
  if (outputDir === "") return undefined;
  return async (turn, atLoad, say) => {
    if (atLoad && turn.runId !== startedRunId) return;
    await saveTurnOutputs(client, turn.runId, outputDir, say);
  };
}
