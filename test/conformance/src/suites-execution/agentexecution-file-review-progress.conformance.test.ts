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
// THE CONTRACT THIS FILE PINS, and the one it deliberately does not. While the
// set is CAPTURING, the strip CONVERGES to the edits made so far, each with its
// kind and line counts; once the set leaves CAPTURING, the strip is gone and
// every edit is in the reviewable set. What any ONE snapshot shows is not a
// contract: the runner captures on its persist cadence, at most once per
// PROGRESS_CAPTURE_MIN_INTERVAL_MS (2 s by default), and a capture runs while
// the tool whose start triggered the persist may still be writing — so a
// snapshot can be a turn behind, half-written, or already carry the next tool's
// file (the runner's shared/filereview/progress.ts header, "What a capture may
// see"). An arm therefore states the entries it expects and waits until a
// CAPTURING snapshot carries all of them with their counts
// (`awaitProgressEntries`); it never waits for "the first snapshot with two
// files", which is the shape that flaked on a slow runner for a week.
//
// WHY THE SCRIPT HAS THREE EDITS AND A HELD FINAL TURN. Captures ride persists
// and persists ride the engine's events, so nothing is captured while the mock
// holds a response: the snapshot freezes at the last capture. The two edits an
// arm asserts are followed by a third, publishing edit whose start persist is
// guaranteed a fresh capture (its request is held past the capture interval,
// so the floor has elapsed since the second edit's capture, and the second
// edit's write is complete by then), and the final text turn is held so the run
// stays mid-turn while the arm reads. The publisher's own file may or may not
// appear in the snapshot the arm lands on; it is asserted only at the boundary.
// A tracked file is modified with edit_file (write_file creates; it does not
// overwrite a file the agent has not read).
import {
  ExecutionPhase,
  FileChangeKind,
  FileDecisionAction,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
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
  awaitFileReview,
  awaitProgressEntries,
  type ExpectedProgressEntry,
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

// Each edit turn after the first is held this long before the mock answers,
// past the runner's default capture interval, so the persist that opens the
// next turn is allowed to capture again (header). Below the interval the
// publisher's capture could be throttled away and the arm would wait on a
// frozen snapshot.
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

// Waits for the mid-run snapshot to carry the first two edits with their
// counts (the converged shape, header) and checks it previews the CAPTURING
// set by id — the one fact the wait's predicate does not already assert.
async function observeFirstTwoEdits(executionId: string, expected: [ExpectedProgressEntry, ExpectedProgressEntry]): Promise<void> {
  const midRun = await awaitProgressEntries(clients, executionId, expected);
  const progress = midRun.status!.fileChangeProgress!;
  const capturing = midRun.status!.fileChangeSets.find((s) => s.id === progress.changeSetId);
  expect(capturing, "the snapshot previews the CAPTURING set by id").toBeDefined();
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
  it("mid-run file_change_progress converges to the touched files with line counts during a held turn and clears at the review boundary", async () => {
    const workspace = await GitWorkspace.create();
    fixtures.defer(() => workspace.cleanup());
    await workspace.seedFile("existing.txt", "alpha\nbeta\n");

    const executionId = await startEditTurn(workspace, [
      { tool: "write_file", path: "created.txt", content: "one\ntwo\nthree\n" },
      { tool: "edit_file", path: "existing.txt", oldString: "beta", newString: "BETA" },
    ]);

    await observeFirstTwoEdits(executionId, [
      { path: "created.txt", kind: FileChangeKind.ADD, linesAdded: 3, linesRemoved: 0 },
      // One line replaced: one added, one removed.
      { path: "existing.txt", kind: FileChangeKind.MODIFY, linesAdded: 1, linesRemoved: 1 },
    ]);

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

    await observeFirstTwoEdits(executionId, [
      { path: "tracked.txt", kind: FileChangeKind.ADD, linesAdded: 1, linesRemoved: 0 },
      // The ignored path rides the same snapshot through the content-addressed side.
      { path: "cache/data.txt", kind: FileChangeKind.ADD, linesAdded: 2, linesRemoved: 0 },
    ]);

    await expectClearedAtBoundary(executionId, ["tracked.txt", "cache/data.txt", PUBLISHER_EDIT.path]);
  });
});
