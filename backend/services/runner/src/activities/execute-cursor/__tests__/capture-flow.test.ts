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

import { execFile, execFileSync } from "node:child_process";
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
  FileCaptureClass,
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
  FileReviewBlockReason,
  FileReviewEventType,
  SnapshotKind,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  applyCaptureDecisions,
  captureBaselineToLedger,
  captureTurnToLedger,
} from "../capture-flow.js";
import { buildObservationStagingScript, casObservationsDir } from "../cas-observations.js";
import { makeInMemoryArtifactStorage } from "../../../__test-utils__/fake-artifact-storage.js";

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

// The Cursor CAS half (DD-18): the hook stages gitignored writes into the
// cas-observations sidecar; captureTurnToLedger composes them with the git diff
// into ONE hybrid change set, and applyCaptureDecisions reconciles the CAS files
// from the durable manifest. Exercised with the REAL staging script + a real git
// repo + an in-memory artifact store — the deterministic stand-in for the live
// (CURSOR_API_KEY) end-to-end test.
describe("hybrid capture (git-tracked + gitignored CAS)", () => {
  let hitl: string;

  /** Run the real staging script exactly as the hook does (salient on stdin). */
  function stage(wsRoot: string, salient: string): void {
    execFileSync(process.execPath, ["-e", buildObservationStagingScript(), wsRoot, casObservationsDir(hitl)], {
      input: salient,
    });
  }

  beforeEach(async () => {
    hitl = await mkdtemp(join(tmpdir(), "stigmer-capflow-hitl-"));
    // Commit a .gitignore so the git half ignores *.log / .env (only CAS sees
    // them) — otherwise they would double-capture as untracked git changes.
    await write(".gitignore", "*.log\n.env\n");
    await git(["add", ".gitignore"]);
    await git(["commit", "-q", "-m", "gitignore"]);
  });

  afterEach(async () => {
    await rm(hitl, { recursive: true, force: true });
  });

  it("composes one hybrid change set: git-tracked + GIT_IGNORED_CAPTURED + secret DIFF_UNREVIEWABLE", async () => {
    const status = newStatus();
    const { storage, blobs } = makeInMemoryArtifactStorage();

    const baseline = await captureBaselineToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
    });

    // A gitignored MODIFY: seed the pre-turn bytes, stage (records before), then
    // let the write apply (the runner re-reads after at the boundary).
    await write("build/out.log", "BEFORE");
    stage(repo, "build/out.log");
    await write("build/out.log", "AFTER");
    // A secret-like gitignored write: hard-blocked by the hook -> a secret marker.
    stage(repo, ".env");
    // A git-tracked edit rides the same turn.
    await write("notes.md", "changed\n");

    const changes = await captureTurnToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
      baselineTree: baseline,
      messages: [streamedEdit("tc-1", "notes.md", "changed\n")],
      deniedTokens: new Set(),
      hitlDir: hitl,
      storage,
    });

    // captureTurnToLedger returns only the git-tracked changes.
    expect(changes.map((c) => c.path)).toEqual(["notes.md"]);

    const cand = candidateChanges(status);
    const byPath = new Map(cand.map((c) => [c.pathAfter || c.pathBefore, c]));
    expect([...byPath.keys()].sort()).toEqual([".env", "build/out.log", "notes.md"]);

    // Git-tracked file.
    expect(byPath.get("notes.md")!.captureClass).toBe(FileCaptureClass.GIT_TRACKED);

    // The gitignored file is a CAS capture (blob-ref body), byte-exact after.
    const log = byPath.get("build/out.log")!;
    expect(log.captureClass).toBe(FileCaptureClass.GIT_IGNORED_CAPTURED);
    expect(log.after?.body.case).toBe("ref");
    expect(blobs.size).toBeGreaterThan(0); // before + after blobs persisted

    // The secret is surfaced honestly as content-less DIFF_UNREVIEWABLE.
    const env = byPath.get(".env")!;
    expect(env.blockedReason).toBe(FileReviewBlockReason.SECRET_WITHHELD);
    expect(env.diffComplete).toBe(false);
    expect(env.after).toBeUndefined();
  });

  it("reconciles an APPROVED gitignored file (kept byte-exact) via the CAS manifest", async () => {
    const status = newStatus();
    const { storage } = makeInMemoryArtifactStorage();
    const baseline = await captureBaselineToLedger({ status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID });

    await write("build/out.log", "BEFORE");
    stage(repo, "build/out.log");
    await write("build/out.log", "AFTER");
    await write("notes.md", "changed\n");

    await captureTurnToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline,
      messages: [streamedEdit("tc-1", "notes.md", "changed\n")],
      deniedTokens: new Set(), hitlDir: hitl, storage,
    });

    const changeSet = decidedChangeSet(status, {
      "notes.md": FileDecisionAction.APPROVE,
      "build/out.log": FileDecisionAction.APPROVE,
    });
    const result = await applyCaptureDecisions({
      status, gitRoot: repo, executionId: EXEC_ID, changeSet, storage,
    });

    expect(result.isCaptureTurn).toBe(true);
    expect(result.failed).toBe(false);
    expect([...result.approvedPaths].sort()).toEqual(["build/out.log", "notes.md"]);
    expect(await read("build/out.log")).toBe("AFTER");
    expect(await read("notes.md")).toBe("changed\n");
  });

  it("reconciles a REJECTED gitignored file by snapping it back to the pre-turn bytes", async () => {
    const status = newStatus();
    const { storage } = makeInMemoryArtifactStorage();
    const baseline = await captureBaselineToLedger({ status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID });

    await write("build/out.log", "BEFORE");
    stage(repo, "build/out.log");
    await write("build/out.log", "AFTER");

    await captureTurnToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline,
      messages: [],
      deniedTokens: new Set(), hitlDir: hitl, storage,
    });

    const changeSet = decidedChangeSet(status, { "build/out.log": FileDecisionAction.REJECT });
    const result = await applyCaptureDecisions({
      status, gitRoot: repo, executionId: EXEC_ID, changeSet, storage,
    });

    expect(result.hadReject).toBe(true);
    expect(result.rejectedPaths).toEqual(["build/out.log"]);
    // Snapped back byte-exact to the pre-turn content the hook staged.
    expect(await read("build/out.log")).toBe("BEFORE");
  });
});

