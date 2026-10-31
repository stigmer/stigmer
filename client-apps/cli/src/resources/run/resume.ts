// Re-opening an existing session. Fetch the session + its runs, then either:
//   - re-attach when the latest run is still active: the headless driver
//     follows the session's log from its start, so the history is replayed
//     and the latest turn followed to its end, or
//   - replay the session's stored events when everything has finished.
// The TTY path defers to Ink's SessionView, which loads history and offers a
// follow-up composer for free. Under `--until turn` it returns when the
// working turn ends, or, with none working, once the history has drawn.
// Either way the command exits by the newest turn's phase, as `run` does
// (stream.ts, `exitByTurn`).

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase, InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { BackendClient } from "../../client/index.js";
import { getSessionById, listRunsBySession, listSessionEvents } from "../session.js";
import { renderReplay } from "../stream/headless.js";
import { NdjsonRenderer } from "../stream/render-ndjson.js";
import { PlaintextRenderer } from "../stream/render-plaintext.js";
import { isInkSupported } from "../stream/tty.js";
import { renderSessionHeader, type SessionHeaderInfo, workspaceNames } from "./header.js";
import { localWorkspaceRoots } from "./workspace.js";
import type { RunMode } from "./prepare.js";
import { exitByTurn, newestRunId, streamAgentRun, type RunOutputMode, type RunUntil } from "./stream.js";

// The backend's auto-create sentinel; suppressed in the header until the async
// title activity replaces it.
const PENDING_SUBJECT = "Auto-created session";

// Phases where the latest run is still producing output — re-attach live.
const ACTIVE_PHASES: ReadonlySet<RunPhase> = new Set([
  RunPhase.RUN_PENDING,
  RunPhase.RUN_IN_PROGRESS,
  RunPhase.RUN_WAITING_FOR_APPROVAL,
  RunPhase.RUN_PAUSED,
]);

export interface OpenSessionDeps {
  readonly client: BackendClient;
  readonly sessionId: string;
  /** Explicit --mode override; "" means infer from the latest run. */
  readonly mode: RunMode;
  readonly outputMode: RunOutputMode;
  /** On a terminal: return when the person leaves (the default) or when the newest turn ends. */
  readonly until?: RunUntil;
}

export async function openSession(deps: OpenSessionDeps): Promise<void> {
  const stigmer = deps.client.stigmer;
  const session = await getSessionById(stigmer, deps.sessionId);
  // Every turn in the session is filed under the session's own organization
  // (stigmer/stigmer#1580), never the CLI's context organization.
  const org = session.metadata?.org ?? "";
  const entries = await listRunsBySession(stigmer, deps.sessionId);
  if (entries.length === 0) {
    process.stderr.write(`Session ${deps.sessionId} has no runs\n`);
    return;
  }

  const latest = entries[0];
  const phase = latest.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  const effectiveMode = resolveResumeMode(deps.mode, latest);

  const header: SessionHeaderInfo = {
    agentName: "",
    sessionId: deps.sessionId,
    subject: resolvedSubject(session.spec?.subject ?? ""),
    model: "",
    mode: effectiveMode,
    workspaces: workspaceNames(session.spec?.resources ?? []),
  };

  if (ACTIVE_PHASES.has(phase)) {
    // Live re-attach reuses the exact run streaming stack.
    const newest = await streamAgentRun({
      client: stigmer,
      sessionId: deps.sessionId,
      runId: latest.metadata?.id ?? "",
      org,
      mode: effectiveMode,
      approveDefault: "",
      outputMode: deps.outputMode,
      header,
      workspaceRoots: localWorkspaceRoots(session.spec?.resources ?? []),
      until: deps.until ?? "exit",
    });
    exitByTurn(newest);
    return;
  }

  await replaySession(deps, org, header, localWorkspaceRoots(session.spec?.resources ?? []), latest);
}

// Completed session: render the stored history. TTY → Ink (history + composer);
// headless → the session's stored events through the matching renderer.
async function replaySession(
  deps: OpenSessionDeps,
  org: string,
  header: SessionHeaderInfo,
  workspaceRoots: readonly string[],
  latest: Run,
): Promise<void> {
  const latestId = latest.metadata?.id ?? "";
  if (deps.outputMode === "inline" && isInkSupported(process.stdout)) {
    const { runInkSession } = await import("../stream/ink.js");
    await runInkSession({
      client: deps.client.stigmer,
      sessionId: deps.sessionId,
      org,
      mode: header.mode === "plan" ? "plan" : "agent",
      workspaceRoots,
      // The newest turn has ended: under --until turn, its end at load returns.
      until: deps.until ?? "exit",
      watchRunId: latestId,
    });
    // Follow-ups may have been sent in the view: the newest turn decides.
    const stigmer = deps.client.stigmer;
    exitByTurn(await stigmer.run.get(await newestRunId(stigmer, deps.sessionId, latestId)));
    return;
  }

  renderSessionHeader(process.stderr, header);
  const events = await listSessionEvents(deps.client.stigmer, deps.sessionId);
  const renderer =
    deps.outputMode === "json"
      ? new NdjsonRenderer({ data: process.stdout, status: process.stderr })
      : new PlaintextRenderer({ data: process.stdout, status: process.stderr });
  renderReplay(events, renderer);
  exitByTurn(latest);
}

// --mode wins; else infer "plan" from the last
// run's InteractionMode; else default (agent).
function resolveResumeMode(explicit: RunMode, latest: Run): RunMode {
  if (explicit !== "") return explicit;
  if (latest.spec?.interactionMode === InteractionMode.PLAN) return "plan";
  return "";
}

function resolvedSubject(subject: string): string {
  return subject === PENDING_SUBJECT ? "" : subject;
}
