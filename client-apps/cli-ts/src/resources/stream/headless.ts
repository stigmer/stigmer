// The headless stream driver: subscribe → diff → render → resolve approvals.
//
// This is the single-process analog of Go's renderer goroutine + approval
// channel (run_stream.go / run_stream_events.go). Go runs streamToEvents in one
// goroutine and the renderer in another, exchanging approvals over channels.
// Here it's one async loop: each snapshot is diffed, every event is rendered,
// and an ApprovalNeededEvent is resolved by the renderer's policy and submitted
// (with retry) before the loop blocks on the next snapshot — which is safe
// because the backend withholds further updates until the approval lands.

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SnapshotDiffer } from "./diff.js";
import type { ApprovalNeededEvent, StreamEvent } from "./events.js";
import {
  APPROVAL_RETRY_BASE_DELAY_MS,
  APPROVAL_RETRY_MAX_ATTEMPTS,
  classifyStreamError,
  retryWithBackoff,
} from "./submit.js";

/**
 * A headless renderer: turns each differ event into output and decides how to
 * resolve approvals. Both methods are synchronous — submission is the driver's
 * job. Implemented by NdjsonRenderer and PlaintextRenderer.
 */
export interface HeadlessRenderer {
  /** Render one event to the renderer's sinks. */
  render(event: StreamEvent): void;
  /** Choose the approval action for an emitted ApprovalNeededEvent (may warn). */
  resolveApproval(event: ApprovalNeededEvent): ApprovalAction;
}

/** The terminal outcome of a headless stream. */
export interface HeadlessResult {
  readonly phase: string;
  readonly error: string;
}

/** Dependencies for {@link runHeadlessStream}. */
export interface HeadlessStreamDeps {
  /** The execution snapshot source (the SDK's agentExecution.subscribe). */
  readonly subscribe: (signal: AbortSignal) => AsyncIterable<AgentExecution>;
  /** Submit one approval decision. The caller binds the execution + RPC. */
  readonly submitApproval: (toolCallId: string, action: ApprovalAction) => Promise<void>;
  readonly renderer: HeadlessRenderer;
  readonly sessionId: string;
  readonly signal: AbortSignal;
}

/**
 * Drive the stream to a terminal phase and return the outcome. Aborting (Ctrl-C)
 * resolves cleanly with an empty result; a dropped stream renders a stream_error
 * and returns its message.
 */
export async function runHeadlessStream(deps: HeadlessStreamDeps): Promise<HeadlessResult> {
  const differ = new SnapshotDiffer();
  try {
    for await (const snapshot of deps.subscribe(deps.signal)) {
      const terminal = await drainSnapshot(differ.next(snapshot), deps);
      if (terminal !== undefined) return terminal;
    }
    return { phase: "", error: "" };
  } catch (err) {
    if (deps.signal.aborted) return { phase: "", error: "" };
    const message = classifyStreamError(err, deps.sessionId);
    deps.renderer.render({ kind: "streamError", error: message });
    return { phase: "", error: message };
  }
}

// Render every event for one snapshot, resolving approvals as they appear.
// Returns the terminal result when a done/stream_error event is reached.
async function drainSnapshot(events: StreamEvent[], deps: HeadlessStreamDeps): Promise<HeadlessResult | undefined> {
  for (const event of events) {
    deps.renderer.render(event);

    if (event.kind === "approvalNeeded") {
      const failure = await resolveAndSubmit(event, deps);
      if (failure !== undefined) return failure;
    }
    if (event.kind === "done") return { phase: event.phase, error: event.error };
    if (event.kind === "streamError") return { phase: "", error: event.error };
  }
  return undefined;
}

// Resolve an approval via the renderer's policy and submit it with retry. On
// terminal submit failure, render a stream_error and return it (mirrors Go's
// emitAndWaitApproval, which surfaces a StreamErrorEvent the renderer treats as
// terminal). A successful submit returns undefined to continue the stream.
async function resolveAndSubmit(
  event: ApprovalNeededEvent,
  deps: HeadlessStreamDeps,
): Promise<HeadlessResult | undefined> {
  const action = deps.renderer.resolveApproval(event);
  try {
    await retryWithBackoff(deps.signal, APPROVAL_RETRY_MAX_ATTEMPTS, APPROVAL_RETRY_BASE_DELAY_MS, () =>
      deps.submitApproval(event.toolCallId, action),
    );
    return undefined;
  } catch (err) {
    if (deps.signal.aborted) return { phase: "", error: "" };
    let message = `Failed to submit approval after ${APPROVAL_RETRY_MAX_ATTEMPTS} attempts`;
    if (deps.sessionId !== "") message += `. Re-attach to retry: stigmer resume ${deps.sessionId}`;
    deps.renderer.render({ kind: "streamError", error: message });
    return { phase: "", error: message };
  }
}

/** Re-export so command wiring can reference the enum without a deep import. */
export { ApprovalAction };
