// Conformance suite for mid-run file-change progress: the live "N files
// changed so far" strip a console renders WHILE a turn is still editing, and its
// disappearance once the turn's set is offered for review.
// Domain: agentic / agentexecution — status.file_change_progress.
//
// Progress is the file-review analogue of setup_progress: a runner-owned,
// latest-snapshot-wins DISPLAY field (paths, kinds, line counts — no bytes, no
// digests, never decidable), attached to the runner's streaming persists while
// the turn's change set is CAPTURING and cleared by the server once that set
// leaves CAPTURING (filereview.proto FileChangeProgress). The turn-boundary
// CANDIDATE_CAPTURED stays the one reviewable diff.
//
// How the live strip actually moves under the runner's production posture
// (DD-001 of entry 20260910.02; the Go offline suite's
// file_review_progress_offline_test.go ran with the throttle turned OFF, a
// test-only posture DD-002 does not adopt, so its script does not transfer):
// the runner captures progress at most once per PROGRESS_CAPTURE_MIN_INTERVAL_MS
// (2 s by default, shared/filereview/progress.ts), on its persist cadence, and
// a tool's completion persist lands within the throttle of the capture its
// START persist took — so a snapshot publishes an edit one tool-turn LATE:
// the persist that opens turn N+1 is what shows edit N. Observed at D4 with
// the poll instrumented; a console developer should expect the same lag. The
// script therefore has THREE edits: the third is the publisher turn whose
// start persist (held past the interval on the mock) shows the first two, and
// the final text turn is held so the run stays mid-turn while the arm reads
// that snapshot. A tracked file is modified with edit_file (write_file
// creates; it does not overwrite a file the agent has not read).
import {
  ExecutionPhase,
  FileChangeKind,
  FileDecisionAction,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { FileChangeProgress, FileChangeProgressEntry } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { GitWorkspace, requireGit } from "../harness/git-workspace";
import type { AnthropicMessageBody, MockLlmProxy } from "../harness/mock-llm";
import { anthropicText, anthropicToolUse } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import { awaitPhase, makeAgentExecution, requireLlmProxy } from "../support/agentexecutions";
import {
  awaitFileChangeProgress,
  awaitFileReview,
  requireChangeByPath,
  requireReviewSet,
  submitChangeSetDecision,
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

// Past the runner's default capture interval, so the persist after the second
// edit is allowed to capture again (header).
const PAST_CAPTURE_INTERVAL_MS = 3_000;
// Keeps the run mid-turn while the arm observes; released as soon as it has.
const OBSERVATION_HOLD_MS = 30_000;

// A file edit the model makes: a create (write_file) or a tracked-file
// modification (edit_file).
type Edit =
  | { tool: "write_file"; path: string; content: string }
  | { tool: "edit_file"; path: string; oldString: string; newString: string };

function editTurn(toolCallId: string, edit: Edit): AnthropicMessageBody {
  switch (edit.tool) {
    case "write_file":
      return anthropicToolUse(toolCallId, "write_file", { file_path: edit.path, content: edit.content });
    case "edit_file":
      return anthropicToolUse(toolCallId, "edit_file", {
        file_path: edit.path,
        old_string: edit.oldString,
        new_string: edit.newString,
      });
    default: {
      const exhaustive: never = edit;
      throw new Error(`unknown edit: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function entryFor(progress: FileChangeProgress, path: string): FileChangeProgressEntry {
  const entry = progress.entries.find((e) => e.pathAfter === path || e.pathBefore === path);
  if (entry === undefined) {
    throw new Error(`progress has no entry for ${path} (paths: ${JSON.stringify(progress.entries.map((e) => e.pathAfter))})`);
  }
  return entry;
}

// The third, publishing edit every arm appends (header); its own change is
// asserted only at the boundary.
const PUBLISHER_EDIT: Edit = { tool: "write_file", path: "publisher.txt", content: "publisher\n" };

// One capture-mode execution whose script is: edit A, edit B (held past the
// capture interval), the publisher edit (held past it again), final text
// (held for observation).
async function startEditTurn(workspace: GitWorkspace, edits: [Edit, Edit]): Promise<string> {
  const { org } = await target.provisionTenancy();
  const agent = await clients.agentCommand.create(
    makeAgent({
      org,
      name: uniqueName("agent-progress"),
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
      name: uniqueName("ses-progress"),
      agentInstanceId: instanceId,
      harness: Harness.NATIVE,
      localWorkspaces: [{ name: "repo", path: workspace.dir }],
    }),
  );
  fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));

  mock.enqueue(editTurn("toolu_e1", edits[0]));
  mock.enqueue(editTurn("toolu_e2", edits[1]), { delayMs: PAST_CAPTURE_INTERVAL_MS });
  mock.enqueue(editTurn("toolu_e3", PUBLISHER_EDIT), { delayMs: PAST_CAPTURE_INTERVAL_MS });
  mock.enqueue(anthropicText("Edited the files."), { delayMs: OBSERVATION_HOLD_MS });

  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({
      org,
      name: uniqueName("aex-progress"),
      sessionId: session.metadata!.id,
      message: "Edit the files using the filesystem tools.",
    }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
  return executionId;
}

// Observes the mid-run snapshot the publisher turn produced: the first two
// edits, the publisher's own not yet (it lands one turn late, like the others).
async function observeFirstTwoEdits(executionId: string): Promise<FileChangeProgress> {
  const midRun = await awaitFileChangeProgress(clients, executionId, (p) => p.filesChanged === 2);
  const progress = midRun.status!.fileChangeProgress!;
  const capturing = midRun.status!.fileChangeSets.find((s) => s.id === progress.changeSetId);
  expect(capturing, "the snapshot previews the CAPTURING set by id").toBeDefined();
  expect(progress.entries, "both edits are listed").toHaveLength(2);
  return progress;
}

// Releases the held final turn, awaits the review boundary, asserts the
// progress snapshot is gone and every write is in the set, then discards the
// set so the run completes.
async function expectClearedAtBoundary(executionId: string, paths: string[]): Promise<void> {
  mock.releaseHolds();
  const waiting = await awaitFileReview(clients, executionId);
  expect(waiting.status?.fileChangeProgress, "progress is cleared once the set leaves CAPTURING").toBeUndefined();
  const set = requireReviewSet(waiting);
  for (const path of paths) requireChangeByPath(set, path);
  await submitChangeSetDecision(clients, executionId, set, FileDecisionAction.REJECT);
  await awaitPhase(clients, executionId, ExecutionPhase.EXECUTION_COMPLETED);
}

describe("AgentExecution file review — mid-run progress", () => {
  it("mid-run file_change_progress reports the touched files with line counts during a held turn and clears at the review boundary", async () => {
    const workspace = await GitWorkspace.create();
    fixtures.defer(() => workspace.cleanup());
    await workspace.seedFile("existing.txt", "alpha\nbeta\n");

    const executionId = await startEditTurn(workspace, [
      { tool: "write_file", path: "created.txt", content: "one\ntwo\nthree\n" },
      { tool: "edit_file", path: "existing.txt", oldString: "beta", newString: "BETA" },
    ]);

    const progress = await observeFirstTwoEdits(executionId);
    const created = entryFor(progress, "created.txt");
    expect(created.kind).toBe(FileChangeKind.ADD);
    expect(created.linesAdded).toBe(3);
    expect(created.linesRemoved).toBe(0);
    const modified = entryFor(progress, "existing.txt");
    expect(modified.kind).toBe(FileChangeKind.MODIFY);
    expect(modified.linesAdded, "one line replaced: one added").toBe(1);
    expect(modified.linesRemoved, "one line replaced: one removed").toBe(1);

    await expectClearedAtBoundary(executionId, ["created.txt", "existing.txt", PUBLISHER_EDIT.path]);
  });

  it("a gitignored file appears in the same progress snapshot as a tracked one", async () => {
    const workspace = await GitWorkspace.create();
    fixtures.defer(() => workspace.cleanup());
    await workspace.seedGitignorePattern("cache/");

    const executionId = await startEditTurn(workspace, [
      { tool: "write_file", path: "tracked.txt", content: "one line\n" },
      { tool: "write_file", path: "cache/data.txt", content: "two\nlines\n" },
    ]);

    const progress = await observeFirstTwoEdits(executionId);
    const tracked = entryFor(progress, "tracked.txt");
    expect(tracked.kind).toBe(FileChangeKind.ADD);
    expect(tracked.linesAdded).toBe(1);
    const ignored = entryFor(progress, "cache/data.txt");
    expect(ignored.kind, "the ignored path rides the same snapshot through the content-addressed side").toBe(
      FileChangeKind.ADD,
    );
    expect(ignored.linesAdded).toBe(2);

    await expectClearedAtBoundary(executionId, ["tracked.txt", "cache/data.txt", PUBLISHER_EDIT.path]);
  });
});
