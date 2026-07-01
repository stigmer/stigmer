/**
 * @regression file-hitl-phase0 — pins file-edit HITL fixes #7, #8, #9 (see _projects/2026-06/20260630.01.file-change-hitl-redesign/tasks/T01_3_regression-manifest.md)
 *
 * Tests the harness-agnostic capture orchestration directly with the deep-agent
 * harness id (the Cursor adapter is covered by execute-cursor/capture-flow.test).
 * Confirms producer parity: the deep-agent authors IDENTICAL ledger entries to
 * Cursor through this seam — only `harness_id` differs — and that with no
 * excludePaths every changed file is captured. Runs against a REAL temp git repo.
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clone, create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  FileDecisionSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  DiffCompleteness,
  FileCaptureClass,
  FileChangeKind,
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
  FileReviewBlockReason,
  FileReviewEventType,
  SnapshotKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ArtifactStorage } from "../../artifact-storage.js";
import { makeInMemoryArtifactStorage } from "../../../__test-utils__/fake-artifact-storage.js";
import {
  applyCaptureDecisions,
  captureBaselineToLedger,
  captureCandidateToLedger,
} from "../capture.js";

const execFileAsync = promisify(execFile);
const EXEC_ID = "exec-da-1";
const CHANGE_SET_ID = `${EXEC_ID}:0`;
const HARNESS = "deep-agent";

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

function newStatus(): AgentExecutionStatus {
  return create(AgentExecutionStatusSchema, {});
}
function eventsOfType(status: AgentExecutionStatus, type: FileReviewEventType) {
  return (status.fileReviewEventStream?.events ?? []).filter((e) => e.eventType === type);
}
function candidateChanges(status: AgentExecutionStatus): CapturedFileChange[] {
  const ev = eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED)[0];
  return ev?.payload.case === "candidateCaptured" ? ev.payload.value.changes : [];
}
function decidedChangeSet(
  status: AgentExecutionStatus,
  decisionByPath: Record<string, FileDecisionAction>,
) {
  const changes = candidateChanges(status).map((c) => clone(CapturedFileChangeSchema, c));
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
  repo = await mkdtemp(join(tmpdir(), "stigmer-da-capture-"));
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

describe("capture orchestration — deep-agent harness", () => {
  it("stamps harness_id=deep-agent on BASELINE and authors CANDIDATE with the captured changes", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
      harnessId: HARNESS,
    });

    const baselineEvents = eventsOfType(status, FileReviewEventType.BASELINE_CAPTURED);
    expect(baselineEvents).toHaveLength(1);
    expect(baselineEvents[0].actor).toBe("runner");
    const basePayload = baselineEvents[0].payload;
    expect(basePayload.case).toBe("baselineCaptured");
    if (basePayload.case === "baselineCaptured") {
      // The projection reads turn_id / harness_id ONLY from this payload.
      expect(basePayload.value.changeSetId).toBe(CHANGE_SET_ID);
      expect(basePayload.value.turnId).toBe(CHANGE_SET_ID);
      expect(basePayload.value.harnessId).toBe(HARNESS);
    }

    await write("notes.md", "planton notes\n");
    await write("src/new.ts", "export const y = 2;\n");

    const changes = await captureCandidateToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
      baselineTree: baseline,
      harnessId: HARNESS,
    });

    expect(changes).toHaveLength(2);
    const cand = candidateChanges(status);
    expect(cand.map((c) => c.pathAfter).sort()).toEqual(["notes.md", "src/new.ts"]);
    expect(cand.find((c) => c.pathAfter === "notes.md")!.id).toBe(`${CHANGE_SET_ID}:notes.md`);
  });

  it("reconciles approve/reject on resume and authors RECONCILED with harness parity", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await write("notes.md", "planton notes\n");
    await write("src/main.ts", "export const x = 99;\n");
    await captureCandidateToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS,
    });

    const changeSet = decidedChangeSet(status, {
      "notes.md": FileDecisionAction.APPROVE,
      "src/main.ts": FileDecisionAction.REJECT,
    });

    const result = await applyCaptureDecisions({
      status, gitRoot: repo, executionId: EXEC_ID, changeSet, harnessId: HARNESS,
    });

    expect(result.isCaptureTurn).toBe(true);
    expect(result.failed).toBe(false);
    expect(result.approvedPaths).toEqual(["notes.md"]);
    expect(result.rejectedPaths).toEqual(["src/main.ts"]);

    // Approved kept; rejected snapped back to baseline; nothing committed.
    expect(await read("notes.md")).toBe("planton notes\n");
    expect(await read("src/main.ts")).toBe("export const x = 1;\n");
    expect((await git(["log", "--oneline"])).trim().split("\n")).toHaveLength(1);

    const reconciled = eventsOfType(status, FileReviewEventType.RECONCILED);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].actor).toBe("runner");
    expect((await git(["for-each-ref", "refs/stigmer/"])).trim()).toBe("");
  });
});

// In-memory artifact store for the CAS composition tests — the canonical double.
function makeStorage(): ArtifactStorage & { blobs: Map<string, Buffer> } {
  const { storage, blobs } = makeInMemoryArtifactStorage();
  return Object.assign(storage, { blobs });
}

function candidateSnapshotKind(status: AgentExecutionStatus): SnapshotKind | undefined {
  const ev = eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED)[0];
  return ev?.payload.case === "candidateCaptured"
    ? ev.payload.value.candidateSnapshot?.kind
    : undefined;
}
function candidateCompleteness(status: AgentExecutionStatus): DiffCompleteness | undefined {
  const ev = eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED)[0];
  return ev?.payload.case === "candidateCaptured"
    ? ev.payload.value.diffCompleteness
    : undefined;
}

describe("capture orchestration — hybrid git + CAS (Phase 3)", () => {
  it("composes git-tracked and CAS captures into one HYBRID change set", async () => {
    const status = newStatus();
    const storage = makeStorage();
    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });

    // A git-tracked edit AND an ignored file the harness captured out-of-band.
    await write("notes.md", "planton notes\n");
    const gitChanges = await captureCandidateToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, storage,
      casCaptures: [
        { path: ".env", before: null, after: new TextEncoder().encode("SECRET=2"), captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED },
      ],
    });

    // The return is still the git-tracked changes (adapter presentation concern).
    expect(gitChanges.map((c) => c.path)).toEqual(["notes.md"]);

    const cand = candidateChanges(status);
    const byPath = new Map(cand.map((c) => [c.pathAfter || c.pathBefore, c]));
    expect([...byPath.keys()].sort()).toEqual([".env", "notes.md"]);

    // The git file is inline; the CAS file is a blob ref (stored once, not inlined).
    const gitFile = byPath.get("notes.md")!;
    expect(gitFile.captureClass).toBe(FileCaptureClass.GIT_TRACKED);
    expect(gitFile.after?.body.case).toBe("inline");

    const casFile = byPath.get(".env")!;
    expect(casFile.captureClass).toBe(FileCaptureClass.GIT_IGNORED_CAPTURED);
    expect(casFile.kind).toBe(FileChangeKind.ADD);
    expect(casFile.after?.body.case).toBe("ref");
    // The referenced blob physically exists in the store.
    if (casFile.after?.body.case === "ref") {
      expect(storage.blobs.has(casFile.after.body.value.storageKey)).toBe(true);
    }

    // The snapshot spans both substrates; the aggregate digest folds both files.
    expect(candidateSnapshotKind(status)).toBe(SnapshotKind.HYBRID);
    const ev = eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED)[0];
    if (ev.payload.case === "candidateCaptured") {
      expect(ev.payload.value.aggregateDigest).not.toBe("");
    }
  });

  it("stays git-only (no CAS) when no ignored paths are captured", async () => {
    const status = newStatus();
    const storage = makeStorage();
    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await write("notes.md", "planton notes\n");
    await captureCandidateToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, storage, casCaptures: [],
    });
    expect(candidateSnapshotKind(status)).toBe(SnapshotKind.GIT_TREE_REF);
    expect(storage.blobs.size).toBe(0);
  });

  it("marks the change set PARTIAL_BLOCKED when a CAS file is binary", async () => {
    const status = newStatus();
    const storage = makeStorage();
    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await captureCandidateToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, storage,
      casCaptures: [
        { path: "cache.bin", before: null, after: new Uint8Array([1, 0, 2]), captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED },
      ],
    });
    const cand = candidateChanges(status);
    expect(cand[0].diffComplete).toBe(false);
    // Binary is conveyed by FileContent.is_binary, not blocked_reason (doc 15).
    expect(cand[0].blockedReason).toBe(FileReviewBlockReason.UNSPECIFIED);
    expect(candidateCompleteness(status)).toBe(DiffCompleteness.PARTIAL_BLOCKED);
  });

  it("reconciles hybrid decisions on resume: approved CAS kept, rejected CAS reverted", async () => {
    const status = newStatus();
    const storage = makeStorage();
    const readBlob = async (key: string): Promise<Buffer> => {
      const b = storage.blobs.get(key);
      if (!b) throw new Error(`missing ${key}`);
      return b;
    };
    const enc = (s: string) => new TextEncoder().encode(s);

    // Ignore dist/ and build/ so git does not also capture these paths.
    await write(".gitignore", "dist/\nbuild/\n");
    await git(["add", ".gitignore"]);
    await git(["commit", "-q", "-m", "ignore"]);

    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });

    // Apply the turn's edits to disk (the "after" state the review window shows).
    await write("notes.md", "planton\n"); // git-tracked
    await write("dist/out.txt", "X"); // ignored ADD
    await write("build/cache.txt", "NEW"); // ignored MODIFY (baseline was OLD)

    await captureCandidateToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, storage,
      casCaptures: [
        { path: "dist/out.txt", before: null, after: enc("X"), captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED },
        { path: "build/cache.txt", before: enc("OLD"), after: enc("NEW"), captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED },
      ],
    });

    const changeSet = decidedChangeSet(status, {
      "notes.md": FileDecisionAction.APPROVE,
      "dist/out.txt": FileDecisionAction.APPROVE,
      "build/cache.txt": FileDecisionAction.REJECT,
    });

    const result = await applyCaptureDecisions({
      status, gitRoot: repo, executionId: EXEC_ID, changeSet, harnessId: HARNESS,
      storage, readBlob,
    });

    expect(result.failed).toBe(false);
    expect(result.approvedPaths.sort()).toEqual(["dist/out.txt", "notes.md"]);
    expect(result.rejectedPaths).toEqual(["build/cache.txt"]);

    // Approved git + approved CAS kept; rejected CAS reverted to baseline bytes.
    expect(await read("notes.md")).toBe("planton\n");
    expect(await read("dist/out.txt")).toBe("X");
    expect(await read("build/cache.txt")).toBe("OLD");
  });

  it("throws if CAS captures are supplied without a storage backend", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await expect(
      captureCandidateToLedger({
        status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
        baselineTree: baseline, harnessId: HARNESS,
        casCaptures: [
          { path: ".env", before: null, after: new TextEncoder().encode("X=1"), captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED },
        ],
      }),
    ).rejects.toThrow(/requires an ArtifactStorage/);
  });
});

describe("capture orchestration — secret-blocked DIFF_UNREVIEWABLE (DD-E)", () => {
  it("authors a content-less DIFF_UNREVIEWABLE entry that blocks approval and persists nothing", async () => {
    const status = newStatus();
    const storage = makeStorage();
    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });

    await write("notes.md", "planton\n"); // a real git change alongside the block

    await captureCandidateToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, storage,
      unreviewablePaths: [".env"],
    });

    const byPath = new Map(candidateChanges(status).map((c) => [c.pathAfter || c.pathBefore, c]));
    expect([...byPath.keys()].sort()).toEqual([".env", "notes.md"]);

    const secret = byPath.get(".env")!;
    expect(secret.captureClass).toBe(FileCaptureClass.GIT_IGNORED_CAPTURED);
    expect(secret.diffComplete).toBe(false);
    // The honest cause is recorded so the UI can say *why* (doc 15), while the
    // real git change beside it stays fully reviewable (UNSPECIFIED).
    expect(secret.blockedReason).toBe(FileReviewBlockReason.SECRET_WITHHELD);
    expect(byPath.get("notes.md")!.blockedReason).toBe(FileReviewBlockReason.UNSPECIFIED);
    // No content and no enforcement digests: the bytes are never captured.
    expect(secret.before).toBeUndefined();
    expect(secret.after).toBeUndefined();
    expect(secret.beforeSha256).toBe("");
    expect(secret.afterSha256).toBe("");

    // One incomplete file forces the whole set PARTIAL_BLOCKED (approval blocked).
    expect(candidateCompleteness(status)).toBe(DiffCompleteness.PARTIAL_BLOCKED);
    // Nothing was persisted to storage for the blocked path.
    expect(storage.blobs.size).toBe(0);
  });

  it("authors a CANDIDATE for an unreviewable-only turn (no git or CAS change)", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });

    // The only thing that "happened" is a blocked secret write attempt.
    await captureCandidateToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS,
      unreviewablePaths: [".env"],
    });

    expect(eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED)).toHaveLength(1);
    expect(candidateChanges(status).map((c) => c.pathAfter)).toEqual([".env"]);
    expect(candidateCompleteness(status)).toBe(DiffCompleteness.PARTIAL_BLOCKED);
  });
});
