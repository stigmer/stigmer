/**
 * The file-change-set projection SEAM — ports filereview/project.go.
 *
 * projectFileChangeSets is the single entry point every status writer
 * uses to recompute AgentExecutionStatus.file_change_sets from the
 * append-only file_review ledger — exactly as projectPendingApprovals is
 * for approvals. A PURE read: authoring is the capture/reconcile
 * activities' and recordFileDecisionEvent's job, run before this
 * projection.
 *
 * Unlike the approval seam there is NO scan cross-check and NO divergence
 * counter: file review is a greenfield, single-source ledger (no legacy
 * second representation exists to disagree with). The cross-edition
 * parity guard is the shared corpus.
 *
 * "Actionable" is execution-phase-aware: a terminal execution has no
 * actionable review (the workflow that would reconcile is gone), so the
 * seam returns empty for a terminal phase. The durable audit trail lives
 * in the ledger, always preserved regardless of phase.
 */
import { create } from "@bufbuild/protobuf";

import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  FileChangeSetStatus,
  FileDecisionScope,
  FileReviewEventType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  FileChangeSet,
  FileReviewEvent,
  FileReviewEventStream,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileChangeSetSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";

export function projectFileChangeSets(
  phase: ExecutionPhase,
  stream: FileReviewEventStream | undefined,
): FileChangeSet[] {
  if (isTerminalExecution(phase)) {
    return [];
  }
  if (stream === undefined || stream.events.length === 0) {
    return [];
  }

  const order: string[] = [];
  const byId = new Map<string, FileChangeSet>();
  for (const ev of stream.events) {
    const csId = ev.changeSetId;
    if (csId === "") {
      continue;
    }
    let cs = byId.get(csId);
    if (cs === undefined) {
      cs = create(FileChangeSetSchema, { id: csId });
      byId.set(csId, cs);
      order.push(csId);
    }
    applyEvent(cs, ev);
  }

  return order.map((id) => byId.get(id) as FileChangeSet);
}

/**
 * Folds a single ledger event into the change set being built. Event
 * order is the ledger order; terminal events (RECONCILED / FAILED) set a
 * terminal status that later non-terminal recomputation does not
 * override.
 */
function applyEvent(cs: FileChangeSet, ev: FileReviewEvent): void {
  switch (ev.eventType) {
    case FileReviewEventType.BASELINE_CAPTURED: {
      if (ev.payload.case === "baselineCaptured") {
        const b = ev.payload.value;
        cs.turnId = b.turnId;
        cs.harnessId = b.harnessId;
        cs.baselineSnapshot = b.baselineSnapshot;
      }
      cs.status = FileChangeSetStatus.CAPTURING;
      break;
    }
    case FileReviewEventType.CANDIDATE_CAPTURED: {
      if (ev.payload.case === "candidateCaptured") {
        const c = ev.payload.value;
        cs.candidateSnapshot = c.candidateSnapshot;
        cs.changes = c.changes;
        cs.aggregateDigest = c.aggregateDigest;
        cs.diffCompleteness = c.diffCompleteness;
      }
      cs.status = deriveStatusAfterCandidate(cs);
      break;
    }
    case FileReviewEventType.FILE_DECIDED: {
      if (ev.payload.case === "fileDecided") {
        cs.decisions.push(ev.payload.value);
      }
      cs.status = deriveStatusAfterCandidate(cs);
      break;
    }
    case FileReviewEventType.RECONCILED: {
      if (ev.payload.case === "reconciled") {
        cs.approvedSnapshot = ev.payload.value.approvedSnapshot;
      }
      cs.status = FileChangeSetStatus.RECONCILED;
      break;
    }
    case FileReviewEventType.FAILED: {
      cs.status = FileChangeSetStatus.FAILED;
      break;
    }
    default:
      break;
  }
}

/**
 * The non-terminal status once a candidate exists: DECIDED when every
 * change is decided, otherwise AWAITING_REVIEW (partially-decided sets
 * stay actionable). Never downgrades a terminal status.
 */
function deriveStatusAfterCandidate(cs: FileChangeSet): FileChangeSetStatus {
  switch (cs.status) {
    case FileChangeSetStatus.RECONCILED:
    case FileChangeSetStatus.FAILED:
      return cs.status;
    default:
      break;
  }
  if (isFullyDecided(cs)) {
    return FileChangeSetStatus.DECIDED;
  }
  return FileChangeSetStatus.AWAITING_REVIEW;
}

/**
 * Whether every change in the set has a verdict: either a
 * CHANGE_SET-scoped decision (covers all), or a FILE decision per change.
 */
function isFullyDecided(cs: FileChangeSet): boolean {
  if (cs.changes.length === 0) {
    return false;
  }
  const decidedFiles = new Set<string>();
  for (const d of cs.decisions) {
    if (d.scope === FileDecisionScope.CHANGE_SET) {
      return true;
    }
    if (d.scope === FileDecisionScope.FILE) {
      decidedFiles.add(d.fileChangeId);
    }
  }
  return cs.changes.every((c) => decidedFiles.has(c.id));
}

/**
 * Mirrors the approval package's terminal-phase set exactly, so the two
 * projections collapse identically on a dead execution.
 */
export function isTerminalExecution(phase: ExecutionPhase): boolean {
  switch (phase) {
    case ExecutionPhase.EXECUTION_COMPLETED:
    case ExecutionPhase.EXECUTION_FAILED:
    case ExecutionPhase.EXECUTION_CANCELLED:
    case ExecutionPhase.EXECUTION_TERMINATED:
      return true;
    default:
      return false;
  }
}
