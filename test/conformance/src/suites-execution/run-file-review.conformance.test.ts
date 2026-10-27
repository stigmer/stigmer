// Conformance suite for Run file review (apply-then-review, never a wait):
// a native-harness turn edits files in a git workspace of a session that asks
// for review, every edit lands, the turn ends, and its delta is offered as one
// FileChangeSet; a person keeps or undoes it per file or as a set, and an undo
// puts exactly the undone files back.
// Domain: agentic / agentexecution and session — the run's file record
// (status.file_changes), the stigmer.file_review.* events and
// SessionCommandController.reviewFileChanges.
//
// The loop under test (filereview.proto, event.proto):
//   - review is the session's choice (spec.file_review, off unless set). With
//     it off a write simply lands and the turn ends with no change set, an
//     unattended turn included (stigmer#1471);
//   - with it on, a git-tracked edit FLOWS during the turn; at the boundary the
//     runner snapshots baseline and candidate and records the diff as a
//     FileChangeSet on the run's file record, on a turn that ends COMPLETED
//     with no call waiting, and the log gains stigmer.file_review.changes;
//     what is decided and what is still undecided is the log's alone;
//   - every decision binds to the digest the reviewer saw; a keep only records
//     it, an undo on a finished turn starts a reconcile turn (no message, no
//     model call) that puts the files back from the pinned refs or the
//     content-addressed store, writes stigmer.file_review.reconciled and ends
//     with the session idle. Every arm asserts mock.remaining() is 0: a
//     reconcile that asked the model would request an unscripted turn, get a
//     500, and FAIL instead of completing;
//   - the next message closes the earlier turn's review: what is still
//     undecided is kept with origin next_turn, a message sent while a turn
//     works waits and the turn's capture is kept by the next turn's close,
//     a late decision is refused, and an undo sent just before a message is
//     put back before that message's agent runs, reconciled exactly once.
//
// Capture is selected by a session with file review on whose primary
// workspace is a real git work tree (harness/git-workspace.ts): the runner,
// spawned by this harness on this host, operates in place. The secret rules
// are exercised through paths the fixture ignores (.env) or that carry
// secret-like content on a tracked path (config/credentials.json): a secret's
// bytes must never enter the file record, the status JSON, or the artifact store,
// and such an entry can only be undone. Binary changes are kept only by an
// explicit acknowledgement. Gitignored NON-secret paths are captured through
// the content-addressed store and put back from it.
//
// Every arm decides through reviewFileChanges. Reads of the workspace are the
// suite's own fixture, not a runner internal. On Claude (its own block, where
// the target runs Claude turns) a keep and an undo settle the engine's own
// Write and Edit, offered under the Claude harness's id.
import { Code } from "@connectrpc/connect";
import { create, toJson } from "@bufbuild/protobuf";
import { RunSchema, type Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import {
  ApprovalMode,
  DiffCompleteness,
  RunPhase,
  FileCaptureClass,
  FileChangeKind,
  FileReviewBlockReason,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { CapturedFileChange, FileChangeSet } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import type { StigmerFileReviewReconciledEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineFireOutcome } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { GitWorkspace, requireGit } from "../harness/git-workspace";
import type { AnthropicMessageBody, MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { agentRefOf, makeAgent } from "../support/agents";
import { awaitRunThatRead, awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/runs";
import {
  awaitFileReview,
  awaitReconciled,
  fileReviewersOf,
  isCapturedSet,
  readFileReviewLog,
  recordedSet,
  requireChangeByPath,
  requireReviewSet,
  reviewChangeSet,
  reviewFileByPath,
  reviewSetNow,
  reviewStatesOf,
} from "../support/file-review";
import { pollUntil } from "../support/run-poll";
import { uniqueName } from "../support/naming";
import { makeRoutine } from "../support/routines";
import { makeSession } from "../support/sessions";
import { toolUsesOf, turnById, turnOfRun } from "../support/turn";
import { CLAUDE_ARM, type ArmStep, claudeTurnsOnly } from "../support/engine-arms";
import { createTarget, type TargetProfile } from "../targets";

// Read once at collection time to gate the edition-specific describes
// (constructing a target is side-effect-free; setup() is what boots processes).
const collectionTarget = createTarget();

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  await requireGit();
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  mock.releaseHolds();
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

// The native harness's built-in file tools, the shape the runner binds them in
// (shared/file-tools.ts). Turn builders read as the sequence of model actions.
const WRITE_FILE_TOOL = "write_file";
const EDIT_FILE_TOOL = "edit_file";
const READ_FILE_TOOL = "read_file";
// The harness id the native runner stamps on a change set.
const DEEP_AGENT_HARNESS_ID = "deep-agent";
// The stop cause a reconcile turn settles with (the runner's terminal table).
const REVIEW_RESOLVED = "review_resolved";
// Keeps a turn mid-flight while an arm acts; released as soon as it has.
const HOLD_MS = 60_000;

function writeFileTurn(toolCallId: string, path: string, content: string): AnthropicMessageBody {
  return anthropicToolUse(toolCallId, WRITE_FILE_TOOL, { file_path: path, content });
}

function editFileTurn(toolCallId: string, path: string, oldString: string, newString: string): AnthropicMessageBody {
  return anthropicToolUse(toolCallId, EDIT_FILE_TOOL, { file_path: path, old_string: oldString, new_string: newString });
}

function readFileTurn(toolCallId: string, path: string): AnthropicMessageBody {
  return anthropicToolUse(toolCallId, READ_FILE_TOOL, { file_path: path });
}

interface ReviewSession {
  readonly org: string;
  readonly sessionId: string;
}

// A NATIVE session on an agent with the file tools whose primary workspace is
// the git work tree; file review is on unless the arm turns it off.
async function startSession(workspace: GitWorkspace, opts: { fileReview?: boolean } = {}): Promise<ReviewSession> {
  const { org } = await target.provisionTenancy();
  const agent = await clients.agentCommand.create(
    makeAgent({
      org,
      name: uniqueName("agent-filereview"),
      instructions: "You are a test agent. Use the filesystem tools to write, edit, and delete files.",
    }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

  const session = await clients.sessionCommand.create(
    makeSession({
      org,
      name: uniqueName("ses-filereview"),
      agentRef: agentRefOf(agent),
      harness: Harness.NATIVE,
      localWorkspaces: [{ name: "repo", path: workspace.dir }],
      fileReview: opts.fileReview ?? true,
    }),
  );
  const sessionId = session.metadata!.id;
  fixtures.defer(() => clients.sessionCommand.delete({ value: sessionId }));
  return { org, sessionId };
}

// Sends one message on the session with its scripted turns queued first.
async function sendTurn(
  session: ReviewSession,
  turns: AnthropicMessageBody[],
  opts: { message?: string; autoApproveAll?: boolean } = {},
): Promise<string> {
  for (const turn of turns) mock.enqueue(turn);
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({
      org: session.org,
      name: uniqueName("aex-filereview"),
      sessionId: session.sessionId,
      message: opts.message ?? "Use the filesystem tools as instructed.",
      autoApproveAll: opts.autoApproveAll ?? false,
    }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
  return executionId;
}

/**
 * A message sent to the session (sendMessage), which waits while a turn
 * works: the run that reads it, once one has.
 */
async function sendMessageTurn(
  session: ReviewSession,
  turns: AnthropicMessageBody[],
  opts: { message?: string } = {},
): Promise<{ readonly queued: boolean; readonly run: Promise<string> }> {
  for (const turn of turns) mock.enqueue(turn);
  const sent = await clients.agentExecutionCommand.sendMessage(
    makeAgentExecution({
      org: session.org,
      name: uniqueName("aex-filereview"),
      sessionId: session.sessionId,
      message: opts.message ?? "Use the filesystem tools as instructed.",
    }),
  );
  const run = awaitRunThatRead(clients, session.sessionId, sent, { timeoutMs: HOLD_MS * 2 }).then((runId) => {
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: runId }));
    return runId;
  });
  return { queued: sent.run === undefined, run };
}

// A fresh workspace whose cleanup is deferred with the run's other fixtures.
async function freshWorkspace(): Promise<GitWorkspace> {
  const workspace = await GitWorkspace.create();
  fixtures.defer(() => workspace.cleanup());
  return workspace;
}

interface Reviewed extends ReviewSession {
  readonly executionId: string;
  readonly ended: Run;
  readonly set: FileChangeSet;
}

// Runs the scripted turn in a fresh review session to its end and returns the
// ended turn and the one set its file record captured. Asserts the facts every
// arm shares: the turn COMPLETED rather than waiting, no tool approval was
// ever asked (the edits flowed), and the log offers the set undecided.
async function runToReview(
  workspace: GitWorkspace,
  turns: AnthropicMessageBody[],
  opts: { message?: string; autoApproveAll?: boolean } = {},
): Promise<Reviewed> {
  const session = await startSession(workspace);
  const executionId = await sendTurn(session, turns, opts);
  const ended = await awaitFileReview(clients, executionId);
  expect(ended.status?.phase, "a turn never waits on review").toBe(RunPhase.RUN_COMPLETED);
  const turn = await turnById(clients, session.sessionId, executionId);
  expect(toolUsesOf(turn).filter((use) => use.ask !== undefined), "the edits flowed; no tool approval").toHaveLength(0);
  const set = requireReviewSet(ended);
  await expectUndecided(session.sessionId, set.id);
  return { ...session, executionId, ended, set };
}

// The turn's run as it reads now.
function getRun(executionId: string): Promise<Run> {
  return clients.agentExecutionQuery.get({ value: executionId });
}

// The log still offers set `changeSetId` with nothing decided: what a refused
// decision must leave behind.
async function expectUndecided(sessionId: string, changeSetId: string): Promise<void> {
  const set = await reviewSetNow(clients, sessionId, changeSetId);
  expect(set.undecided, `change set ${changeSetId} is still undecided`).toBe(true);
  expect(set.decisions, `change set ${changeSetId} holds no decision`).toHaveLength(0);
}

// The log reads every file of set `changeSetId` decided.
async function expectDecided(sessionId: string, changeSetId: string): Promise<void> {
  const set = await reviewSetNow(clients, sessionId, changeSetId);
  expect(set.undecided, `change set ${changeSetId} is decided: ${JSON.stringify(reviewStatesOf(set))}`).toBe(false);
}

// The session's runs, in no particular order.
async function sessionRuns(sessionId: string): Promise<Run[]> {
  return (await clients.agentExecutionQuery.listBySession({ sessionId })).entries;
}

function expectNoModelCallLeft(): void {
  expect(mock.remaining(), "a file-review decision must NOT re-invoke the model").toBe(0);
}

// The undo's reconcile turn ran to its end: a message-less run that COMPLETED
// as review_resolved, after which the change set's reconciled event is in the
// log, nothing failed, and the session is idle again. Returns that event.
async function awaitUndone(
  reviewed: ReviewSession,
  changeSetId: string,
  reconcileRunId: string,
): Promise<StigmerFileReviewReconciledEvent> {
  expect(reconcileRunId, "an undo on a finished turn starts a reconcile turn").not.toBe("");
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: reconcileRunId }).then(() => undefined, () => undefined));
  const reconcile = await awaitTerminal(clients, reconcileRunId);
  expect(reconcile.status?.phase, `reconcile turn ${reconcileRunId}: ${reconcile.status?.error ?? ""}`).toBe(
    RunPhase.RUN_COMPLETED,
  );
  expect(reconcile.status?.stopCause).toBe(REVIEW_RESOLVED);
  expect(reconcile.spec?.reconcileFileReview, "the reconcile turn says what it is").toBe(true);
  expect(reconcile.spec?.message, "a reconcile turn carries no message").toBe("");
  const reconciled = await awaitReconciled(clients, reviewed.sessionId, changeSetId);
  expect(reconciled.failure, reconciled.failureDetail).toBe("");
  expectNoModelCallLeft();
  return reconciled;
}

// The change for `path`, asserting its kind — the shape every per-file arm reads.
function expectChange(set: FileChangeSet, path: string, kind: FileChangeKind): CapturedFileChange {
  const change = requireChangeByPath(set, path);
  expect(change.kind, `${path} is a ${FileChangeKind[kind]}`).toBe(kind);
  return change;
}

// Whether any file under `dir` carries `needle` — the "never reached durable
// storage" scan over the shared artifact store.
async function storeContains(dir: string, needle: string): Promise<boolean> {
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const bytes = await readFile(join(entry.parentPath, entry.name));
    if (bytes.includes(needle)) return true;
  }
  return false;
}

