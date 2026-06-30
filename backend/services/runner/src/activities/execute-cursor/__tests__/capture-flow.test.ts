/**
 * @regression file-hitl-phase0 — pins file-edit HITL fixes #7, #8, #9 (see _projects/2026-06/20260630.01.file-change-hitl-redesign/tasks/T01_3_regression-manifest.md)
 *
 * Tests for capture-mode turn orchestration against the file_review LEDGER (the
 * Cursor cutover): the turn-start baseline event, the turn-end candidate event
 * (streamed edits hidden, tree LEFT applied for Cursor-parity review), and the
 * resume reconcile (decisions read from a DECIDED FileChangeSet projection,
 * approved kept / rejected reverted, hash-verified, RECONCILED authored). Runs
 * against a REAL temp git repo with in-memory transcript + status protos.
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clone, create } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  FileDecisionSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
  FileReviewEventType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  applyCaptureDecisions,
  captureBaselineToLedger,
  captureTurnToLedger,
} from "../capture-flow.js";

const execFileAsync = promisify(execFile);
const EXEC_ID = "exec-capflow-1";
const CHANGE_SET_ID = `${EXEC_ID}:0`;

let repo: string;

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repo });
  return stdout;
}
async function read(rel: string): Promise<string> {
  return readFile(join(repo, rel), "utf-8");
}
async function write(rel: string, content: string): Promise<void> {
  await mkdir(join(repo, rel, ".."), { recursive: true });
  await writeFile(join(repo, rel), content, "utf-8");
}
async function exists(rel: string): Promise<boolean> {
  try {
    await stat(join(repo, rel));
    return true;
  } catch {
    return false;
  }
}

function newStatus(): AgentExecutionStatus {
  return create(AgentExecutionStatusSchema, {});
}

/** A streamed (COMPLETED) file-edit tool call, as the SDK would have recorded. */
function streamedEdit(id: string, path: string, content: string): AgentMessage {
  return create(AgentMessageSchema, {
    type: 1, // MESSAGE_AI
    toolCalls: [
      create(ToolCallSchema, {
        id,
        name: "edit",
        status: ToolCallStatus.TOOL_CALL_COMPLETED,
        args: { path, content },
      }),
    ],
  });
}

/** Events of a given type on the status's file_review ledger. */
function eventsOfType(status: AgentExecutionStatus, type: FileReviewEventType) {
  return (status.fileReviewEventStream?.events ?? []).filter((e) => e.eventType === type);
}

/** The CapturedFileChange list carried on the CANDIDATE_CAPTURED event. */
function candidateChanges(status: AgentExecutionStatus): CapturedFileChange[] {
  const ev = eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED)[0];
  return ev?.payload.case === "candidateCaptured" ? ev.payload.value.changes : [];
}

/**
 * Build the DECIDED FileChangeSet projection the server would compute, from the
 * authored candidate changes plus a set of per-file decisions. `tamper` lets a
 * test corrupt a change's after_sha256 to exercise the hash-mismatch gate.
 */
