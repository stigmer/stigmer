// File-review (apply-then-review HITL) helpers for the execution suites.
// Domain: conformance support (execution engine).
//
// A turn that edits files in a git workspace does not gate per tool call: the
// runner captures the whole delta at the turn boundary and the server projects
// it onto status.file_change_sets as a FileChangeSet AWAITING_REVIEW while the
// execution sits in EXECUTION_WAITING_FOR_APPROVAL with ZERO pending_approvals
// (the two gates are siblings, not one). Decisions go through
// submitFileDecision at FILE or CHANGE_SET scope, bound to the digest the
// reviewer saw; the runner reconciles the approved bytes and the ledger records
// RECONCILED. These helpers are the read-and-decide vocabulary for that
// lifecycle, the way support/agentexecutions.ts is for the approval gate.
//
// Correlation is ALWAYS by stable id (change set id, file change id); digests
// are the enforcement gate the decision carries, never how a change is found
// (filereview.proto's identity rule). So a decision "by path" here looks the
// change up by path_after/path_before and then submits ITS id and ITS digest.
//
// Ported from the Go harness's file_review.go (entry 20260910.02); the wait
// semantics are its: a set AWAITING_REVIEW resolves the wait, a terminal phase
// before one appears fails it with the phase, and the mid-run progress wait
// keys on a settled predicate because the runner's first streaming persist can
// legitimately carry files_changed = 0.
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
  FileReviewEventType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  CapturedFileChange,
  FileChangeProgress,
  FileChangeSet,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type { ConformanceClients } from "../harness/clients";
import { isTerminalPhase, pollExecution, type PollOptions } from "./agentexecutions";

// Polls until a change set is offered for review. Fails — with the phase — if
// the execution ends first (the agent edited nothing, or every edit landed on a
// path that stays true-paused), so a wrong fixture is a legible failure rather
// than a timeout.
export function awaitFileReview(
  clients: ConformanceClients,
  executionId: string,
  opts: PollOptions = {},
): Promise<AgentExecution> {
  return pollExecution(
    clients,
    executionId,
    (exec) => {
      if (findChangeSet(exec, FileChangeSetStatus.AWAITING_REVIEW) !== undefined) return true;
      if (isTerminalPhase(exec.status?.phase)) {
        throw new Error(
          `execution ${executionId} reached terminal phase before any change set was offered for review ` +
            `(status.error: ${JSON.stringify(exec.status?.error ?? "")})`,
        );
      }
      return false;
    },
    { label: "a change set AWAITING_REVIEW", ...opts },
  );
}

// Polls until a MID-RUN file_change_progress snapshot satisfies `settled` while
// a CAPTURING set exists — the transient pre-boundary window. The predicate is
// load-bearing (header): pass a target that is stable for the whole capturing
// span, e.g. `(p) => p.filesChanged === 2`.
export function awaitFileChangeProgress(
  clients: ConformanceClients,
  executionId: string,
  settled: (progress: FileChangeProgress) => boolean,
  opts: PollOptions = {},
): Promise<AgentExecution> {
  return pollExecution(
    clients,
    executionId,
    (exec) => {
      const progress = exec.status?.fileChangeProgress;
      const capturing = findChangeSet(exec, FileChangeSetStatus.CAPTURING);
      if (capturing !== undefined && progress !== undefined && settled(progress)) return true;
      if (isTerminalPhase(exec.status?.phase)) {
        throw new Error(
          `execution ${executionId} reached terminal phase before a mid-run file_change_progress snapshot ` +
            `satisfied the predicate (last progress: ${JSON.stringify(progress ?? null)})`,
        );
      }
      return false;
    },
    { label: "a settled mid-run file_change_progress snapshot", ...opts },
  );
}

// The first projected change set in `status`, if any — the file-review analogue
// of scanning pending_approvals.
export function findChangeSet(exec: AgentExecution, status: FileChangeSetStatus): FileChangeSet | undefined {
  return exec.status?.fileChangeSets.find((set) => set.status === status);
}

