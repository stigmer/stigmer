/**
 * Platform rows: the MESSAGE_SYSTEM lines the server itself writes into
 * an execution's transcript, and the transcript rules that keep them.
 * The runner owns the transcript; these are the few rows only the
 * platform can write, because only the platform knows the fact they
 * state (stigmer#980).
 *
 * - Stop rows say why a run stopped when the stop came from outside the
 *   turn. The runner cannot tell a Pause from a Cancel: both reach its
 *   activity as the same Temporal cancellation (reason CANCELLED), and
 *   both RPCs signal the engine before they persist the phase
 *   (lifecycle.ts), so no stored fact distinguishes them in time. The
 *   invoke workflow knows which stop it is running, so it writes the row
 *   (workflows/invoke-agent-execution.ts) and the runner writes none.
 * - A platform marker write is a status update whose messages are all
 *   MESSAGE_SYSTEM and do not extend the stored transcript: the
 *   workflow's stop rows and its broken-flow failure lines. A marker is
 *   appended, never substituted for the transcript. Every runner write
 *   is a superset of the stored transcript (a resumed runner seeds from
 *   it, runner/src/harness/turn-context.ts) and the runner only ever
 *   appends system rows, so a runner write never reads as a marker.
 *
 * Messages carry no id (agentexecution/v1/message.proto), so rows are
 * identified by type and content: the stop copy is these exact
 * constants, defined once here for the workflow and the merge, and never
 * matched against copy some other component authors.
 *
 * Pure (protos only): the workflow bundle imports this module by direct
 * path (src/temporal/README.md, workflow-bundle import discipline).
 */
import {
  ExecutionPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

/** The stop row of a paused execution. Byte-identical to the copy the runner wrote before stigmer#980 moved it here. */
export const PAUSE_STOP_ROW =
  "Execution paused by user. Use resume to continue.";

/** The stop row of a cancelled execution: a quiet terminal state, never a failure (stigmer#282). */
export const CANCEL_STOP_ROW = "Execution was cancelled.";

/** The stop row a phase carries, or undefined for a phase the platform does not explain. */
export function stopRowForPhase(phase: ExecutionPhase): string | undefined {
  switch (phase) {
    case ExecutionPhase.EXECUTION_PAUSED:
      return PAUSE_STOP_ROW;
    case ExecutionPhase.EXECUTION_CANCELLED:
      return CANCEL_STOP_ROW;
    default:
      return undefined;
  }
}

/** Whether two rows are the same row: messages carry no id, so identity is type and content. */
function sameRow(a: AgentMessage, b: AgentMessage): boolean {
  return a.type === b.type && a.content === b.content;
}

/** Whether transcript ends with tail, row for row. */
export function endsWithRows(
  transcript: readonly AgentMessage[],
  tail: readonly AgentMessage[],
): boolean {
  if (tail.length > transcript.length) {
    return false;
  }
  const offset = transcript.length - tail.length;
  return tail.every((row, i) => sameRow(transcript[offset + i], row));
}

/**
 * Whether incoming is a platform marker write against existing: every
 * incoming row is MESSAGE_SYSTEM, and it does not extend a non-empty
 * stored transcript (existing is not a row-for-row prefix of incoming).
 * An all-system write that does extend it is the runner's own growth; a
 * write onto an empty transcript has nothing to preserve.
 */
export function isPlatformMarkerWrite(
  existing: readonly AgentMessage[],
  incoming: readonly AgentMessage[],
): boolean {
  if (existing.length === 0 || incoming.length === 0) {
    return false;
  }
  if (!incoming.every((row) => row.type === MessageType.MESSAGE_SYSTEM)) {
    return false;
  }
  const extendsExisting =
    incoming.length >= existing.length &&
    existing.every((row, i) => sameRow(row, incoming[i]));
  return !extendsExisting;
}

/**
 * Appends a marker write's rows to the transcript; a retry of a marker
 * already at the transcript's end appends nothing, so the workflow's
 * activity retries stay idempotent.
 */
export function appendPlatformMarker(
  existing: readonly AgentMessage[],
  marker: readonly AgentMessage[],
): AgentMessage[] {
  if (endsWithRows(existing, marker)) {
    return [...existing];
  }
  return [...existing, ...marker];
}

/**
 * The stop row the merge holds last: the stored transcript's final row
 * when it is the stored phase's own stop row. While the execution rests
 * in that phase, the row is the platform's, not part of what the runner's
 * later writes replace; once the phase moves on (a resume), it is
 * ordinary history and nothing is held.
 */
export function heldStopRow(
  phase: ExecutionPhase,
  transcript: readonly AgentMessage[],
): AgentMessage | undefined {
  const copy = stopRowForPhase(phase);
  const last = transcript[transcript.length - 1];
  if (
    copy === undefined ||
    last === undefined ||
    last.type !== MessageType.MESSAGE_SYSTEM ||
    last.content !== copy
  ) {
    return undefined;
  }
  return last;
}