describe("Run file review — the session's choice", () => {
  it("a session without file review lets a write land and ends the turn COMPLETED with no change set and no review event", async () => {
    const workspace = await freshWorkspace();
    const headBefore = await workspace.headSha();
    const session = await startSession(workspace, { fileReview: false });
    const executionId = await sendTurn(session, [
      writeFileTurn("toolu_w_off", "plain.txt", "just written\n"),
      anthropicText("Created the file."),
    ]);

    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, `the write never asked: ${final.status?.error ?? ""}`).toBe(RunPhase.RUN_COMPLETED);
    const uses = toolUsesOf(await turnOfRun(clients, final));
    expect(uses.filter((use) => use.ask !== undefined), "nothing asked").toHaveLength(0);
    expect(uses.find((use) => use.name === WRITE_FILE_TOOL)?.state).toBe("completed");
    expect(await workspace.readFile("plain.txt"), "the write landed").toBe("just written\n");
    expect(await workspace.headSha(), "nothing commits the write").toBe(headBefore);
    expect(final.status?.fileChanges, "nothing was captured for review").toHaveLength(0);
    const log = await readFileReviewLog(clients, session.sessionId);
    expect([...log.changes, ...log.decided, ...log.reconciled], "no review event in the log").toHaveLength(0);
    expectNoModelCallLeft();
  });

  it("[rpc:SessionCommandController.reviewFileChanges] a turn with review on ends COMPLETED with its ADD applied and offered for review; keep records the decision and starts no turn", async () => {
    const workspace = await freshWorkspace();
    const headBefore = await workspace.headSha();
    const path = "feature.txt";
    const content = "hello\nworld\n";

    const reviewed = await runToReview(workspace, [
      writeFileTurn("toolu_w1", path, content),
      anthropicText("Created the file."),
    ]);
    const { executionId, ended, set } = reviewed;

    expect(set.harnessId, "the native harness stamps its id").toBe(DEEP_AGENT_HARNESS_ID);
    expect(set.aggregateDigest).not.toBe("");
    const change = expectChange(set, path, FileChangeKind.ADD);
    expect(change.before, "an ADD has no before side").toBeUndefined();
    expect(change.after?.body, "an ADD carries the new content inline").toEqual({ case: "inline", value: content });
    expect(change.afterSha256, "the reconcile enforcement digest").not.toBe("");
    expect(await workspace.readFile(path), "the edit is applied before anyone decides").toBe(content);
    const offered = (await readFileReviewLog(clients, reviewed.sessionId)).changes;
    expect(offered.map((e) => e.changeSetId), "the log offers the turn's set").toEqual([set.id]);
    expect(
      offered[0]!.files.map((file) => [file.fileChangeId, file.path, file.change, file.digest]),
      "the offer names the recorded file by its id and digest",
    ).toEqual([[change.id, path, "added", change.fileDigest]]);

    // The flowed file edit stays visible in the turn's log.
    const use = toolUsesOf(await turnById(clients, reviewed.sessionId, executionId)).find(
      (candidate) => candidate.name === WRITE_FILE_TOOL,
    );
    expect(use, "the flowed edit remains in the turn's log").toBeDefined();
    expect(use!.state).toBe("completed");
    // The input the tool ran with, which the log records as it was: the
    // native harness's path normalization (runner middleware/path-normalization.ts)
    // rewrites the model's workspace-relative path to the virtual root's
    // absolute form before the tool starts, and the tool's start carries that.
    expect(use!.input, "an observational tool use keeps its input").toMatchObject({ file_path: `/${path}` });

    const kept = await reviewFileByPath(clients, reviewed.sessionId, set, path, "keep");
    expect(kept.reconcileRunId, "a keep has nothing to put back").toBe("");

    const after = await getRun(executionId);
    expect(after.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    expect(reviewStatesOf(await reviewSetNow(clients, reviewed.sessionId, set.id)), "the keep settled the set").toEqual([
      [path, "kept", "person"],
    ]);
    expect(await workspace.readFile(path), "the kept bytes are on disk verbatim").toBe(content);
    expect(await workspace.headSha(), "capture never commits").toBe(headBefore);
    expect(await sessionRuns(reviewed.sessionId), "a keep starts no turn").toHaveLength(1);
    // The decision names its reviewer: the caller that created the run is the
    // caller that kept the file, recorded as the same principal (#1385).
    const creator = after.status?.audit?.specAudit?.createdBy?.id ?? "";
    expect(creator, "the execution records its creator").not.toBe("");
    expect(
      fileReviewersOf(await readFileReviewLog(clients, reviewed.sessionId), set.id),
      "the decision names the reviewing caller",
    ).toEqual([creator]);
    expectNoModelCallLeft();
  });

  it("[rpc:SessionCommandController.reviewFileChanges] undoing a MODIFY on a finished turn puts the baseline back through a reconcile turn that asks no model", async () => {
    const workspace = await freshWorkspace();
    const path = "notes.md";
    const original = "# Notes\noriginal line\n";
    await workspace.seedFile(path, original);
    const headBefore = await workspace.headSha();

    const reviewed = await runToReview(workspace, [
      editFileTurn("toolu_e1", path, "original line", "changed line"),
      anthropicText("Edited the file."),
    ]);
    const { executionId, set } = reviewed;

    const change = expectChange(set, path, FileChangeKind.MODIFY);
    expect(change.before?.body, "a MODIFY carries the pre-edit content").toEqual({ case: "inline", value: original });
    expect(await workspace.readFile(path), "the edit is applied when the turn ends").toBe("# Notes\nchanged line\n");

    const undone = await reviewFileByPath(clients, reviewed.sessionId, set, path, "undo");
    const reconciled = await awaitUndone(reviewed, set.id, undone.reconcileRunId);

    expect(reconciled.undonePaths).toEqual([path]);
    expect(await workspace.readFile(path), "an undo snaps the file back byte for byte").toBe(original);
    expect(await workspace.headSha()).toBe(headBefore);
    expect(reviewStatesOf(await reviewSetNow(clients, reviewed.sessionId, set.id)), "the log reads the file undone").toEqual([
      [path, "undone", "person"],
    ]);
    expect(
      recordedSet(await getRun(executionId), set.id).changes.map((c) => c.id),
      "the file record keeps what was captured",
    ).toEqual([change.id]);
    const use = toolUsesOf(await turnById(clients, reviewed.sessionId, executionId)).find(
      (candidate) => candidate.name === EDIT_FILE_TOOL,
    );
    expect(use?.state, "the edit stays completed even though its file was undone").toBe("completed");
  });

  it("[rpc:SessionCommandController.reviewFileChanges] undoing two files one at a time puts each back, each undo answered by its own reconcile", async () => {
    const workspace = await freshWorkspace();
    const reviewed = await runToReview(workspace, [
      writeFileTurn("toolu_w_first", "first.txt", "first\n"),
      writeFileTurn("toolu_w_second", "second.txt", "second\n"),
      anthropicText("Created both files."),
    ]);
    const { set } = reviewed;

    const firstUndo = await reviewFileByPath(clients, reviewed.sessionId, set, "first.txt", "undo");
    const first = await awaitUndone(reviewed, set.id, firstUndo.reconcileRunId);
    expect(first.undonePaths).toEqual(["first.txt"]);
    expect(await workspace.exists("first.txt"), "the first undo removes its ADD").toBe(false);
    expect(await workspace.readFile("second.txt"), "the other file is still undecided and stays").toBe("second\n");

    const secondUndo = await reviewFileByPath(clients, reviewed.sessionId, set, "second.txt", "undo");
    expect(secondUndo.reconcileRunId, "the second undo starts its own reconcile turn").not.toBe("");
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: secondUndo.reconcileRunId }).then(() => undefined, () => undefined));
    expect((await awaitTerminal(clients, secondUndo.reconcileRunId)).status?.phase).toBe(RunPhase.RUN_COMPLETED);
    const log = await pollUntil(
      () => readFileReviewLog(clients, reviewed.sessionId),
      (got) => got.reconciled.filter((event) => event.changeSetId === set.id).length === 2,
      (last, timeoutMs) => `session ${reviewed.sessionId}: two reconciles of ${set.id} not seen within ${timeoutMs}ms (${JSON.stringify(last?.reconciled.map((event) => event.id))})`,
    );
    expect(await workspace.exists("second.txt"), "the second undo lands too").toBe(false);
    const answers = log.reconciled.filter((event) => event.changeSetId === set.id);
    expect(answers.map((event) => event.undonePaths)).toEqual([["first.txt"], ["second.txt"]]);
    expect(
      answers.map((event) => event.id),
      "each reconcile names the undo it answers",
    ).toEqual(log.decided.filter((event) => event.changeSetId === set.id && event.action === "undo").map((event) => `${set.id.replace(":", ".fr")}.r.${event.id}`));
    expectNoModelCallLeft();
  });

  it("[rpc:SessionCommandController.reviewFileChanges] a stale expected_digest is InvalidArgument and leaves the set undecided", async () => {
    const workspace = await freshWorkspace();
    const path = "config.txt";
    const reviewed = await runToReview(workspace, [
      writeFileTurn("toolu_w_cfg", path, "key=value\n"),
      anthropicText("Created the file."),
    ]);
    const { set } = reviewed;

    await expectGrpcCode(
      () =>
        reviewFileByPath(clients, reviewed.sessionId, set, path, "keep", {
          expectedDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        }),
      Code.InvalidArgument,
      "a decision bound to a digest the reviewer did not see is refused",
    );
    await expectUndecided(reviewed.sessionId, set.id);

    await reviewFileByPath(clients, reviewed.sessionId, set, path, "keep");
    await expectDecided(reviewed.sessionId, set.id);
    expect(await workspace.readFile(path)).toBe("key=value\n");
    expectNoModelCallLeft();
  });

  it("[rpc:SessionCommandController.reviewFileChanges] refuses an unknown scope or action, or a file decision naming no file, and decides nothing", async () => {
    const workspace = await freshWorkspace();
    const reviewed = await runToReview(workspace, [
      writeFileTurn("toolu_w_neg", "neg.txt", "neg\n"),
      anthropicText("Created the file."),
    ]);
    const { sessionId, set } = reviewed;
    const base = {
      sessionId,
      changeSetId: set.id,
      expectedDigest: set.aggregateDigest,
    };
    await expectGrpcCode(
      () => clients.sessionCommand.reviewFileChanges({ ...base, scope: "turn", action: "keep" }),
      Code.InvalidArgument,
      "a scope the method does not know",
    );
    await expectGrpcCode(
      () => clients.sessionCommand.reviewFileChanges({ ...base, scope: "change_set", action: "approve" }),
      Code.InvalidArgument,
      "an action the method does not know",
    );
    await expectGrpcCode(
      () => clients.sessionCommand.reviewFileChanges({ ...base, scope: "file", action: "undo" }),
      Code.InvalidArgument,
      "a file decision with no file_change_id",
    );
    await expectUndecided(sessionId, set.id);
    expect(await sessionRuns(sessionId), "no refused decision started a turn").toHaveLength(1);
  });
});