// Slice 2c: a NON-git Cursor workspace has no git snapshot, so the whole change
// set is CAS (every touched path), classed NON_GIT_CAS, with a CAS_MANIFEST
// baseline/candidate/reconcile. Exercised with the REAL staging script + a plain
// (non-git) temp dir + an in-memory artifact store.
describe("non-git workspace CAS-only capture (Slice 2c)", () => {
  let ws: string;
  let hitl: string;

  /** Run the real staging script exactly as the hook does (salient on stdin). */
  function stage(salient: string): void {
    execFileSync(process.execPath, ["-e", buildObservationStagingScript(), ws, casObservationsDir(hitl)], {
      input: salient,
    });
  }
  async function wsRead(rel: string): Promise<string> {
    return readFile(join(ws, rel), "utf-8");
  }
  async function wsWrite(rel: string, content: string): Promise<void> {
    await mkdir(join(ws, rel, ".."), { recursive: true });
    await writeFile(join(ws, rel), content, "utf-8");
  }

  beforeEach(async () => {
    // A plain directory — deliberately NOT a git repo.
    ws = await mkdtemp(join(tmpdir(), "stigmer-capflow-nongit-"));
    hitl = await mkdtemp(join(tmpdir(), "stigmer-capflow-nongit-hitl-"));
  });
  afterEach(async () => {
    await rm(ws, { recursive: true, force: true });
    await rm(hitl, { recursive: true, force: true });
  });

  it("authors a CAS_MANIFEST baseline + NON_GIT_CAS candidate and reconciles approve/reject", async () => {
    const status = newStatus();
    const { storage } = makeInMemoryArtifactStorage();

    const baseline = await captureBaselineToLedger({
      status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, gitWorkspace: false,
    });
    // No git tree to pin in a non-git workspace.
    expect(baseline).toBe("");

    // Two edits this turn: a MODIFY (before staged first) and an ADD.
    await wsWrite("keep.txt", "OLD");
    stage("keep.txt");
    await wsWrite("keep.txt", "NEW");
    stage("created.txt");
    await wsWrite("created.txt", "X");

    const changes = await captureTurnToLedger({
      status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, messages: [], deniedTokens: new Set(),
      hitlDir: hitl, storage, gitWorkspace: false,
    });
    // No git-tracked changes exist in a non-git workspace — the set is CAS-only.
    expect(changes).toHaveLength(0);

    const cand = candidateChanges(status);
    const byPath = new Map(cand.map((c) => [c.pathAfter || c.pathBefore, c]));
    expect([...byPath.keys()].sort()).toEqual(["created.txt", "keep.txt"]);
    expect(byPath.get("keep.txt")!.captureClass).toBe(FileCaptureClass.NON_GIT_CAS);
    expect(byPath.get("created.txt")!.captureClass).toBe(FileCaptureClass.NON_GIT_CAS);

    const changeSet = decidedChangeSet(status, {
      "keep.txt": FileDecisionAction.APPROVE,
      "created.txt": FileDecisionAction.REJECT,
    });
    const result = await applyCaptureDecisions({
      status, gitRoot: ws, executionId: EXEC_ID, changeSet, storage, gitWorkspace: false,
    });

    expect(result.isCaptureTurn).toBe(true);
    expect(result.failed).toBe(false);
    expect(result.approvedPaths).toEqual(["keep.txt"]);
    expect(result.rejectedPaths).toEqual(["created.txt"]);
    // Approved kept at its "after" bytes; the rejected ADD is removed.
    expect(await wsRead("keep.txt")).toBe("NEW");
    await expect(readFile(join(ws, "created.txt"), "utf-8")).rejects.toThrow();

    // RECONCILED authored with a CAS_MANIFEST snapshot (no git tree to re-pin).
    const reconciled = eventsOfType(status, FileReviewEventType.RECONCILED);
    expect(reconciled).toHaveLength(1);
    if (reconciled[0].payload.case === "reconciled") {
      expect(reconciled[0].payload.value.approvedSnapshot?.kind).toBe(SnapshotKind.CAS_MANIFEST);
    }
  });

  it("labels a non-git secret-blocked path NON_GIT_CAS and blocks approval", async () => {
    const status = newStatus();
    const { storage } = makeInMemoryArtifactStorage();
    const baseline = await captureBaselineToLedger({
      status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, gitWorkspace: false,
    });

    await wsWrite("app.txt", "hi");
    stage("app.txt");
    stage(".env"); // secret-like -> a content-less marker only

    await captureTurnToLedger({
      status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, messages: [], deniedTokens: new Set(),
      hitlDir: hitl, storage, gitWorkspace: false,
    });

    const cand = candidateChanges(status);
    const env = cand.find((c) => (c.pathAfter || c.pathBefore) === ".env")!;
    expect(env.captureClass).toBe(FileCaptureClass.NON_GIT_CAS);
    expect(env.blockedReason).toBe(FileReviewBlockReason.SECRET_WITHHELD);
    expect(env.after).toBeUndefined();
  });

  it("is durable across a sandbox recycle: reconciles from the manifest after the tree is wiped", async () => {
    const status = newStatus();
    const { storage } = makeInMemoryArtifactStorage();
    const baseline = await captureBaselineToLedger({
      status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, gitWorkspace: false,
    });

    await wsWrite("keep.txt", "OLD");
    stage("keep.txt");
    await wsWrite("keep.txt", "NEW");

    await captureTurnToLedger({
      status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, messages: [], deniedTokens: new Set(),
      hitlDir: hitl, storage, gitWorkspace: false,
    });

    const changeSet = decidedChangeSet(status, { "keep.txt": FileDecisionAction.APPROVE });

    // Simulate a sandbox recycle before resume: the whole working tree is gone,
    // but the durable CAS manifest + blobs (artifact storage, a different
    // durability domain) survive. Reconcile must re-materialize the approved bytes
    // from them alone — never the live tree.
    await rm(ws, { recursive: true, force: true });
    await mkdir(ws, { recursive: true });

    const result = await applyCaptureDecisions({
      status, gitRoot: ws, executionId: EXEC_ID, changeSet, storage, gitWorkspace: false,
    });

    expect(result.isCaptureTurn).toBe(true);
    expect(result.failed).toBe(false);
    expect(result.approvedPaths).toEqual(["keep.txt"]);
    expect(await wsRead("keep.txt")).toBe("NEW");
  });
});
