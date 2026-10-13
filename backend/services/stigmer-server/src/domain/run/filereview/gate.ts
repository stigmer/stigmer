/**
 * The HITL resume gate. One lifecycle blocks a turn: its asks. File
 * review never does: a turn with review on ends normally with its edits
 * applied, and its change sets are decided after it (stigmer#1471 is the
 * turn that waited for a review only Stigmer's console could give).
 *
 * The gate is the turn's open asks in its session's log: a tool use the
 * runner wrote with evaluated_permission `ask` that no
 * user.tool_confirmation and no result of the same run has closed
 * (domain/session/events/gates.ts). The workflow counts them with the
 * CountOpenGates activity (store/session-events.ts `openGates`); an answer
 * counts them under the lock it records with
 * (domain/session/hitl/answer.ts `openAsksOf`). One fact, so the workflow's
 * wake condition and an answer's signal can never disagree about whether
 * the turn may resume.
 *
 * `unresolvedGateCountOfJson` is the gate a history recorded before that
 * count replays (OPEN_GATES_FROM_LOG_PATCH_ID in
 * temporal/agentexecution/names.ts): the length of the pending approvals
 * in the run JSON its load returned. The contract no longer has the
 * field, so it is read from the recorded JSON as written, which gives the
 * replay the count the original run saw.
 *
 * Bundle-safe: the invoke workflow imports this module by direct path.
 */
import type { JsonValue } from "@bufbuild/protobuf";

/** The gate a replayed history read: the pending approvals in its recorded run JSON (module header). */
export function unresolvedGateCountOfJson(run: JsonValue): number {
  const status = field(run, "status");
  const pending = field(status, "pendingApprovals") ?? field(status, "pending_approvals");
  return Array.isArray(pending) ? pending.length : 0;
}

/** A JSON object's field, or undefined when the value is not an object. */
function field(value: JsonValue | undefined, name: string): JsonValue | undefined {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value[name];
}

/** Whether the HITL gate is clear — the turn may resume: none of its asks is open. */
export function gateResolved(openGates: number): boolean {
  return openGates === 0;
}