describe("Run file review — binary changes", () => {
  it("[rpc:SessionCommandController.reviewFileChanges] a binary change is summary-only: keep is FailedPrecondition, undo puts it back", async () => {
    const workspace = await freshWorkspace();
    const path = "blob.bin";
    const reviewed = await runToReview(workspace, [
      writeFileTurn("toolu_bin", path, "\u0000binary\u0000payload\n"),
      anthropicText("Wrote the binary asset."),
    ]);
    const { set } = reviewed;

    expect(set.diffCompleteness, "binary is the set's only blocker").toBe(DiffCompleteness.BINARY_SUMMARY_ONLY);
    const change = requireChangeByPath(set, path);
    expect(change.diffComplete, "a binary diff cannot be shown").toBe(false);
    expect(change.after?.isBinary, "the side is flagged binary").toBe(true);
    expect(change.after?.body.case, "no lossy inline text for a binary side").toBeUndefined();
    expect(change.afterSha256, "but the byte-true digest is there").not.toBe("");

    await expectGrpcCode(
      () => reviewFileByPath(clients, reviewed.sessionId, set, path, "keep"),
      Code.FailedPrecondition,
      "an unreviewable diff cannot be kept as-is",
    );
    await expectUndecided(reviewed.sessionId, set.id);

    const undone = await reviewFileByPath(clients, reviewed.sessionId, set, path, "undo");
    await awaitUndone(reviewed, set.id, undone.reconcileRunId);
    expect(await workspace.exists(path), "the undone binary is gone").toBe(false);
  });

  it("[rpc:SessionCommandController.reviewFileChanges] acknowledge_unreviewable with the right digest keeps binary bytes verbatim", async () => {
    const workspace = await freshWorkspace();
    const headBefore = await workspace.headSha();
    const path = "assets/logo.bin";
    const content = "\u0000PNG\u0000\u0001\u0002keep-me\n";
    const reviewed = await runToReview(workspace, [
      writeFileTurn("toolu_bin", path, content),
      anthropicText("Wrote the binary asset."),
    ]);
    const { sessionId, set } = reviewed;
    expect(set.diffCompleteness).toBe(DiffCompleteness.BINARY_SUMMARY_ONLY);
    expect(requireChangeByPath(set, path).after?.isBinary).toBe(true);

    await expectGrpcCode(
      () => reviewFileByPath(clients, sessionId, set, path, "keep"),
      Code.FailedPrecondition,
      "a binary keep without the acknowledgement is refused",
    );
    await expectGrpcCode(
      () =>
        reviewFileByPath(clients, sessionId, set, path, "keep", {
          acknowledgeUnreviewable: true,
          expectedDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        }),
      Code.InvalidArgument,
      "the acknowledgement never relaxes the digest gate",
    );
    await expectUndecided(sessionId, set.id);

    await reviewFileByPath(clients, sessionId, set, path, "keep", { acknowledgeUnreviewable: true });

    await expectDecided(sessionId, set.id);
    expect((await workspace.readBytes(path)).toString("utf8"), "the exact bytes stay").toBe(content);
    expect(await workspace.headSha()).toBe(headBefore);
    expectNoModelCallLeft();
  });

  it("[rpc:SessionCommandController.reviewFileChanges] a change-set keep over a binary needs the acknowledgement, then keeps both files", async () => {
    const workspace = await freshWorkspace();
    const textPath = "README.md";
    const binPath = "assets/logo.bin";
    const textBody = "# Title\nupdated\n";
    const binBody = "\u0000PNG\u0000\u0001\u0002keep-me\n";
    const reviewed = await runToReview(workspace, [
      writeFileTurn("toolu_text", textPath, textBody),
      writeFileTurn("toolu_bin", binPath, binBody),
      anthropicText("Wrote a text file and a binary asset."),
    ]);
    const { set } = reviewed;
    expect(set.diffCompleteness).toBe(DiffCompleteness.BINARY_SUMMARY_ONLY);
    expect(expectChange(set, textPath, FileChangeKind.ADD).diffComplete, "the text file is reviewable").toBe(true);
    expect(requireChangeByPath(set, binPath).after?.isBinary).toBe(true);

    await expectGrpcCode(
      () => reviewChangeSet(clients, reviewed.sessionId, set, "keep"),
      Code.FailedPrecondition,
      "a keep-all over a binary needs the acknowledgement",
    );
    await reviewChangeSet(clients, reviewed.sessionId, set, "keep", { acknowledgeUnreviewable: true });

    expect(reviewStatesOf(await reviewSetNow(clients, reviewed.sessionId, set.id))).toEqual([
      [textPath, "kept", "person"],
      [binPath, "kept", "person"],
    ].sort((a, b) => a[0]!.localeCompare(b[0]!)));
    expect(await workspace.readFile(textPath)).toBe(textBody);
    expect((await workspace.readBytes(binPath)).toString("utf8")).toBe(binBody);
    expectNoModelCallLeft();
  });

  it("[rpc:SessionCommandController.reviewFileChanges] a secret in the set blocks a change-set keep even when acknowledged; per-file decisions still settle it", async () => {
    const workspace = await freshWorkspace();
    const textPath = "notes.md";
    const binPath = "assets/pic.bin";
    const secretPath = ".env";
    const reviewed = await runToReview(workspace, [
      writeFileTurn("toolu_text", textPath, "kept notes\n"),
      writeFileTurn("toolu_bin", binPath, "\u0000JPG\u0000keep\n"),
      writeFileTurn("toolu_env", secretPath, "SECRET=1\n"),
      anthropicText("Wrote a text file, a binary, and an env file."),
    ]);
    const { sessionId, set } = reviewed;
    expect(set.diffCompleteness, "a non-binary blocker makes the set PARTIAL_BLOCKED").toBe(
      DiffCompleteness.PARTIAL_BLOCKED,
    );

    await expectGrpcCode(
      () => reviewChangeSet(clients, sessionId, set, "keep", { acknowledgeUnreviewable: true }),
      Code.FailedPrecondition,
      "the acknowledgement covers binaries only; a secret keeps the set undo-only as a whole",
    );

    await reviewFileByPath(clients, sessionId, set, textPath, "keep");
    await reviewFileByPath(clients, sessionId, set, binPath, "keep", { acknowledgeUnreviewable: true });
    const undone = await reviewFileByPath(clients, sessionId, set, secretPath, "undo");
    await awaitUndone(reviewed, set.id, undone.reconcileRunId);

    expect(await workspace.readFile(textPath)).toBe("kept notes\n");
    expect((await workspace.readBytes(binPath)).toString("utf8")).toBe("\u0000JPG\u0000keep\n");
    expect(await workspace.exists(secretPath), "the secret never lands").toBe(false);
  });
});

