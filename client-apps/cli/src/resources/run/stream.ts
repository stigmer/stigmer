// Renderer dispatch for a created execution (Go's streamAgentExecution in
// run_stream.go). One of three paths is selected from the output mode and TTY:
//
//   --json            → headless NDJSON differ (stdout), Go's run --json taxonomy
//   inline + TTY      → in-process Ink (SessionView), lazily imported
//   inline + non-TTY  → headless plaintext differ (piped stdout)
//
// All three converge on the same epilogue (final Get + usage summary). The
// headless paths share one driver (runHeadlessStream) over the SDK's
// agentExecution.subscribe / submitApproval; the differ + renderers are the
// CLI-local port of Go's streamToEvents + handleJSONEvent.

import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SubmitApprovalInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { runEpilogue } from "./epilogue.js";
import { renderSessionHeader, type SessionHeaderInfo } from "./header.js";
import type { RunMode } from "./prepare.js";
import { runHeadlessStream, type HeadlessRenderer, type HeadlessResult } from "../stream/headless.js";
import { NdjsonRenderer } from "../stream/render-ndjson.js";
import { PlaintextRenderer } from "../stream/render-plaintext.js";
import { isInkSupported } from "../stream/tty.js";

/** The user-selected output mode for a streaming command. */
export type RunOutputMode = "inline" | "json";

export interface StreamDeps {
  readonly client: Stigmer;
  readonly sessionId: string;
  readonly executionId: string;
  /** Org slug, for follow-up executions created from the Ink composer. */
  readonly org: string;
  readonly mode: RunMode;
  readonly defaultAction: ApprovalAction;
  readonly outputMode: RunOutputMode;
  readonly header: SessionHeaderInfo;
}

/**
 * Stream the execution to a terminal phase, then run the epilogue. Returns the
 * authoritative final execution (for artifact download).
 */
export async function streamAgentExecution(deps: StreamDeps): Promise<AgentExecution> {
  if (deps.outputMode === "json") {
    renderSessionHeader(process.stderr, deps.header);
    const result = await runHeadless(deps, jsonRenderer(deps));
    return runEpilogue(deps.client, deps.sessionId, deps.executionId, result);
  }

  if (isInkSupported(process.stdout)) {
    await runInk(deps);
    // Ink owns the live view; the epilogue still prints the exit summary.
    return runEpilogue(deps.client, deps.sessionId, deps.executionId, { phase: "", error: "" });
  }

  renderSessionHeader(process.stderr, deps.header);
  const result = await runHeadless(deps, plaintextRenderer());
  return runEpilogue(deps.client, deps.sessionId, deps.executionId, result);
}

function jsonRenderer(deps: StreamDeps): HeadlessRenderer {
  return new NdjsonRenderer({ data: process.stdout, status: process.stderr, defaultAction: deps.defaultAction });
}

function plaintextRenderer(): HeadlessRenderer {
  return new PlaintextRenderer({ data: process.stdout, status: process.stderr });
}

// Drive a headless renderer over the SDK stream, with Ctrl-C wired to abort the
// subscription cleanly (Go cancels the stream context on signal; the driver
// treats an aborted signal as a clean exit and the epilogue prints the phase).
async function runHeadless(deps: StreamDeps, renderer: HeadlessRenderer): Promise<HeadlessResult> {
  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    return await runHeadlessStream({
      subscribe: (signal) => deps.client.agentExecution.subscribe(deps.executionId, signal),
      submitApproval: async (toolCallId, action) => {
        await deps.client.agentExecution.submitApproval(
          create(SubmitApprovalInputSchema, { agentExecutionId: deps.executionId, toolCallId, action }),
        );
      },
      renderer,
      sessionId: deps.sessionId,
      signal: controller.signal,
    });
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

// Lazily import the Ink renderer so React/Ink load only on the interactive path
// (DD-001 boundary — non-streaming commands and --help never pay for them).
async function runInk(deps: StreamDeps): Promise<void> {
  const { runInkSession } = await import("../stream/ink.js");
  await runInkSession({
    client: deps.client,
    sessionId: deps.sessionId,
    org: deps.org,
    mode: deps.mode === "plan" ? "plan" : "agent",
  });
}