// The set AWAITING_REVIEW, which every decide-and-continue arm starts from;
// throws when absent so an assertion never dereferences a missing set.
export function requireReviewSet(exec: AgentExecution): FileChangeSet {
  const set = findChangeSet(exec, FileChangeSetStatus.AWAITING_REVIEW);
  if (set === undefined) {
    throw new Error(
      `execution ${exec.metadata?.id ?? "?"} has no change set AWAITING_REVIEW ` +
        `(sets: ${JSON.stringify(exec.status?.fileChangeSets.map((s) => FileChangeSetStatus[s.status]))})`,
    );
  }
  return set;
}

// The change for a workspace-relative path: path_after for ADD/MODIFY/RENAME,
// path_before for DELETE. Throws when absent so a typo in an arm is a named
// failure, not an undefined dereference.
export function requireChangeByPath(set: FileChangeSet, path: string): CapturedFileChange {
  const change = set.changes.find((c) => c.pathAfter === path || c.pathBefore === path);
  if (change === undefined) {
    throw new Error(
      `change set ${set.id} has no change for ${path} ` +
        `(paths: ${JSON.stringify(set.changes.map((c) => c.pathAfter || c.pathBefore))})`,
    );
  }
  return change;
}

export interface FileDecisionOptions {
  // Overrides the digest the decision is bound to. The default is the target's
  // CURRENT digest (what the reviewer saw); an arm passes a stale value to
  // prove the enforcement gate refuses it.
  expectedDigest?: string;
  // Consciously keep a binary change whose diff cannot be shown (APPROVE at
  // FILE scope only, per SubmitFileDecisionInput).
  acknowledgeUnreviewable?: boolean;
  reason?: string;
}

// Decides one file, correlating by the change's id and binding to its
// file_digest. Returns the server's response (the execution as the handler
// left it) so an arm can assert the projection synchronously.
export function submitFileDecisionByPath(
  clients: ConformanceClients,
  executionId: string,
  set: FileChangeSet,
  path: string,
  action: FileDecisionAction,
  opts: FileDecisionOptions = {},
): Promise<AgentExecution> {
  const change = requireChangeByPath(set, path);
  return clients.agentExecutionCommand.submitFileDecision({
    agentExecutionId: executionId,
    changeSetId: set.id,
    scope: FileDecisionScope.FILE,
    fileChangeId: change.id,
    action,
    expectedDigest: opts.expectedDigest ?? change.fileDigest,
    acknowledgeUnreviewable: opts.acknowledgeUnreviewable ?? false,
    reason: opts.reason ?? "",
  });
}

// Decides the whole set, bound to its aggregate_digest.
export function submitChangeSetDecision(
  clients: ConformanceClients,
  executionId: string,
  set: FileChangeSet,
  action: FileDecisionAction,
  opts: FileDecisionOptions = {},
): Promise<AgentExecution> {
  return clients.agentExecutionCommand.submitFileDecision({
    agentExecutionId: executionId,
    changeSetId: set.id,
    scope: FileDecisionScope.CHANGE_SET,
    action,
    expectedDigest: opts.expectedDigest ?? set.aggregateDigest,
    acknowledgeUnreviewable: opts.acknowledgeUnreviewable ?? false,
    reason: opts.reason ?? "",
  });
}

// Whether the file-review ledger records `type` for `changeSetId` (any set when
// omitted). The ledger is the source of truth the projection is derived from,
// so RECONCILED here is the proof the runner applied the decision.
export function fileReviewStreamHas(
  exec: AgentExecution,
  type: FileReviewEventType,
  changeSetId?: string,
): boolean {
  return (exec.status?.fileReviewEventStream?.events ?? []).some(
    (event) => event.eventType === type && (changeSetId === undefined || event.changeSetId === changeSetId),
  );
}