describe("Run file review — secrets never persist", () => {
  it("[rpc:SessionCommandController.reviewFileChanges] a gitignored secret is captured path-only: keep is refused, undo settles it, the file never lands", async () => {
    const workspace = await freshWorkspace();
    const path = ".env";
    const reviewed = await runToReview(workspace, [
      writeFileTurn("toolu_w_env", path, "SECRET=1\n"),
      anthropicText("Wrote the env file."),
    ]);
    const { set } = reviewed;

    expect(set.diffCompleteness).toBe(DiffCompleteness.PARTIAL_BLOCKED);
    const change = requireChangeByPath(set, path);
    expect(change.diffComplete).toBe(false);
    expect(change.captureClass).toBe(FileCaptureClass.GIT_IGNORED_CAPTURED);
    expect(change.after, "the secret's content never enters the file record").toBeUndefined();
    expect(await workspace.exists(path), "the write was blocked at the tool, not just reviewed").toBe(false);

    await expectGrpcCode(
      () => reviewFileByPath(clients, reviewed.sessionId, set, path, "keep"),
      Code.FailedPrecondition,
      "a secret entry has no keepable bytes",
    );
    await expectUndecided(reviewed.sessionId, set.id);

    const undone = await reviewFileByPath(clients, reviewed.sessionId, set, path, "undo");
    await awaitUndone(reviewed, set.id, undone.reconcileRunId);
    expect(await workspace.exists(path)).toBe(false);
  });

  it("[rpc:SessionCommandController.reviewFileChanges] a tracked file and a secret in one turn: tracked kept, secret undone", async () => {
    const workspace = await freshWorkspace();
    const trackedPath = "tracked.txt";
    const secretPath = ".env";
    const reviewed = await runToReview(workspace, [
      writeFileTurn("toolu_w_tracked", trackedPath, "tracked body\n"),
      writeFileTurn("toolu_w_ignored", secretPath, "SECRET=1\n"),
      anthropicText("Wrote both files."),
    ]);
    const { sessionId, set } = reviewed;
    expect(set.diffCompleteness).toBe(DiffCompleteness.PARTIAL_BLOCKED);
    expect(expectChange(set, trackedPath, FileChangeKind.ADD).diffComplete).toBe(true);
    expect(requireChangeByPath(set, secretPath).diffComplete).toBe(false);

    await reviewFileByPath(clients, sessionId, set, trackedPath, "keep");
    const undone = await reviewFileByPath(clients, sessionId, set, secretPath, "undo");
    await awaitUndone(reviewed, set.id, undone.reconcileRunId);

    expect(await workspace.readFile(trackedPath)).toBe("tracked body\n");
    expect(await workspace.exists(secretPath)).toBe(false);
  });

  it("[rpc:SessionCommandController.reviewFileChanges] a tracked secret is SECRET_WITHHELD: no bytes in status or the artifact store; keep refused, undo restores", async (ctx) => {
    if (target.artifactStoreDir === undefined) return ctx.skip();
    const workspace = await freshWorkspace();
    const path = "config/credentials.json";
    const oldToken = "OLDSECRETtoken111";
    const newToken = "NEWSECRETtoken222";
    const baseline = `API_KEY=sk-live-${oldToken}\n`;
    await workspace.seedFile(path, baseline);

    const reviewed = await runToReview(workspace, [
      editFileTurn("toolu_e_creds", path, oldToken, newToken),
      anthropicText("Updated the credentials file."),
    ]);
    const { ended, set } = reviewed;

    expect(set.diffCompleteness).toBe(DiffCompleteness.PARTIAL_BLOCKED);
    const change = expectChange(set, path, FileChangeKind.MODIFY);
    expect(change.diffComplete).toBe(false);
    expect(change.blockedReason).toBe(FileReviewBlockReason.SECRET_WITHHELD);
    expect(change.captureClass, "a tracked path, withheld for its content").toBe(FileCaptureClass.GIT_TRACKED);
    expect(change.before, "the baseline secret's bytes never enter the file record").toBeUndefined();
    expect(change.after, "the new secret's bytes never enter the file record").toBeUndefined();

    const statusJson = JSON.stringify(toJson(RunSchema, ended));
    expect(statusJson, "the old token is nowhere on the wire").not.toContain(oldToken);
    expect(statusJson, "the new token is nowhere on the wire").not.toContain(newToken);
    const offered = JSON.stringify((await readFileReviewLog(clients, reviewed.sessionId)).changes);
    expect(offered, "nor in the log's offer").not.toContain(newToken);
    const store = target.artifactStoreDir();
    expect(await storeContains(store, oldToken), "the old token never reached the artifact store").toBe(false);
    expect(await storeContains(store, newToken), "the new token never reached the artifact store").toBe(false);

    await expectGrpcCode(
      () => reviewFileByPath(clients, reviewed.sessionId, set, path, "keep"),
      Code.FailedPrecondition,
      "a withheld entry can only be undone",
    );
    const undone = await reviewFileByPath(clients, reviewed.sessionId, set, path, "undo");
    await awaitUndone(reviewed, set.id, undone.reconcileRunId);
    expect(await workspace.readFile(path), "the undo restores the baseline").toBe(baseline);
  });

  it("auto_approve_all does not bypass file review for a secret, and the secret never persists", async (ctx) => {
    if (target.artifactStoreDir === undefined) return ctx.skip();
    const workspace = await freshWorkspace();
    const path = ".env";
    const secret = "API_KEY=sk-live-SUPER-SECRET-DO-NOT-PERSIST-abc123xyz\n";
    const reviewed = await runToReview(
      workspace,
      [writeFileTurn("toolu_w_env", path, secret), anthropicText("Wrote the env file.")],
      { autoApproveAll: true },
    );
    const { ended, set } = reviewed;

    expect(set.diffCompleteness).toBe(DiffCompleteness.PARTIAL_BLOCKED);
    const change = requireChangeByPath(set, path);
    expect(change.diffComplete).toBe(false);
    expect(change.captureClass).toBe(FileCaptureClass.GIT_IGNORED_CAPTURED);
    expect(change.before).toBeUndefined();
    expect(change.after).toBeUndefined();
    // Under the global bypass the write itself is accepted (the tool gate is
    // off); what stays fail-closed is that the bytes never persist anywhere.
    expect(await workspace.exists(path), "the bypass let the write land in the working tree").toBe(true);

    expect(JSON.stringify(toJson(RunSchema, ended)), "the secret is nowhere on the wire").not.toContain(secret.trim());
    expect(await storeContains(target.artifactStoreDir(), secret.trim()), "the secret never reached the store").toBe(
      false,
    );

    const undone = await reviewFileByPath(clients, reviewed.sessionId, set, path, "undo");
    await awaitUndone(reviewed, set.id, undone.reconcileRunId);
  });
});

