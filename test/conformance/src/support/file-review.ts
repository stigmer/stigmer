// File-review (apply-then-review) helpers for the execution suites.
// Domain: conformance support (execution engine).
//
// File review is the session's choice (spec.file_review, off unless set), and
// it never makes a turn wait. In a session that asks for it, a turn that
// edits files in a workspace the runner can capture lets every edit land, ends
// normally, and leaves its delta in two places: the captured files (ids,
// digests, bytes) on the run's file record, status.file_changes, and the offer
// in the log as stigmer.file_review.changes. A person then keeps or undoes it,
// at file or change_set scope and bound to the digest they saw, through
// SessionCommandController.reviewFileChanges. A keep only records the
// decision (stigmer.file_review.decided); an undo on a finished turn starts a
// reconcile turn that puts the files back and writes
// stigmer.file_review.reconciled. The file record holds no status and no
// decision: what is decided, and what is still undecided, is the log's,
// folded by @stigmer/session-log into each turn's review sets. These helpers
// are the read-and-decide vocabulary for that lifecycle.
//
// Correlation is ALWAYS by stable id (change set id, file change id); digests
// are the enforcement gate the decision carries, never how a change is found
// (filereview.proto's identity rule). So a decision "by path" here looks the
// change up by path_after/path_before and then submits ITS id and ITS digest.
//
// The review wait (`awaitFileReview`) resolves on the turn's end, never on the
// set's first appearance: a decision on a turn still working is honoured only
// by a later turn's start, so an arm that wants its undo reconciled at once
// decides a finished turn.
//
// The mid-run progress wait is different in kind: file_change_progress is a
// display snapshot the runner captures on its own persist cadence, and a
// capture runs while the tool that triggered the persist may still be writing
// (the runner's shared/filereview/progress.ts header, "What a capture may
// see"). So one snapshot can be a turn behind, half-written, or a turn ahead,
// and only the CONVERGED shape is a contract: an arm states the entries it
// expects and waits until a mid-run snapshot (the turn still working, its
// change set not yet captured) carries all of them with their counts (`awaitProgressEntries`), never for "the first snapshot with N
// files". Every progress wait records the distinct snapshots it saw and puts
// them in its failure message, because the sequence (say 0 -> 1 -> 3) is the
// diagnosis a bare timeout hides.
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type {
  SessionEvent,
  StigmerFileReviewChangesEvent,
  StigmerFileReviewDecidedEvent,
  StigmerFileReviewReconciledEvent,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { ReviewFileChangesResponse } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { FileReviewSet } from "@stigmer/session-log";
import type {
  CapturedFileChange,
  FileChangeProgress,
  FileChangeProgressEntry,
  FileChangeSet,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { ConformanceClients } from "../harness/clients";
import { type PollCoreOptions, pollUntil } from "./run-poll";
import { awaitTerminal, isTerminalPhase, pollExecution, type PollOptions } from "./runs";
import { reviewSetOf, sessionFold } from "./turn";

// Polls until the turn has ended and returns it, its file record holding a
// captured change set. Fails, naming the sets it holds, when the turn ended
// with none (the session has review off, the agent edited nothing, or the
// workspace has nothing to capture with), so a wrong fixture is a legible
// failure rather than a timeout.
export async function awaitFileReview(
  clients: ConformanceClients,
  executionId: string,
  opts: PollOptions = {},
): Promise<Run> {
  const ended = await awaitTerminal(clients, executionId, opts);
  requireReviewSet(ended);
  return ended;
}

// One row an arm expects a mid-run progress snapshot to converge to: the path
// (path_after for ADD/MODIFY, path_before for DELETE), the kind and the exact
// line counts. Counts are part of the expectation on purpose: a snapshot
// captured while the tool was still writing carries the right path with the
// wrong counts, and waiting for the counts is what makes the wait land on a
// converged capture rather than a half-written one.
export interface ExpectedProgressEntry {
  readonly path: string;
  readonly kind: FileChangeKind;
  readonly linesAdded: number;
  readonly linesRemoved: number;
}

// The snapshot's row for a workspace-relative path, if present.
export function progressEntryFor(progress: FileChangeProgress, path: string): FileChangeProgressEntry | undefined {
  return progress.entries.find((e) => e.pathAfter === path || e.pathBefore === path);
}

// Whether `progress` carries EVERY expected row with exactly its kind and
// counts. Extra rows are allowed: a capture that lands after a later tool's
// write carries that tool's file too, and when a capture runs relative to the
// tool it rides with is not part of the contract (header).
export function progressCarries(progress: FileChangeProgress, expected: readonly ExpectedProgressEntry[]): boolean {
  return expected.every((want) => {
    const got = progressEntryFor(progress, want.path);
    return (
      got !== undefined &&
      got.kind === want.kind &&
      got.linesAdded === want.linesAdded &&
      got.linesRemoved === want.linesRemoved
    );
  });
}

// Polls until a MID-RUN file_change_progress snapshot satisfies `settled` while
// the turn still works and its file record holds no captured set yet: the
// transient pre-boundary window. `settled` must
// hold for the converged snapshot and stay true once it does (header); an arm
// with a concrete expectation uses `awaitProgressEntries`. On failure — a
// timeout, or the boundary arriving first — the error carries the distinct
// snapshots observed, in order, with the time each was first seen.
export async function awaitFileChangeProgress(
  clients: ConformanceClients,
  executionId: string,
  settled: (progress: FileChangeProgress) => boolean,
  opts: PollOptions = {},
): Promise<Run> {
  const trace = new ProgressTrace();
  try {
    return await pollExecution(
      clients,
      executionId,
      (exec) => {
        const progress = exec.status?.fileChangeProgress;
        const capturing = !isTerminalPhase(exec.status?.phase) && capturedSet(exec) === undefined;
        trace.observe(progress);
        if (capturing && progress !== undefined && settled(progress)) return true;
        if (isTerminalPhase(exec.status?.phase)) {
          throw new Error(
            `execution ${executionId} reached terminal phase before a mid-run file_change_progress snapshot ` +
              `satisfied the predicate`,
          );
        }
        return false;
      },
      { label: "a settled mid-run file_change_progress snapshot", ...opts },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${message}; ${trace.render()}`, { cause: err });
  }
}

// Polls until a mid-run snapshot carries every expected row (`progressCarries`).
// The shape every progress arm should take: state what the strip converges to,
// not how many files one capture happened to see.
export function awaitProgressEntries(
  clients: ConformanceClients,
  executionId: string,
  expected: readonly ExpectedProgressEntry[],
  opts: PollOptions = {},
): Promise<Run> {
  const label = `a mid-run file_change_progress snapshot carrying ${expected.map((e) => e.path).join(", ")}`;
  return awaitFileChangeProgress(clients, executionId, (p) => progressCarries(p, expected), { label, ...opts });
}

// The distinct progress snapshots a wait observed, rendered for a failure
// message: `observed progress: +1.0s files=1 [created.txt ADD +3/-0] -> +6.9s
// files=3 [...]`. Consecutive identical snapshots collapse to one entry, so the
// rendering is the sequence of captures, not of polls.
class ProgressTrace {
  private readonly startedAt = Date.now();
  private readonly seen: string[] = [];
  private last: string | undefined;

  observe(progress: FileChangeProgress | undefined): void {
    const rendered = progress === undefined ? "none" : renderProgress(progress);
    if (rendered === this.last) return;
    this.last = rendered;
    const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    this.seen.push(`+${elapsed}s ${rendered}`);
  }

  render(): string {
    return `observed progress: ${this.seen.length === 0 ? "(nothing)" : this.seen.join(" -> ")}`;
  }
}

function renderProgress(progress: FileChangeProgress): string {
  const rows = progress.entries.map(
    (e) => `${e.pathAfter || e.pathBefore} ${FileChangeKind[e.kind]} +${e.linesAdded}/-${e.linesRemoved}`,
  );
  return `files=${progress.filesChanged} [${rows.join(", ")}]`;
}

// Whether a change set of the run's file record has been captured. The runner
// records each set twice: mid-turn, right after its baseline is pinned, with
// no candidate and no files (still being captured, as the server reads it),
// and again at the turn's boundary with its candidate and captured files.
export function isCapturedSet(set: FileChangeSet): boolean {
  return set.candidateSnapshot !== undefined;
}

// The first change set of the run's file record that was captured with files, if any.
function capturedSet(exec: Run): FileChangeSet | undefined {
  return exec.status?.fileChanges.find((set) => isCapturedSet(set) && set.changes.length > 0);
}

// The change set the turn captured, which every decide-and-continue arm
// starts from: its ids and digests are what a decision names. Throws when the
// file record holds none, so an assertion never dereferences a missing set.
// Whether it is still undecided is the log's (`reviewSetNow`).
export function requireReviewSet(exec: Run): FileChangeSet {
  const set = capturedSet(exec);
  if (set === undefined) {
    throw new Error(
      `execution ${exec.metadata?.id ?? "?"} captured no change set ` +
        `(file record: ${JSON.stringify(exec.status?.fileChanges.map((s) => [s.id, isCapturedSet(s), s.changes.length]) ?? [])})`,
    );
  }
  return set;
}

// The captured change set `id` of the run's file record, as the run reads
// now. Throws when the record holds no such set, or holds it only pinned
// (its baseline recorded, its candidate not yet captured).
export function recordedSet(exec: Run, id: string): FileChangeSet {
  const set = exec.status?.fileChanges.find((candidate) => candidate.id === id);
  if (set === undefined) {
    throw new Error(`execution ${exec.metadata?.id ?? "?"} has no change set ${id} on its file record`);
  }
  if (!isCapturedSet(set)) {
    throw new Error(`execution ${exec.metadata?.id ?? "?"}: change set ${id} is still being captured (no candidate snapshot)`);
  }
  return set;
}

// What the session's log says of change set `changeSetId` now: its files
// with each one's state (undecided, kept, undoing, undone), every decision
// and every reconcile, folded. Throws when the log has not offered the set.
export async function reviewSetNow(
  clients: ConformanceClients,
  sessionId: string,
  changeSetId: string,
): Promise<FileReviewSet> {
  const set = reviewSetOf(await sessionFold(clients, sessionId), changeSetId);
  if (set === undefined) {
    throw new Error(`session ${sessionId}: the log has not offered change set ${changeSetId}`);
  }
  return set;
}

// A folded set's files as `[path, state, decided by]`, sorted by path: the
// shape an arm compares whole.
export function reviewStatesOf(set: FileReviewSet): Array<[string, string, string]> {
  return set.files
    .map((file): [string, string, string] => [file.path || file.previousPath, file.state, file.decidedBy])
    .sort((a, b) => a[0].localeCompare(b[0]));
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
  // Consciously keep a binary change whose diff cannot be shown (a keep, per
  // ReviewFileChangesInput).
  acknowledgeUnreviewable?: boolean;
  reason?: string;
}

// The word reviewFileChanges takes for a decision.
export type FileReviewAction = "keep" | "undo";

// Keeps or undoes one file through the session's decision method, correlating
// by the change's id and binding to its file_digest. Returns the server's
// answer: the reconcile turn an undo on a finished turn started, or "".
export function reviewFileByPath(
  clients: ConformanceClients,
  sessionId: string,
  set: FileChangeSet,
  path: string,
  action: FileReviewAction,
  opts: FileDecisionOptions = {},
): Promise<ReviewFileChangesResponse> {
  const change = requireChangeByPath(set, path);
  return clients.sessionCommand.reviewFileChanges({
    sessionId,
    changeSetId: set.id,
    scope: "file",
    fileChangeId: change.id,
    action,
    expectedDigest: opts.expectedDigest ?? change.fileDigest,
    acknowledgeUnreviewable: opts.acknowledgeUnreviewable ?? false,
    reason: opts.reason ?? "",
  });
}

// Keeps or undoes the whole set through the session's decision method, bound
// to its aggregate_digest.
export function reviewChangeSet(
  clients: ConformanceClients,
  sessionId: string,
  set: FileChangeSet,
  action: FileReviewAction,
  opts: FileDecisionOptions = {},
): Promise<ReviewFileChangesResponse> {
  return clients.sessionCommand.reviewFileChanges({
    sessionId,
    changeSetId: set.id,
    scope: "change_set",
    action,
    expectedDigest: opts.expectedDigest ?? set.aggregateDigest,
    acknowledgeUnreviewable: opts.acknowledgeUnreviewable ?? false,
    reason: opts.reason ?? "",
  });
}

// A session's file-review events by type, each list in log order.
export interface FileReviewLog {
  readonly changes: StigmerFileReviewChangesEvent[];
  readonly decided: StigmerFileReviewDecidedEvent[];
  readonly reconciled: StigmerFileReviewReconciledEvent[];
}

// Splits a slice of the log into its file-review events; every other type is
// left out.
export function fileReviewLogOf(events: readonly SessionEvent[]): FileReviewLog {
  const log: FileReviewLog = { changes: [], decided: [], reconciled: [] };
  for (const { event } of events) {
    if (event.case === "stigmerFileReviewChanges") log.changes.push(event.value);
    else if (event.case === "stigmerFileReviewDecided") log.decided.push(event.value);
    else if (event.case === "stigmerFileReviewReconciled") log.reconciled.push(event.value);
  }
  return log;
}

// The session's file-review events, read from its whole log.
export async function readFileReviewLog(clients: ConformanceClients, sessionId: string): Promise<FileReviewLog> {
  return fileReviewLogOf((await clients.sessionQuery.listEvents({ sessionId, pageSize: 1000 })).events);
}

// Polls the session's log until `changeSetId` has its reconciled event and
// the session is idle again (its newest event is session.status_idle), and
// returns that event. The undo's own turn and a message turn sent right after
// it both end idle, so the wait names neither.
export async function awaitReconciled(
  clients: ConformanceClients,
  sessionId: string,
  changeSetId: string,
  opts: PollCoreOptions = {},
): Promise<StigmerFileReviewReconciledEvent> {
  const reconciledIn = (events: readonly SessionEvent[]) =>
    fileReviewLogOf(events).reconciled.find((event) => event.changeSetId === changeSetId);
  const events = await pollUntil(
    async () => (await clients.sessionQuery.listEvents({ sessionId, pageSize: 1000 })).events,
    (got) => reconciledIn(got) !== undefined && got.at(-1)?.event.case === "sessionStatusIdle",
    (last, timeoutMs) =>
      `session ${sessionId}: change set ${changeSetId} was not reconciled with the session idle within ${timeoutMs}ms ` +
      `(log: ${JSON.stringify((last ?? []).map((e) => e.event.case))})`,
    opts,
  );
  return reconciledIn(events)!;
}

// Who decided each decision on `changeSetId`, in log order: the decided
// event's decided_by, which the server writes from the caller of
// reviewFileChanges (empty for a decision no person made). The server records
// the principal it authorized, the same id it stamps as created_by on what
// that caller creates, so a suite compares the two without knowing the
// edition's identity scheme.
export function fileReviewersOf(log: FileReviewLog, changeSetId: string): string[] {
  return log.decided.filter((event) => event.changeSetId === changeSetId).map((event) => event.decidedBy);
}
