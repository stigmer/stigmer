// Re-opening an existing session (Go's openSession / resumeSession in
// resume_session.go). Fetch the session + its executions, then either:
//   - re-attach to the live stream when the latest execution is still active, or
//   - replay the full history (snapshotToEvents) when everything has finished.
// The TTY path defers to Ink's SessionView, which loads history and offers a
// follow-up composer for free.

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction, ExecutionPhase, InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { BackendClient } from "../../client/index.js";
import { getSessionById, listExecutionsBySession } from "../session.js";
import { NdjsonRenderer } from "../stream/render-ndjson.js";
import { PlaintextRenderer } from "../stream/render-plaintext.js";
import { snapshotToEvents } from "../stream/snapshot.js";
import { isInkSupported } from "../stream/tty.js";
import { renderSessionHeader, type SessionHeaderInfo, workspaceNames } from "./header.js";
import type { RunMode } from "./prepare.js";
import { streamAgentExecution, type RunOutputMode } from "./stream.js";

// The backend's auto-create sentinel; suppressed in the header until the async
// title activity replaces it (Go's session.PendingSubject / ResolvedSubject).
const PENDING_SUBJECT = "Auto-created session";

// Phases where the latest execution is still producing output — re-attach live.
const ACTIVE_PHASES: ReadonlySet<ExecutionPhase> = new Set([
  ExecutionPhase.EXECUTION_PENDING,
  ExecutionPhase.EXECUTION_IN_PROGRESS,
  ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
  ExecutionPhase.EXECUTION_PAUSED,
]);

export interface OpenSessionDeps {
  readonly client: BackendClient;
  readonly sessionId: string;
  readonly org: string;
  /** Explicit --mode override; "" means infer from the latest execution. */
  readonly mode: RunMode;
  readonly outputMode: RunOutputMode;
}

export async function openSession(deps: OpenSessionDeps): Promise<void> {
  const stigmer = deps.client.stigmer;
  const session = await getSessionById(stigmer, deps.sessionId);
  const entries = await listExecutionsBySession(stigmer, deps.sessionId);
  if (entries.length === 0) {
    process.stderr.write(`Session ${deps.sessionId} has no executions\n`);
    return;
  }

  const latest = entries[0];
  const phase = latest.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  const effectiveMode = resolveResumeMode(deps.mode, latest);

  const header: SessionHeaderInfo = {
    agentName: "",
    sessionId: deps.sessionId,
    subject: resolvedSubject(session.spec?.subject ?? ""),
    model: "",
    mode: effectiveMode,
    workspaces: workspaceNames(session.spec?.workspaceEntries ?? []),
  };

  if (ACTIVE_PHASES.has(phase)) {
    // Live re-attach reuses the exact run streaming stack.
    await streamAgentExecution({
      client: stigmer,
      sessionId: deps.sessionId,
      executionId: latest.metadata?.id ?? "",
      org: deps.org,
      mode: effectiveMode,
      defaultAction: ApprovalAction.UNSPECIFIED,
      outputMode: deps.outputMode,
      header,
    });
    return;
  }

  await replaySession(deps, entries, header);
}

// Completed session: render the stored history. TTY → Ink (history + composer);
// headless → snapshot events through the matching renderer.
async function replaySession(
  deps: OpenSessionDeps,
  entries: readonly AgentExecution[],
  header: SessionHeaderInfo,
): Promise<void> {
  if (deps.outputMode === "inline" && isInkSupported(process.stdout)) {
    const { runInkSession } = await import("../stream/ink.js");
    await runInkSession({
      client: deps.client.stigmer,
      sessionId: deps.sessionId,
      org: deps.org,
      mode: header.mode === "plan" ? "plan" : "agent",
    });
    return;
  }

  renderSessionHeader(process.stderr, header);
  const chronological = [...entries].reverse();
  const events = snapshotToEvents(chronological);
  const renderer =
    deps.outputMode === "json"
      ? new NdjsonRenderer({ data: process.stdout, status: process.stderr, defaultAction: ApprovalAction.UNSPECIFIED })
      : new PlaintextRenderer({ data: process.stdout, status: process.stderr });
  for (const event of events) renderer.render(event);
}

// Mirrors Go's resolveResumeMode: --mode wins; else infer "plan" from the last
// execution's InteractionMode; else default (agent).
function resolveResumeMode(explicit: RunMode, latest: AgentExecution): RunMode {
  if (explicit !== "") return explicit;
  if (latest.spec?.executionConfig?.interactionMode === InteractionMode.PLAN) return "plan";
  return "";
}

function resolvedSubject(subject: string): string {
  return subject === PENDING_SUBJECT ? "" : subject;
}
