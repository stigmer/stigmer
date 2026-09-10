// Conformance suite for AgentExecution file review (apply-then-review HITL):
// a native-harness turn edits files in a git workspace, the runner offers the
// turn's delta as one FileChangeSet, the reviewer keeps or discards per file or
// as a set, and the runner reconciles exactly the approved bytes.
// Domain: agentic / agentexecution — status.file_change_sets, the
// file_review_event_stream ledger, and submitFileDecision.
//
// The loop under test (filereview.proto): a git-tracked edit FLOWS during the
// turn (no mid-turn gate); at the boundary the runner snapshots baseline and
// candidate, authors the diff as a FileChangeSet AWAITING_REVIEW while the
// execution sits in EXECUTION_WAITING_FOR_APPROVAL with ZERO pending_approvals;
// submitFileDecision binds each decision to the digest the reviewer saw; the
// runner reconciles and the ledger records RECONCILED. Reconciling a pure file
// review is deliberately checkpointer-independent — it reads the persisted
// transcript, the on-disk git refs and the server-persisted set — so "no model
// re-invocation on a decision" is provable: every arm asserts mock.remaining()
// is 0 (a wrongful re-run would request an unscripted turn, get a 500, and FAIL
// the run instead of completing it).
//
// Capture mode is selected by attaching a real git work tree as the session's
// LocalPathSource workspace (harness/git-workspace.ts): the runner, spawned by
// this harness on this host, operates in place. The secret rules are exercised
// through paths the fixture ignores (.env) or that carry secret-like content
// on a tracked path (config/credentials.json): a secret's bytes must never
// enter the ledger, the status JSON, or the artifact store, and such an entry
// is discard-only (fail-closed). Binary changes are reviewable only by an
// explicit acknowledgement. Gitignored NON-secret paths are captured through
// the content-addressed store and reconciled from it.
//
// Contract by DD-001 of entry 20260910.02; replaces the Go offline suite's
// file_review_offline_test.go arm for arm (T01_1 rows 45–59). Reads of the
// workspace are the suite's own fixture, not a runner internal.
import { Code } from "@connectrpc/connect";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionSchema, type AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  DiffCompleteness,
  ExecutionPhase,
  FileCaptureClass,
  FileChangeKind,
  FileDecisionAction,
  FileReviewBlockReason,
  FileReviewEventType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { CapturedFileChange, FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { GitWorkspace, requireGit } from "../harness/git-workspace";
import type { AnthropicMessageBody, MockLlmProxy } from "../harness/mock-llm";
import { anthropicText, anthropicToolUse } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import { allToolCalls, awaitPhase, makeAgentExecution, requireLlmProxy } from "../support/agentexecutions";
import {
  awaitFileReview,
  fileReviewStreamHas,
  requireChangeByPath,
  requireReviewSet,
  submitChangeSetDecision,
  submitFileDecisionByPath,
} from "../support/file-review";
import { uniqueName } from "../support/naming";
import { makeSession } from "../support/sessions";
import { createTarget, type TargetProfile } from "../targets";

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
// The harness id the native runner stamps on a change set.
const DEEP_AGENT_HARNESS_ID = "deep-agent";

function writeFileTurn(toolCallId: string, path: string, content: string): AnthropicMessageBody {
  return anthropicToolUse(toolCallId, WRITE_FILE_TOOL, { file_path: path, content });
}

function editFileTurn(toolCallId: string, path: string, oldString: string, newString: string): AnthropicMessageBody {
  return anthropicToolUse(toolCallId, EDIT_FILE_TOOL, { file_path: path, old_string: oldString, new_string: newString });
}

// Wires one execution against `workspace` in capture mode: an agent with the
// file tools, a NATIVE session whose primary workspace is the git work tree,
// and the scripted turns. Returns the execution id; the caller awaits review.
async function startFileReviewRun(
  workspace: GitWorkspace,
  turns: AnthropicMessageBody[],
  opts: { message?: string; autoApproveAll?: boolean } = {},
): Promise<string> {
  const { org } = await target.provisionTenancy();
  const agent = await clients.agentCommand.create(
    makeAgent({
      org,
      name: uniqueName("agent-filereview"),
      instructions: "You are a test agent. Use the filesystem tools to write, edit, and delete files.",
    }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  const instanceId = agent.status?.defaultInstanceId;
  if (instanceId === undefined || instanceId === "") {
    throw new Error("agent create did not provision a default instance");
  }

  const session = await clients.sessionCommand.create(
    makeSession({
      org,
      name: uniqueName("ses-filereview"),
      agentInstanceId: instanceId,
      harness: Harness.NATIVE,
      localWorkspaces: [{ name: "repo", path: workspace.dir }],
    }),
  );
  fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));

  for (const turn of turns) mock.enqueue(turn);
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({
      org,
      name: uniqueName("aex-filereview"),
      sessionId: session.metadata!.id,
      message: opts.message ?? "Use the filesystem tools as instructed.",
      autoApproveAll: opts.autoApproveAll ?? false,
    }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
  return executionId;
}

// A fresh workspace whose cleanup is deferred with the run's other fixtures.
async function freshWorkspace(): Promise<GitWorkspace> {
  const workspace = await GitWorkspace.create();
  fixtures.defer(() => workspace.cleanup());
  return workspace;
}

// Runs the scripted turn to its review boundary and returns the parked execution
// and its one AWAITING_REVIEW set. Asserts the two facts every arm shares: the
// phase is WAITING_FOR_APPROVAL and there is no TOOL gate (file review is the
// only surface).
async function runToReview(
  workspace: GitWorkspace,
  turns: AnthropicMessageBody[],
  opts: { message?: string; autoApproveAll?: boolean } = {},
): Promise<{ executionId: string; waiting: AgentExecution; set: FileChangeSet }> {
  const executionId = await startFileReviewRun(workspace, turns, opts);
  const waiting = await awaitFileReview(clients, executionId);
  expect(waiting.status?.phase).toBe(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL);
  expect(waiting.status?.pendingApprovals, "file review is the only gate; no tool approval").toHaveLength(0);
  return { executionId, waiting, set: requireReviewSet(waiting) };
}

async function awaitCompleted(executionId: string): Promise<AgentExecution> {
  const final = await awaitPhase(clients, executionId, ExecutionPhase.EXECUTION_COMPLETED);
  expect(mock.remaining(), "a pure file-review decision must NOT re-invoke the model").toBe(0);
  return final;
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

describe("AgentExecution file review — keep and discard", () => {
  it("approving a tracked ADD lands the bytes, records RECONCILED and leaves HEAD untouched", async () => {
    const workspace = await freshWorkspace();
    const headBefore = await workspace.headSha();
    const path = "feature.txt";
    const content = "hello\nworld\n";

    const { executionId, waiting, set } = await runToReview(workspace, [
      writeFileTurn("toolu_w1", path, content),
      anthropicText("Created the file."),
    ]);

    expect(set.harnessId, "the native harness stamps its id").toBe(DEEP_AGENT_HARNESS_ID);
    expect(set.aggregateDigest).not.toBe("");
    const change = expectChange(set, path, FileChangeKind.ADD);
    expect(change.before, "an ADD has no before side").toBeUndefined();
    expect(change.after?.body, "an ADD carries the new content inline").toEqual({ case: "inline", value: content });
    expect(change.afterSha256, "the reconcile enforcement digest").not.toBe("");
    expect(fileReviewStreamHas(waiting, FileReviewEventType.BASELINE_CAPTURED, set.id)).toBe(true);
    expect(fileReviewStreamHas(waiting, FileReviewEventType.CANDIDATE_CAPTURED, set.id)).toBe(true);

    // The flowed file-edit row stays visible in the transcript, stamped with the
    // set it contributed to — file_change_sets remains the one DECISION surface.
    const row = allToolCalls(waiting).find((tc) => tc.name === WRITE_FILE_TOOL);
    expect(row, "the flowed edit row remains in the transcript").toBeDefined();
    expect(row!.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(row!.fileChangeSetId, "the row names the projected set").toBe(set.id);
    expect(row!.args, "an observational row keeps its args").toBeDefined();

    await submitFileDecisionByPath(clients, executionId, set, path, FileDecisionAction.APPROVE);
    const final = await awaitCompleted(executionId);

    expect(await workspace.readFile(path), "the approved bytes are on disk verbatim").toBe(content);
    expect(fileReviewStreamHas(final, FileReviewEventType.RECONCILED, set.id)).toBe(true);
    expect(await workspace.headSha(), "capture mode never commits").toBe(headBefore);
  });

  it("rejecting a MODIFY restores the baseline bytes exactly", async () => {
    const workspace = await freshWorkspace();
    const path = "notes.md";
    const original = "# Notes\noriginal line\n";
    await workspace.seedFile(path, original);
    const headBefore = await workspace.headSha();

    const { executionId, set } = await runToReview(workspace, [
      editFileTurn("toolu_e1", path, "original line", "changed line"),
      anthropicText("Edited the file."),
    ]);

    const change = expectChange(set, path, FileChangeKind.MODIFY);
    expect(change.before?.body, "a MODIFY carries the pre-edit content").toEqual({ case: "inline", value: original });

    await submitFileDecisionByPath(clients, executionId, set, path, FileDecisionAction.REJECT);
    const final = await awaitCompleted(executionId);

    expect(await workspace.readFile(path), "a reject snaps the file back byte for byte").toBe(original);
    expect(fileReviewStreamHas(final, FileReviewEventType.RECONCILED, set.id)).toBe(true);
    expect(await workspace.headSha()).toBe(headBefore);
    const row = allToolCalls(final).find((tc) => tc.name === EDIT_FILE_TOOL);
    expect(row?.status, "the edit row stays COMPLETED even though its file was discarded").toBe(
      ToolCallStatus.TOOL_CALL_COMPLETED,
    );
    expect(row?.fileChangeSetId).toBe(set.id);
  });

  it("a per-file split decision lands the kept file and drops the rejected one", async () => {
    const workspace = await freshWorkspace();
    const { executionId, set } = await runToReview(workspace, [
      writeFileTurn("toolu_w_keep", "keep.txt", "keep me\n"),
      writeFileTurn("toolu_w_drop", "drop.txt", "drop me\n"),
      anthropicText("Created both files."),
    ]);
    expect(set.changes).toHaveLength(2);
    expectChange(set, "keep.txt", FileChangeKind.ADD);
    expectChange(set, "drop.txt", FileChangeKind.ADD);

    await submitFileDecisionByPath(clients, executionId, set, "keep.txt", FileDecisionAction.APPROVE);
    await submitFileDecisionByPath(clients, executionId, set, "drop.txt", FileDecisionAction.REJECT);
    await awaitCompleted(executionId);

    expect(await workspace.readFile("keep.txt")).toBe("keep me\n");
    expect(await workspace.exists("drop.txt"), "the rejected create never lands").toBe(false);
  });

  it("a change-set APPROVE with the aggregate digest lands every file", async () => {
    const workspace = await freshWorkspace();
    const { executionId, set } = await runToReview(workspace, [
      writeFileTurn("toolu_w_a", "alpha.txt", "alpha\n"),
      writeFileTurn("toolu_w_b", "beta.txt", "beta\n"),
      anthropicText("Created both files."),
    ]);
    expect(set.changes).toHaveLength(2);

    await submitChangeSetDecision(clients, executionId, set, FileDecisionAction.APPROVE);
    const final = await awaitCompleted(executionId);

    expect(fileReviewStreamHas(final, FileReviewEventType.RECONCILED, set.id)).toBe(true);
    expect(await workspace.readFile("alpha.txt")).toBe("alpha\n");
    expect(await workspace.readFile("beta.txt")).toBe("beta\n");
  });

  it("a stale expected_digest is InvalidArgument and leaves the set AWAITING_REVIEW", async () => {
    const workspace = await freshWorkspace();
    const path = "config.txt";
    const { executionId, set } = await runToReview(workspace, [
      writeFileTurn("toolu_w_cfg", path, "key=value\n"),
      anthropicText("Created the file."),
    ]);

    await expectGrpcCode(
      () =>
        submitFileDecisionByPath(clients, executionId, set, path, FileDecisionAction.APPROVE, {
          expectedDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        }),
      Code.InvalidArgument,
      "a decision bound to a digest the reviewer did not see is refused",
    );
    const still = await clients.agentExecutionQuery.get({ value: executionId });
    expect(still.status?.phase, "the refusal decides nothing").toBe(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL);
    requireReviewSet(still);

    await submitFileDecisionByPath(clients, executionId, set, path, FileDecisionAction.APPROVE);
    await awaitCompleted(executionId);
    expect(await workspace.readFile(path)).toBe("key=value\n");
  });
});

describe("AgentExecution file review — binary changes", () => {
  it("a binary change is summary-only: APPROVE is FailedPrecondition, REJECT completes", async () => {
    const workspace = await freshWorkspace();
    const path = "blob.bin";
    const { executionId, set } = await runToReview(workspace, [
      writeFileTurn("toolu_bin", path, "\u0000binary\u0000payload\n"),
      anthropicText("Wrote the binary asset."),
    ]);

    expect(set.diffCompleteness, "binary is the set's only blocker").toBe(DiffCompleteness.BINARY_SUMMARY_ONLY);
    const change = requireChangeByPath(set, path);
    expect(change.diffComplete, "a binary diff cannot be shown").toBe(false);
    expect(change.after?.isBinary, "the side is flagged binary").toBe(true);
    expect(change.after?.body.case, "no lossy inline text for a binary side").toBeUndefined();
    expect(change.afterSha256, "but the byte-true digest is there").not.toBe("");

    await expectGrpcCode(
      () => submitFileDecisionByPath(clients, executionId, set, path, FileDecisionAction.APPROVE),
      Code.FailedPrecondition,
      "an unreviewable diff cannot be approved as-is",
    );
    const still = await clients.agentExecutionQuery.get({ value: executionId });
    expect(still.status?.phase).toBe(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL);

    await submitFileDecisionByPath(clients, executionId, set, path, FileDecisionAction.REJECT);
    await awaitCompleted(executionId);
    expect(await workspace.exists(path), "the rejected binary never lands").toBe(false);
  });

  it("acknowledge_unreviewable with the right digest lands binary bytes verbatim", async () => {
    const workspace = await freshWorkspace();
    const headBefore = await workspace.headSha();
    const path = "assets/logo.bin";
    const content = "\u0000PNG\u0000\u0001\u0002keep-me\n";
    const { executionId, set } = await runToReview(workspace, [
      writeFileTurn("toolu_bin", path, content),
      anthropicText("Wrote the binary asset."),
    ]);
    expect(set.diffCompleteness).toBe(DiffCompleteness.BINARY_SUMMARY_ONLY);
    expect(requireChangeByPath(set, path).after?.isBinary).toBe(true);

    await expectGrpcCode(
      () => submitFileDecisionByPath(clients, executionId, set, path, FileDecisionAction.APPROVE),
      Code.FailedPrecondition,
      "a binary approve without the acknowledgement is refused",
    );
    await expectGrpcCode(
      () =>
        submitFileDecisionByPath(clients, executionId, set, path, FileDecisionAction.APPROVE, {
          acknowledgeUnreviewable: true,
          expectedDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        }),
      Code.InvalidArgument,
      "the acknowledgement never relaxes the digest gate",
    );

    await submitFileDecisionByPath(clients, executionId, set, path, FileDecisionAction.APPROVE, {
      acknowledgeUnreviewable: true,
    });
    const final = await awaitCompleted(executionId);

    expect((await workspace.readBytes(path)).toString("utf8"), "the exact bytes landed").toBe(content);
    expect(fileReviewStreamHas(final, FileReviewEventType.RECONCILED, set.id)).toBe(true);
    expect(await workspace.headSha()).toBe(headBefore);
  });

  it("a change-set approve over a binary needs the acknowledgement, then lands both files", async () => {
    const workspace = await freshWorkspace();
    const textPath = "README.md";
    const binPath = "assets/logo.bin";
    const textBody = "# Title\nupdated\n";
    const binBody = "\u0000PNG\u0000\u0001\u0002keep-me\n";
    const { executionId, set } = await runToReview(workspace, [
      writeFileTurn("toolu_text", textPath, textBody),
      writeFileTurn("toolu_bin", binPath, binBody),
      anthropicText("Wrote a text file and a binary asset."),
    ]);
    expect(set.diffCompleteness).toBe(DiffCompleteness.BINARY_SUMMARY_ONLY);
    expect(expectChange(set, textPath, FileChangeKind.ADD).diffComplete, "the text file is reviewable").toBe(true);
    expect(requireChangeByPath(set, binPath).after?.isBinary).toBe(true);

    await expectGrpcCode(
      () => submitChangeSetDecision(clients, executionId, set, FileDecisionAction.APPROVE),
      Code.FailedPrecondition,
      "a keep-all over a binary needs the acknowledgement",
    );
    await submitChangeSetDecision(clients, executionId, set, FileDecisionAction.APPROVE, { acknowledgeUnreviewable: true });
    const final = await awaitCompleted(executionId);

    expect(await workspace.readFile(textPath)).toBe(textBody);
    expect((await workspace.readBytes(binPath)).toString("utf8")).toBe(binBody);
    expect(fileReviewStreamHas(final, FileReviewEventType.RECONCILED, set.id)).toBe(true);
  });

  it("a secret in the set blocks change-set approve even when acknowledged; per-file decisions still complete", async () => {
    const workspace = await freshWorkspace();
    const textPath = "notes.md";
    const binPath = "assets/pic.bin";
    const secretPath = ".env";
    const { executionId, set } = await runToReview(workspace, [
      writeFileTurn("toolu_text", textPath, "kept notes\n"),
      writeFileTurn("toolu_bin", binPath, "\u0000JPG\u0000keep\n"),
      writeFileTurn("toolu_env", secretPath, "SECRET=1\n"),
      anthropicText("Wrote a text file, a binary, and an env file."),
    ]);
    expect(set.diffCompleteness, "a non-binary blocker makes the set PARTIAL_BLOCKED").toBe(
      DiffCompleteness.PARTIAL_BLOCKED,
    );

    await expectGrpcCode(
      () => submitChangeSetDecision(clients, executionId, set, FileDecisionAction.APPROVE, { acknowledgeUnreviewable: true }),
      Code.FailedPrecondition,
      "the acknowledgement covers binaries only; a secret keeps the set discard-only as a whole",
    );

    await submitFileDecisionByPath(clients, executionId, set, textPath, FileDecisionAction.APPROVE);
    await submitFileDecisionByPath(clients, executionId, set, binPath, FileDecisionAction.APPROVE, {
      acknowledgeUnreviewable: true,
    });
    await submitFileDecisionByPath(clients, executionId, set, secretPath, FileDecisionAction.REJECT);
    await awaitCompleted(executionId);

    expect(await workspace.readFile(textPath)).toBe("kept notes\n");
    expect((await workspace.readBytes(binPath)).toString("utf8")).toBe("\u0000JPG\u0000keep\n");
    expect(await workspace.exists(secretPath), "the secret never lands").toBe(false);
  });
});

describe("AgentExecution file review — secrets never persist", () => {
  it("a gitignored secret is captured path-only: approve is refused, reject completes, the file never lands", async () => {
    const workspace = await freshWorkspace();
    const path = ".env";
    const { executionId, set } = await runToReview(workspace, [
      writeFileTurn("toolu_w_env", path, "SECRET=1\n"),
      anthropicText("Wrote the env file."),
    ]);

    expect(set.diffCompleteness).toBe(DiffCompleteness.PARTIAL_BLOCKED);
    const change = requireChangeByPath(set, path);
    expect(change.diffComplete).toBe(false);
    expect(change.captureClass).toBe(FileCaptureClass.GIT_IGNORED_CAPTURED);
    expect(change.after, "the secret's content never enters the ledger").toBeUndefined();
    expect(await workspace.exists(path), "the write was blocked at the tool, not just reviewed").toBe(false);

    await expectGrpcCode(
      () => submitFileDecisionByPath(clients, executionId, set, path, FileDecisionAction.APPROVE),
      Code.FailedPrecondition,
      "a secret entry has no keepable bytes",
    );
    expect((await clients.agentExecutionQuery.get({ value: executionId })).status?.phase).toBe(
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    );

    await submitFileDecisionByPath(clients, executionId, set, path, FileDecisionAction.REJECT);
    await awaitCompleted(executionId);
    expect(await workspace.exists(path)).toBe(false);
  });

  it("a tracked file and a secret in one turn: tracked kept, secret discarded", async () => {
    const workspace = await freshWorkspace();
    const trackedPath = "tracked.txt";
    const secretPath = ".env";
    const { executionId, set } = await runToReview(workspace, [
      writeFileTurn("toolu_w_tracked", trackedPath, "tracked body\n"),
      writeFileTurn("toolu_w_ignored", secretPath, "SECRET=1\n"),
      anthropicText("Wrote both files."),
    ]);
    expect(set.diffCompleteness).toBe(DiffCompleteness.PARTIAL_BLOCKED);
    expect(expectChange(set, trackedPath, FileChangeKind.ADD).diffComplete).toBe(true);
    expect(requireChangeByPath(set, secretPath).diffComplete).toBe(false);

    await submitFileDecisionByPath(clients, executionId, set, trackedPath, FileDecisionAction.APPROVE);
    await submitFileDecisionByPath(clients, executionId, set, secretPath, FileDecisionAction.REJECT);
    await awaitCompleted(executionId);

    expect(await workspace.readFile(trackedPath)).toBe("tracked body\n");
    expect(await workspace.exists(secretPath)).toBe(false);
  });

  it("a tracked secret is SECRET_WITHHELD: no bytes in status or the artifact store; approve refused, reject restores", async (ctx) => {
    if (target.artifactStoreDir === undefined) return ctx.skip();
    const workspace = await freshWorkspace();
    const path = "config/credentials.json";
    const oldToken = "OLDSECRETtoken111";
    const newToken = "NEWSECRETtoken222";
    const baseline = `API_KEY=sk-live-${oldToken}\n`;
    await workspace.seedFile(path, baseline);

    const { executionId, waiting, set } = await runToReview(workspace, [
      editFileTurn("toolu_e_creds", path, oldToken, newToken),
      anthropicText("Updated the credentials file."),
    ]);

    expect(set.diffCompleteness).toBe(DiffCompleteness.PARTIAL_BLOCKED);
    const change = expectChange(set, path, FileChangeKind.MODIFY);
    expect(change.diffComplete).toBe(false);
    expect(change.blockedReason).toBe(FileReviewBlockReason.SECRET_WITHHELD);
    expect(change.captureClass, "a tracked path, withheld for its content").toBe(FileCaptureClass.GIT_TRACKED);
    expect(change.before, "the baseline secret's bytes never enter the ledger").toBeUndefined();
    expect(change.after, "the new secret's bytes never enter the ledger").toBeUndefined();

    const statusJson = JSON.stringify(toJson(AgentExecutionSchema, waiting));
    expect(statusJson, "the old token is nowhere on the wire").not.toContain(oldToken);
    expect(statusJson, "the new token is nowhere on the wire").not.toContain(newToken);
    const store = target.artifactStoreDir();
    expect(await storeContains(store, oldToken), "the old token never reached the artifact store").toBe(false);
    expect(await storeContains(store, newToken), "the new token never reached the artifact store").toBe(false);

    await expectGrpcCode(
      () => submitFileDecisionByPath(clients, executionId, set, path, FileDecisionAction.APPROVE),
      Code.FailedPrecondition,
      "a withheld entry is discard-only",
    );
    await submitFileDecisionByPath(clients, executionId, set, path, FileDecisionAction.REJECT);
    await awaitCompleted(executionId);
    expect(await workspace.readFile(path), "the reject restores the baseline").toBe(baseline);
  });

  it("auto_approve_all does not bypass file review for a secret, and the secret never persists", async (ctx) => {
    if (target.artifactStoreDir === undefined) return ctx.skip();
    const workspace = await freshWorkspace();
    const path = ".env";
    const secret = "API_KEY=sk-live-SUPER-SECRET-DO-NOT-PERSIST-abc123xyz\n";
    const { executionId, waiting, set } = await runToReview(
      workspace,
      [writeFileTurn("toolu_w_env", path, secret), anthropicText("Wrote the env file.")],
      { autoApproveAll: true },
    );

    expect(set.diffCompleteness).toBe(DiffCompleteness.PARTIAL_BLOCKED);
    const change = requireChangeByPath(set, path);
    expect(change.diffComplete).toBe(false);
    expect(change.captureClass).toBe(FileCaptureClass.GIT_IGNORED_CAPTURED);
    expect(change.before).toBeUndefined();
    expect(change.after).toBeUndefined();
    // Under the global bypass the write itself is accepted (the tool gate is
    // off); what stays fail-closed is that the bytes never persist anywhere.
    expect(await workspace.exists(path), "the bypass let the write land in the working tree").toBe(true);

    expect(JSON.stringify(toJson(AgentExecutionSchema, waiting)), "the secret is nowhere on the wire").not.toContain(
      secret.trim(),
    );
    expect(await storeContains(target.artifactStoreDir(), secret.trim()), "the secret never reached the store").toBe(
      false,
    );

    await submitFileDecisionByPath(clients, executionId, set, path, FileDecisionAction.REJECT);
    await awaitCompleted(executionId);
  });
});

describe("AgentExecution file review — gitignored captures and durability", () => {
  it("gitignored non-secret files are captured, reviewed and reconciled from the artifact store", async () => {
    const workspace = await freshWorkspace();
    await workspace.seedGitignorePattern("cache/");
    const { executionId, set } = await runToReview(workspace, [
      writeFileTurn("toolu_w_tracked", "tracked.txt", "tracked body\n"),
      writeFileTurn("toolu_w_keep", "cache/keep.txt", "cache keep body\n"),
      writeFileTurn("toolu_w_drop", "cache/drop.txt", "cache drop body\n"),
      anthropicText("Wrote a tracked file and two ignored files."),
    ]);

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

    await submitFileDecisionByPath(clients, executionId, set, "tracked.txt", FileDecisionAction.APPROVE);
    await submitFileDecisionByPath(clients, executionId, set, "cache/keep.txt", FileDecisionAction.APPROVE);
    await submitFileDecisionByPath(clients, executionId, set, "cache/drop.txt", FileDecisionAction.REJECT);
    await awaitCompleted(executionId);

    expect(await workspace.readFile("tracked.txt")).toBe("tracked body\n");
    expect(await workspace.readFile("cache/keep.txt")).toBe("cache keep body\n");
    expect(await workspace.exists("cache/drop.txt")).toBe(false);
  });

  it("a change-set approve restores every file byte-exact after the working tree was wiped", async () => {
    const workspace = await freshWorkspace();
    await workspace.seedGitignorePattern("cache/");
    const trackedPath = "tracked.txt";
    const ignoredPath = "cache/data.txt";
    const { executionId, set } = await runToReview(workspace, [
      writeFileTurn("toolu_w_tracked", trackedPath, "durable tracked body\n"),
      writeFileTurn("toolu_w_ignored", ignoredPath, "durable cas body\n"),
      anthropicText("Wrote a tracked and an ignored file."),
    ]);
    requireChangeByPath(set, trackedPath);
    requireChangeByPath(set, ignoredPath);

    // A sandbox recycle: the working files are gone; only the git object store
    // and the content-addressed store survive.
    await workspace.removeWorkingFile(trackedPath);
    await workspace.removeWorkingFile(ignoredPath);
    expect(await workspace.exists(trackedPath)).toBe(false);
    expect(await workspace.exists(ignoredPath)).toBe(false);

    await submitChangeSetDecision(clients, executionId, set, FileDecisionAction.APPROVE);
    await awaitCompleted(executionId);

    expect(await workspace.readFile(trackedPath), "restored from the git snapshot").toBe("durable tracked body\n");
    expect(await workspace.readFile(ignoredPath), "restored from the content-addressed store").toBe("durable cas body\n");
  });
});