describe("Run file review — gitignored captures and durability", () => {
  it("[rpc:SessionCommandController.reviewFileChanges] gitignored non-secret files are captured, reviewed and put back from the artifact store", async () => {
    const workspace = await freshWorkspace();
    await workspace.seedGitignorePattern("cache/");
    const reviewed = await runToReview(workspace, [
      writeFileTurn("toolu_w_tracked", "tracked.txt", "tracked body\n"),
      writeFileTurn("toolu_w_keep", "cache/keep.txt", "cache keep body\n"),
      writeFileTurn("toolu_w_drop", "cache/drop.txt", "cache drop body\n"),
      anthropicText("Wrote a tracked file and two ignored files."),
    ]);
    const { sessionId, set } = reviewed;

    expect(set.diffCompleteness, "text everywhere: the hybrid set is fully reviewable").toBe(DiffCompleteness.COMPLETE);
    expect(set.aggregateDigest).not.toBe("");
    expect(expectChange(set, "tracked.txt", FileChangeKind.ADD).captureClass).toBe(FileCaptureClass.GIT_TRACKED);
    for (const path of ["cache/keep.txt", "cache/drop.txt"]) {
      const change = expectChange(set, path, FileChangeKind.ADD);
      expect(change.captureClass, `${path} came through the content-addressed store`).toBe(
        FileCaptureClass.GIT_IGNORED_CAPTURED,
      );
      expect(change.diffComplete, `${path} is reviewable text`).toBe(true);
    }

    await reviewFileByPath(clients, sessionId, set, "tracked.txt", "keep");
    await reviewFileByPath(clients, sessionId, set, "cache/keep.txt", "keep");
    const undone = await reviewFileByPath(clients, sessionId, set, "cache/drop.txt", "undo");
    const reconciled = await awaitUndone(reviewed, set.id, undone.reconcileRunId);

    expect(reconciled.undonePaths).toEqual(["cache/drop.txt"]);
    expect(await workspace.readFile("tracked.txt")).toBe("tracked body\n");
    expect(await workspace.readFile("cache/keep.txt")).toBe("cache keep body\n");
    expect(await workspace.exists("cache/drop.txt")).toBe(false);
  });

  it("[rpc:SessionCommandController.reviewFileChanges] a change-set undo restores every file byte-exact after the working tree lost them", async () => {
    const workspace = await freshWorkspace();
    await workspace.seedGitignorePattern("cache/");
    const trackedPath = "tracked.txt";
    const ignoredPath = "cache/data.txt";
    await workspace.seedFile(trackedPath, "durable tracked body\n");
    // An ignored file cannot be committed: its pre-turn bytes are written
    // into the tree, where only the content-addressed store keeps them.
    await mkdir(dirname(join(workspace.dir, ignoredPath)), { recursive: true });
    await writeFile(join(workspace.dir, ignoredPath), "durable cas body\n");
    const reviewed = await runToReview(workspace, [
      editFileTurn("toolu_e_tracked", trackedPath, "durable tracked", "edited tracked"),
      editFileTurn("toolu_e_ignored", ignoredPath, "durable cas", "edited cas"),
      anthropicText("Edited a tracked and an ignored file."),
    ]);
    const { sessionId, set } = reviewed;
    expectChange(set, trackedPath, FileChangeKind.MODIFY);
    expectChange(set, ignoredPath, FileChangeKind.MODIFY);

    // A sandbox recycle: the working files are gone; only the git object store
    // and the content-addressed store survive.
    await workspace.removeWorkingFile(trackedPath);
    await workspace.removeWorkingFile(ignoredPath);
    expect(await workspace.exists(trackedPath)).toBe(false);
    expect(await workspace.exists(ignoredPath)).toBe(false);

    const undone = await reviewChangeSet(clients, sessionId, set, "undo");
    await awaitUndone(reviewed, set.id, undone.reconcileRunId);

    expect(await workspace.readFile(trackedPath), "restored from the git snapshot").toBe("durable tracked body\n");
    expect(await workspace.readFile(ignoredPath), "restored from the content-addressed store").toBe("durable cas body\n");
  });
});