function decidedChangeSet(
  status: AgentExecutionStatus,
  decisionByPath: Record<string, FileDecisionAction>,
  tamper?: (changes: CapturedFileChange[]) => void,
) {
  const changes = candidateChanges(status).map((c) => clone(CapturedFileChangeSchema, c));
  if (tamper) tamper(changes);
  const decisions = changes
    .filter((c) => decisionByPath[c.pathAfter || c.pathBefore] !== undefined)
    .map((c) =>
      create(FileDecisionSchema, {
        id: `${c.id}:d`,
        changeSetId: CHANGE_SET_ID,
        scope: FileDecisionScope.FILE,
        fileChangeId: c.id,
        action: decisionByPath[c.pathAfter || c.pathBefore],
        expectedDigest: c.fileDigest,
      }),
    );
  return create(FileChangeSetSchema, {
    id: CHANGE_SET_ID,
    changes,
    decisions,
    status: FileChangeSetStatus.DECIDED,
  });
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "stigmer-capflow-"));
  await git(["init", "-q"]);
  await git(["config", "user.email", "t@t.local"]);
  await git(["config", "user.name", "t"]);
  await write("notes.md", "platon notes\n");
  await write("src/main.ts", "export const x = 1;\n");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "initial"]);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("captureTurnToLedger (producer)", () => {
  it("authors BASELINE + CANDIDATE, keeps edits applied, hides streamed rows", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
    });

    // BASELINE_CAPTURED authored at turn start (the projection reads turn_id /
    // harness_id ONLY from this payload, so they are load-bearing).
    const baselineEvents = eventsOfType(status, FileReviewEventType.BASELINE_CAPTURED);
    expect(baselineEvents).toHaveLength(1);
    expect(baselineEvents[0].actor).toBe("runner");
    const basePayload = baselineEvents[0].payload;
    expect(basePayload.case).toBe("baselineCaptured");
    if (basePayload.case === "baselineCaptured") {
      expect(basePayload.value.changeSetId).toBe(CHANGE_SET_ID);
      expect(basePayload.value.turnId).toBe(CHANGE_SET_ID);
      expect(basePayload.value.harnessId).toBe("cursor");
      expect(basePayload.value.baselineSnapshot?.git?.ref).toBe(
        `refs/stigmer/baseline/${EXEC_ID}`,
      );
    }

    // The agent's edits flowed to disk during the turn.
    await write("notes.md", "planton notes\n\n## TODO\n- ship\n");
    await write("src/new.ts", "export const y = 2;\n");
    const messages: AgentMessage[] = [
      streamedEdit("tc-1", "notes.md", "planton notes\n\n## TODO\n- ship\n"),
      streamedEdit("tc-2", "src/new.ts", "export const y = 2;\n"),
    ];

    const changes = await captureTurnToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
      baselineTree: baseline,
      messages,
      deniedTokens: new Set(),
    });

    expect(changes).toHaveLength(2);

    // Cursor parity: the agent's edits stay applied on disk for review.
    expect(await read("notes.md")).toBe("planton notes\n\n## TODO\n- ship\n");
    expect(await exists("src/new.ts")).toBe(true);

    // The streamed edit rows are hidden (collapsed SKIPPED, no fileChanges): the
    // ledger is the single review surface.
    for (const tc of messages.flatMap((m) => m.toolCalls)) {
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
      expect(tc.fileChanges).toHaveLength(0);
    }

    // CANDIDATE_CAPTURED authored with one change per file + the byte-exact
    // after content, and a non-empty aggregate digest.
    const candidateEvents = eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED);
    expect(candidateEvents).toHaveLength(1);
    expect(candidateEvents[0].actor).toBe("runner");
    const cand = candidateChanges(status);
    expect(cand.map((c) => c.pathAfter).sort()).toEqual(["notes.md", "src/new.ts"]);
    const notesChange = cand.find((c) => c.pathAfter === "notes.md")!;
    expect(notesChange.id).toBe(`${CHANGE_SET_ID}:notes.md`);
    expect(notesChange.after?.body.value).toBe("planton notes\n\n## TODO\n- ship\n");
    expect(notesChange.afterSha256.length).toBeGreaterThan(0);
  });

  it("authors no candidate when the turn changed nothing", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
    });
    const changes = await captureTurnToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
      baselineTree: baseline,
      messages: [],
      deniedTokens: new Set(),
    });
    expect(changes).toHaveLength(0);
    expect(eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED)).toHaveLength(0);
  });
});

