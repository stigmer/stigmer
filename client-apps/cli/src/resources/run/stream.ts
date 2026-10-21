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

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { followSession, type Stigmer } from "@stigmer/client";
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
}

/**
 * Stream the run to its end, then run the epilogue. Returns the
 * authoritative final run (for downloading its outputs).
 */
export async function streamAgentRun(deps: StreamDeps): Promise<Run> {
  if (deps.outputMode === "json") {
    renderSessionHeader(process.stderr, deps.header);
    const result = await runHeadless(deps, new NdjsonRenderer({ data: process.stdout, status: process.stderr }));
    return runEpilogue(deps.client, deps.sessionId, deps.runId, result);
  }

  if (isInkSupported(process.stdout)) {
    await runInk(deps);
    // Ink owns the live view; the epilogue still prints the exit summary.
    return runEpilogue(deps.client, deps.sessionId, deps.runId, { phase: "", error: "", turn: undefined });
  }

  renderSessionHeader(process.stderr, deps.header);
  const result = await runHeadless(deps, new PlaintextRenderer({ data: process.stdout, status: process.stderr }));
  return runEpilogue(deps.client, deps.sessionId, deps.runId, result);
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

// Lazily import the Ink renderer so React/Ink load only on the interactive path
// (non-streaming commands and --help never pay for them).
async function runInk(deps: StreamDeps): Promise<void> {
  const { runInkSession } = await import("../stream/ink.js");
  await runInkSession({
    client: deps.client,
    sessionId: deps.sessionId,
    org: deps.org,
    mode: deps.mode === "plan" ? "plan" : "agent",
  });
}