describe("Run file review — the next message closes the review", () => {
  it("[rpc:SessionCommandController.reviewFileChanges] what is undecided when the next message is sent is kept as next_turn, and a late decision is refused", async () => {
    const workspace = await freshWorkspace();
    const reviewed = await runToReview(workspace, [
      writeFileTurn("toolu_w_decided", "decided.txt", "decided\n"),
      writeFileTurn("toolu_w_left", "left.txt", "left open\n"),
      anthropicText("Created both files."),
    ]);
    const { set } = reviewed;
    await reviewFileByPath(clients, reviewed.sessionId, set, "decided.txt", "keep");

    const next = await sendTurn(reviewed, [anthropicText("Noted.")], { message: "Thanks." });
    expect((await awaitTerminal(clients, next)).status?.phase).toBe(RunPhase.RUN_COMPLETED);

    const closed = await reviewSetNow(clients, reviewed.sessionId, set.id);
    expect(reviewStatesOf(closed), "the earlier turn's set is settled; the undecided file is kept for the person").toEqual([
      ["decided.txt", "kept", "person"],
      ["left.txt", "kept", "next_turn"],
    ]);
    expect(
      closed.decisions.filter((d) => d.scope === "change_set"),
      "a partly decided set is closed file by file",
    ).toHaveLength(0);
    const left = requireChangeByPath(set, "left.txt");
    const decided = requireChangeByPath(set, "decided.txt");
    const log = await readFileReviewLog(clients, reviewed.sessionId);
    expect(
      log.decided.filter((e) => e.changeSetId === set.id).map((e) => [e.scope, e.fileChangeId, e.action, e.origin]),
    ).toEqual([
      ["file", decided.id, "keep", "person"],
      ["file", left.id, "keep", "next_turn"],
    ]);

    const err = await expectGrpcCode(
      () => reviewChangeSet(clients, reviewed.sessionId, set, "undo"),
      Code.FailedPrecondition,
      "a decision after the conversation moved on",
    );
    expect(err.rawMessage).toContain("the conversation has moved on");
    expect(await workspace.readFile("decided.txt")).toBe("decided\n");
    expect(await workspace.readFile("left.txt"), "the refused undo put nothing back").toBe("left open\n");
    expect(await sessionRuns(reviewed.sessionId), "the refusal started no turn").toHaveLength(2);
    expectNoModelCallLeft();
  });

  it("[rpc:RunCommandController.sendMessage] a message sent while a turn works is read by it; the turn's capture is kept by the next message's close", async () => {
    const workspace = await freshWorkspace();
    const session = await startSession(workspace);
    mock.enqueue(writeFileTurn("toolu_w_late", "late.txt", "late\n"));
    mock.enqueue(anthropicText("Created the file."), { delayMs: HOLD_MS });
    const first = await sendTurn(session, []);
    // The first turn has written and is held on its last model call, so its
    // change set has not been captured yet.
    await pollUntil(
      async () => mock.consumed(),
      (consumed) => consumed >= 2,
      (last, timeoutMs) => `execution ${first}: the held model call was not reached within ${timeoutMs}ms (consumed ${last})`,
    );
    const sent = await sendMessageTurn(session, [anthropicText("Second.")], { message: "And another thing." });
    expect(sent.queued, "the message waits for the working turn").toBe(true);
    mock.releaseHolds();

    const ended = await awaitTerminal(clients, first);
    expect(ended.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    expect(await sent.run, "the working turn read the message").toBe(first);
    const set = (await getRun(first)).status?.fileChanges.find(isCapturedSet);
    expect(set, `execution ${first} captured its edit`).toBeDefined();
    expect((await reviewSetNow(clients, session.sessionId, set!.id)).undecided, "nothing closed it yet").toBe(true);

    const next = await sendMessageTurn(session, [anthropicText("Third.")], { message: "Moving on." });
    expect(next.queued, "nothing works now: the message starts a turn").toBe(false);
    expect((await awaitTerminal(clients, await next.run)).status?.phase).toBe(RunPhase.RUN_COMPLETED);
    const review = await reviewSetNow(clients, session.sessionId, set!.id);
    expect(review.undecided, "the set is settled once the next turn starts").toBe(false);
    expect(review.decisions.map((d) => [d.scope, d.action, d.origin])).toEqual([["change_set", "keep", "next_turn"]]);
    const log = await readFileReviewLog(clients, session.sessionId);
    expect(log.decided.filter((e) => e.changeSetId === set!.id).map((e) => [e.scope, e.action, e.origin])).toEqual([
      ["change_set", "keep", "next_turn"],
    ]);
    expect(await workspace.readFile("late.txt")).toBe("late\n");
    expectNoModelCallLeft();
  });

  it("[rpc:SessionCommandController.reviewFileChanges] an undo, then a message at once: the file is back before the next turn's agent runs, reconciled exactly once", async () => {
    const workspace = await freshWorkspace();
    const path = "draft.md";
    const original = "first draft\n";
    await workspace.seedFile(path, original);
    const reviewed = await runToReview(workspace, [
      editFileTurn("toolu_e_draft", path, "first draft", "second draft"),
      anthropicText("Edited the draft."),
    ]);
    const { set } = reviewed;

    const undone = await reviewChangeSet(clients, reviewed.sessionId, set, "undo");
    // Sent at once: the message waits for the reconcile turn when it still
    // works, or starts its turn when it has ended; either way the file is
    // back before the next turn's agent runs.
    const next = await sendMessageTurn(reviewed, [readFileTurn("toolu_r_draft", path), anthropicText("Read it.")], {
      message: "Read the draft again.",
    });
    const nextEnded = await awaitTerminal(clients, await next.run);
    expect(nextEnded.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    const read = toolUsesOf(await turnOfRun(clients, nextEnded)).find((use) => use.name === READ_FILE_TOOL);
    expect(read?.result?.text, "the next turn's agent reads the restored file").toContain("first draft");
    expect(read?.result?.text).not.toContain("second draft");

    const reconciled = await awaitUndone(reviewed, set.id, undone.reconcileRunId);
    expect(reconciled.undonePaths).toEqual([path]);
    expect(await workspace.readFile(path)).toBe(original);
    const log = await readFileReviewLog(clients, reviewed.sessionId);
    expect(log.reconciled.filter((e) => e.changeSetId === set.id), "reconciled once, whichever turn did it").toHaveLength(1);
    expect(
      log.decided.filter((e) => e.changeSetId === set.id && e.origin === "next_turn"),
      "an undone set has nothing left to keep",
    ).toHaveLength(0);
  });
});

// A fired turn runs in its routine's owner's conversation: only a runner
// that acts as each run's creator can serve it. The hosted edition serves those turns in the sandbox its
// composition provisions, proven by that composition's own suites.
describe.skipIf(
  !collectionTarget.capabilities.routineFiring || !collectionTarget.capabilities.runnerActsAsRunCreator,
)(
  "Run file review — an unattended turn's write (routineFiring targets)",
  () => {
    it("a fired turn that writes a file applies it and ends, with nothing to review (stigmer#1471)", async () => {
      const { org } = await target.provisionTenancy();
      const agent = await clients.agentCommand.create(
        makeAgent({
          org,
          name: uniqueName("agent-unattended"),
          instructions: "You are a test agent. Use the filesystem tools to write and read files.",
        }),
      );
      fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
      const routine = await clients.routineCommand.create(
        create(RoutineSchema, makeRoutine(org, uniqueName("routine-unattended"), agent.metadata!.slug)),
      );
      fixtures.defer(() => clients.routineCommand.delete({ value: routine.metadata!.id }));

      mock.enqueue(writeFileTurn("toolu_w_unattended", "report.txt", "nightly report\n"));
      mock.enqueue(readFileTurn("toolu_r_unattended", "report.txt"));
      mock.enqueue(anthropicText("Report written."));
      const fired = await clients.routineCommand.fire({ id: routine.metadata!.id });
      expect(fired.outcome, `the fire's refusal: ${fired.refusalReason}`).toBe(RoutineFireOutcome.STARTED);
      fixtures.defer(() => clients.agentExecutionCommand.delete({ value: fired.runId }).then(() => undefined, () => undefined));

      const final = await awaitTerminal(clients, fired.runId);
      expect(final.status?.approvalMode, "nobody is present at a fire").toBe(ApprovalMode.UNATTENDED);
      expect(final.status?.phase, `the turn ends: ${final.status?.error ?? ""}`).toBe(RunPhase.RUN_COMPLETED);
      const uses = toolUsesOf(await turnOfRun(clients, final));
      expect(uses.find((use) => use.name === WRITE_FILE_TOOL)?.state, "the write ran, not skipped").toBe("completed");
      expect(uses.find((use) => use.name === READ_FILE_TOOL)?.result?.text, "and its bytes are there to read").toContain(
        "nightly report",
      );
      expect(final.status?.fileChanges, "a fired conversation has review off").toHaveLength(0);
      expectNoModelCallLeft();
    });
  },
);

describe.skipIf(!collectionTarget.capabilities.billingGates)(
  "Run file review — an undo needs no provider key (billingGates targets)",
  () => {
    it("[billing.gate.provider-key.reconcile-turn-needs-no-key] an undo in an organization whose provider keys were removed still puts the file back", async () => {
      const workspace = await freshWorkspace();
      const path = "keyless.txt";
      const original = "before the turn\n";
      await workspace.seedFile(path, original);
      const reviewed = await runToReview(workspace, [
        editFileTurn("toolu_e_keyless", path, "before the turn", "after the turn"),
        anthropicText("Edited the file."),
      ]);
      // The organization keeps no key from here on: a turn that asks a model
      // would be refused at create, and the reconcile turn asks none.
      for (const provider of ["anthropic", "openai"]) {
        await clients.providerKeyCommand.delete({ org: reviewed.org, provider });
      }

      const undone = await reviewFileByPath(clients, reviewed.sessionId, reviewed.set, path, "undo");
      await awaitUndone(reviewed, reviewed.set.id, undone.reconcileRunId);
      expect(await workspace.readFile(path)).toBe(original);
    });
  },
);

// File review on Claude: the engine's own `Write` and `Edit` flow into the
// git workspace, the turn's delta is offered under the Claude harness's id,
// and a keep and an undo settle Claude's edits exactly as they settle
// native's. The turn is scripted by conversation (support/engine-arms.ts);
// a relative path is the engine's workspace's.
describe("Run file review — on Claude", () => {
  beforeEach(claudeTurnsOnly(collectionTarget.capabilities));
  /** A Claude review session on `workspace` and one turn playing `steps`, followed to its review. */
  async function claudeRunToReview(workspace: GitWorkspace, steps: readonly ArmStep[]): Promise<Reviewed> {
    const { org } = await target.provisionTenancy();
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-filereview-claude"), instructions: "You are a test agent. Use the file tools as instructed." }));
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    const session = await clients.sessionCommand.create(
      makeSession({ org, name: uniqueName("ses-filereview-claude"), agentRef: agentRefOf(agent), harness: Harness.CLAUDE, localWorkspaces: [{ name: "repo", path: workspace.dir }], fileReview: true }),
    );
    const sessionId = session.metadata!.id;
    fixtures.defer(() => clients.sessionCommand.delete({ value: sessionId }));
    const task = uniqueName("Use the file tools as instructed");
    CLAUDE_ARM.script(mock, task, steps);
    const execution = await clients.agentExecutionCommand.create(makeAgentExecution({ org, name: uniqueName("aex-filereview-claude"), sessionId, message: task }));
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
    const ended = await awaitFileReview(clients, executionId);
    expect(ended.status?.phase, `a turn never waits on review: ${ended.status?.error}`).toBe(RunPhase.RUN_COMPLETED);
    const turn = await turnById(clients, sessionId, executionId);
    expect(toolUsesOf(turn).filter((use) => use.ask !== undefined), "the edits flowed; no tool approval").toHaveLength(0);
    const set = requireReviewSet(ended);
    await expectUndecided(sessionId, set.id);
    return { org, sessionId, executionId, ended, set };
  }

  it("[rpc:SessionCommandController.reviewFileChanges] a Claude turn's Write is applied and offered under the Claude harness's id; keep records the decision and starts no turn", async () => {
    const workspace = await freshWorkspace();
    const path = "feature.txt";
    const content = "hello from Claude\n";
    const reviewed = await claudeRunToReview(workspace, [
      { kind: "write", id: `toolu_${uniqueName("write").replace(/-/g, "_")}`, path, content },
      { kind: "text", text: "Created the file." },
    ]);
    expect(reviewed.set.harnessId, "the Claude harness stamps its id").toBe("claude");
    const change = expectChange(reviewed.set, path, FileChangeKind.ADD);
    expect(change.after?.body).toEqual({ case: "inline", value: content });
    expect(await workspace.readFile(path), "the edit is applied before anyone decides").toBe(content);

    const kept = await reviewFileByPath(clients, reviewed.sessionId, reviewed.set, path, "keep");
    expect(kept.reconcileRunId, "a keep has nothing to put back").toBe("");
    expect(reviewStatesOf(await reviewSetNow(clients, reviewed.sessionId, reviewed.set.id))).toEqual([[path, "kept", "person"]]);
    expect(await workspace.readFile(path)).toBe(content);
    expect(await sessionRuns(reviewed.sessionId), "a keep starts no turn").toHaveLength(1);
  });

  it("[rpc:SessionCommandController.reviewFileChanges] undoing a Claude turn's Edit puts the baseline back through a reconcile turn that asks no model", async () => {
    const workspace = await freshWorkspace();
    const path = "notes.md";
    const original = "# Notes\noriginal line\n";
    await workspace.seedFile(path, original);
    const reviewed = await claudeRunToReview(workspace, [
      // The engine's Edit refuses a file this session has not read.
      { kind: "read", id: `toolu_${uniqueName("read").replace(/-/g, "_")}`, path },
      { kind: "edit", id: `toolu_${uniqueName("edit").replace(/-/g, "_")}`, path, oldString: "original line", newString: "changed line" },
      { kind: "text", text: "Edited the file." },
    ]);
    expectChange(reviewed.set, path, FileChangeKind.MODIFY);
    expect(await workspace.readFile(path), "the edit is applied when the turn ends").toBe("# Notes\nchanged line\n");
    const asked = CLAUDE_ARM.loopRequests(mock).length;

    const undone = await reviewFileByPath(clients, reviewed.sessionId, reviewed.set, path, "undo");
    const reconciled = await awaitUndone(reviewed, reviewed.set.id, undone.reconcileRunId);
    expect(reconciled.undonePaths).toEqual([path]);
    expect(await workspace.readFile(path), "an undo snaps the file back byte for byte").toBe(original);
    expect(reviewStatesOf(await reviewSetNow(clients, reviewed.sessionId, reviewed.set.id))).toEqual([[path, "undone", "person"]]);
    expect(CLAUDE_ARM.loopRequests(mock).length, "the reconcile asked no model").toBe(asked);
  });
});