describe("applyCaptureDecisions (resume)", () => {
  async function captureTwoFileTurn(status: AgentExecutionStatus) {
    const baseline = await captureBaselineToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
    });
    await write("notes.md", "planton notes\n");
    await write("src/main.ts", "export const x = 99;\n");
    const messages: AgentMessage[] = [
      streamedEdit("tc-1", "notes.md", "planton notes\n"),
      streamedEdit("tc-2", "src/main.ts", "export const x = 99;\n"),
    ];
    await captureTurnToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
      baselineTree: baseline,
      messages,
      deniedTokens: new Set(),
    });
  }

  it("applies the approved file, discards the rejected one, authors RECONCILED, drops refs", async () => {
    const status = newStatus();
    await captureTwoFileTurn(status);

    // Both edits remain applied on disk during review (pre-decision).
    expect(await read("notes.md")).toBe("planton notes\n");
    expect(await read("src/main.ts")).toBe("export const x = 99;\n");

    const changeSet = decidedChangeSet(status, {
      "notes.md": FileDecisionAction.APPROVE,
      "src/main.ts": FileDecisionAction.REJECT,
    });

    const result = await applyCaptureDecisions({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSet,
    });

    expect(result.isCaptureTurn).toBe(true);
    expect(result.failed).toBe(false);
    expect(result.approvedPaths).toEqual(["notes.md"]);
    expect(result.rejectedPaths).toEqual(["src/main.ts"]);
    expect(result.hadReject).toBe(true);

    // Approved file applied (uncommitted); rejected file at baseline.
    expect(await read("notes.md")).toBe("planton notes\n");
    expect(await read("src/main.ts")).toBe("export const x = 1;\n");

    // Approved file uncommitted (HEAD unchanged — the harness never commits).
    expect((await git(["log", "--oneline"])).trim().split("\n")).toHaveLength(1);

    // RECONCILED authored with an approved snapshot; refs released.
    const reconciled = eventsOfType(status, FileReviewEventType.RECONCILED);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].actor).toBe("runner");
    if (reconciled[0].payload.case === "reconciled") {
      expect(reconciled[0].payload.value.approvedSnapshot?.git?.ref).toBe(
        `refs/stigmer/approved/${EXEC_ID}`,
      );
    }
    expect((await git(["for-each-ref", "refs/stigmer/"])).trim()).toBe("");
  });

  it("reconstructs an approved file from the ref even if the tree was reset (retry-safe)", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
    });
    await write("notes.md", "planton notes\n");
    await captureTurnToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
      baselineTree: baseline,
      messages: [streamedEdit("tc-1", "notes.md", "planton notes\n")],
      deniedTokens: new Set(),
    });

    const changeSet = decidedChangeSet(status, { "notes.md": FileDecisionAction.APPROVE });

    // Simulate a tree reset before resume (Temporal retry / sandbox recycle):
    // the approved bytes are gone from disk, but the pinned refs survive.
    await write("notes.md", "platon notes\n");

    const result = await applyCaptureDecisions({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSet,
    });

    expect(result.approvedPaths).toEqual(["notes.md"]);
    // Reconcile-from-refs re-asserts the approved "after" bytes regardless of the
    // tree's current contents.
    expect(await read("notes.md")).toBe("planton notes\n");
  });

  it("CHANGE_SET-scoped approval covers all files; a FILE decision overrides it (most-specific-wins)", async () => {
    const status = newStatus();
    await captureTwoFileTurn(status);

    const changes = candidateChanges(status);
    const mainChange = changes.find((c) => c.pathAfter === "src/main.ts")!;
    const changeSet = create(FileChangeSetSchema, {
      id: CHANGE_SET_ID,
      changes,
      status: FileChangeSetStatus.DECIDED,
      decisions: [
        // CHANGE_SET: approve everything…
        create(FileDecisionSchema, {
          id: "d-cs",
          changeSetId: CHANGE_SET_ID,
          scope: FileDecisionScope.CHANGE_SET,
          action: FileDecisionAction.APPROVE,
        }),
        // …but a FILE decision rejects src/main.ts (more specific wins).
        create(FileDecisionSchema, {
          id: "d-file",
          changeSetId: CHANGE_SET_ID,
          scope: FileDecisionScope.FILE,
          fileChangeId: mainChange.id,
          action: FileDecisionAction.REJECT,
          expectedDigest: mainChange.fileDigest,
        }),
      ],
    });

    const result = await applyCaptureDecisions({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSet,
    });

    expect(result.approvedPaths).toEqual(["notes.md"]);
    expect(result.rejectedPaths).toEqual(["src/main.ts"]);
    expect(await read("notes.md")).toBe("planton notes\n");
    expect(await read("src/main.ts")).toBe("export const x = 1;\n");
  });

  it("refuses to apply and authors FAILED(HASH_MISMATCH) when on-disk bytes diverge from the approved digest", async () => {
    const status = newStatus();
    await captureTwoFileTurn(status);

    // The reviewer approved both, but the recorded after_sha256 for notes.md no
    // longer matches the captured bytes (what-you-approve-is-what-applies fails).
    const changeSet = decidedChangeSet(
      status,
      { "notes.md": FileDecisionAction.APPROVE, "src/main.ts": FileDecisionAction.APPROVE },
      (changes) => {
        const notes = changes.find((c) => c.pathAfter === "notes.md")!;
        notes.afterSha256 = "deadbeef".repeat(8); // 64-hex, but wrong
      },
    );

    const result = await applyCaptureDecisions({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSet,
    });

    expect(result.failed).toBe(true);
    expect(result.failureDetail).toContain("notes.md");

    // NOTHING was applied (a partial apply under verification failure is worse
    // than none): src/main.ts still holds its un-reconciled (after) bytes.
    expect(await read("src/main.ts")).toBe("export const x = 99;\n");

    const failed = eventsOfType(status, FileReviewEventType.FAILED);
    expect(failed).toHaveLength(1);
    if (failed[0].payload.case === "failed") {
      expect(failed[0].payload.value.detail).toContain("notes.md");
    }
    // No RECONCILED on a failed verify.
    expect(eventsOfType(status, FileReviewEventType.RECONCILED)).toHaveLength(0);
  });

  it("returns isCaptureTurn=false when there is no capture ref (non-capture resume)", async () => {
    const status = newStatus();
    const changeSet = create(FileChangeSetSchema, {
      id: "never-captured:0",
      status: FileChangeSetStatus.DECIDED,
    });
    const result = await applyCaptureDecisions({
      status,
      gitRoot: repo,
      executionId: "never-captured",
      changeSet,
    });
    expect(result.isCaptureTurn).toBe(false);
  });
});
