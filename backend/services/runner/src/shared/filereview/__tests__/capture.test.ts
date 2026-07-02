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
import { casBlobReader } from "../cas-substrate.js";

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
  // Carry the candidate snapshot too (as the server projection does), so a CAS-only
  // reconcile can point RECONCILED back at the durable manifest. Git tests reconcile
  // from git refs and ignore it.
  const candEv = eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED)[0];
  const candidateSnapshot =
    candEv?.payload.case === "candidateCaptured" ? candEv.payload.value.candidateSnapshot : undefined;
  return create(FileChangeSetSchema, {
    id: CHANGE_SET_ID,
    changes,
    decisions,
    candidateSnapshot,
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

  it("git-only reconcile never probes storage for a CAS manifest, even when exists() lies (regression: proxy 404 crash)", async () => {
    // Regression for the file-review reconcile crash in cloud/desktop (proxy)
    // artifact mode. `ProxyArtifactStorage.exists()` reports true for ANY key
    // (the presign endpoint mints a URL regardless of object existence), so the
    // old reconcile "found" a CAS manifest that a git-only turn never wrote,
    // downloaded it, and died on the R2 `NoSuchKey` 404 (see the ExecuteCursor
    // crash in _cursor/error.md). The reconcile must decide "is this a CAS turn?"
    // from the change set's CANDIDATE snapshot — a git-only turn carries no cas
    // ref — so a lying `exists()` can no longer turn a git reconcile into a
    // doomed download.
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await write("notes.md", "planton notes\n");
    await captureCandidateToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS,
    });

    const changeSet = decidedChangeSet(status, { "notes.md": FileDecisionAction.APPROVE });
    // Precondition: this is a git-only turn — its candidate snapshot has no CAS ref.
    expect(changeSet.candidateSnapshot?.kind).toBe(SnapshotKind.GIT_TREE_REF);
    expect(changeSet.candidateSnapshot?.cas).toBeUndefined();

    // A storage that behaves like the proxy: `exists()` lies (true for every key)
    // and a download of the absent manifest fails (the R2 404 from error.md).
    const { storage } = makeInMemoryArtifactStorage();
    storage.exists.mockResolvedValue(true);

    const result = await applyCaptureDecisions({
      status, gitRoot: repo, executionId: EXEC_ID, changeSet, harnessId: HARNESS,
      storage, readBlob: casBlobReader(storage),
    });

    // Reconciles via git; the approved edit is kept and nothing crashed.
    expect(result.isCaptureTurn).toBe(true);
    expect(result.failed).toBe(false);
    expect(result.approvedPaths).toEqual(["notes.md"]);
    expect(await read("notes.md")).toBe("planton notes\n");
    // The proof: the git-only reconcile never asked storage for the CAS manifest.
    const manifestKey =
      `artifacts/${EXEC_ID}/filereview/cas/${CHANGE_SET_ID.replace(/[^A-Za-z0-9._-]/g, "_")}.manifest.json`;
    expect(storage.download).not.toHaveBeenCalledWith(manifestKey);
  });

  it("reconciles an APPROVED binary byte-exact — the digest gate accepts a byte-true binary", async () => {
    // A binary is captured incomplete (no text diff); Slice B lets a user
    // acknowledge-APPROVE it. This proves the runner half: the reconcile's digest
    // gate must ACCEPT the byte-true binary (never spuriously HASH_MISMATCH on a
    // body-less side) and re-apply the exact bytes from the git ref.
    const BIN = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x80, 0x01]);
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await mkdir(join(repo, "assets"), { recursive: true });
    await writeFile(join(repo, "assets/logo.png"), BIN); // binary create

    await captureCandidateToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS,
    });

    // Captured honestly: incomplete (binary), is_binary set, no inline body.
    const bin = candidateChanges(status).find((c) => c.pathAfter === "assets/logo.png")!;
    expect(bin.diffComplete).toBe(false);
    expect(bin.after?.isBinary).toBe(true);
    expect(bin.after?.body.case).toBeUndefined(); // body-less

    const changeSet = decidedChangeSet(status, {
      "assets/logo.png": FileDecisionAction.APPROVE,
    });
    // Remove from disk first to prove reconcile re-applies from the ref, not disk.
    await rm(join(repo, "assets/logo.png"), { force: true });

    const result = await applyCaptureDecisions({
      status, gitRoot: repo, executionId: EXEC_ID, changeSet, harnessId: HARNESS,
    });

    expect(result.failed).toBe(false);
    expect(result.approvedPaths).toEqual(["assets/logo.png"]);
    expect((await readFile(join(repo, "assets/logo.png"))).equals(BIN)).toBe(true);
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

  it("marks the change set BINARY_SUMMARY_ONLY when the only incomplete file is a binary CAS file", async () => {
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
    // Binary is the set's only blocker, so it is keepable in one acknowledged action.
    expect(candidateCompleteness(status)).toBe(DiffCompleteness.BINARY_SUMMARY_ONLY);
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
    expect([...result.approvedPaths].sort()).toEqual(["dist/out.txt", "notes.md"]);
    expect(result.rejectedPaths).toEqual(["build/cache.txt"]);

    // Approved git + approved CAS kept; rejected CAS reverted to baseline bytes.
    expect(await read("notes.md")).toBe("planton\n");
    expect(await read("dist/out.txt")).toBe("X");
    expect(await read("build/cache.txt")).toBe("OLD");
  });

  it("fails closed when the candidate snapshot records CAS files but no blob reader is provided", async () => {
    // The ledger says CAS files were captured; a caller that cannot read blobs
    // back must not silently skip them (their decisions would go unenforced).
    const status = newStatus();
    const storage = makeStorage();
    await write(".gitignore", "dist/\n");
    await git(["add", ".gitignore"]);
    await git(["commit", "-q", "-m", "ignore"]);
    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await write("dist/out.txt", "X");
    await captureCandidateToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, storage,
      casCaptures: [
        { path: "dist/out.txt", before: null, after: new TextEncoder().encode("X"), captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED },
      ],
    });
    const changeSet = decidedChangeSet(status, { "dist/out.txt": FileDecisionAction.APPROVE });

    await expect(
      applyCaptureDecisions({
        status, gitRoot: repo, executionId: EXEC_ID, changeSet, harnessId: HARNESS,
      }),
    ).rejects.toThrow(/captured CAS files .* but no blob reader was provided/);
  });

  it("fails closed on resume when the stored manifest no longer hashes to the ledger's manifestDigest", async () => {
    // The reconcile must verify the manifest it downloads against the digest the
    // CANDIDATE event pinned — per-blob content addresses protect blob bodies,
    // but only this check protects the path→blob mapping itself.
    const status = newStatus();
    const storage = makeStorage();
    const readBlob = async (key: string): Promise<Buffer> => {
      const b = storage.blobs.get(key);
      if (!b) throw new Error(`missing ${key}`);
      return b;
    };
    await write(".gitignore", "dist/\n");
    await git(["add", ".gitignore"]);
    await git(["commit", "-q", "-m", "ignore"]);
    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await write("dist/out.txt", "X");
    await captureCandidateToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, storage,
      casCaptures: [
        { path: "dist/out.txt", before: null, after: new TextEncoder().encode("X"), captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED },
      ],
    });
    const changeSet = decidedChangeSet(status, { "dist/out.txt": FileDecisionAction.APPROVE });

    // Tamper with the stored manifest between review and resume.
    const manifestUri = changeSet.candidateSnapshot!.cas!.artifactUri;
    const stored = storage.blobs.get(manifestUri)!;
    storage.blobs.set(manifestUri, Buffer.from(stored.toString("utf8").replace("dist/out.txt", "dist/evil.txt"), "utf8"));

    await expect(
      applyCaptureDecisions({
        status, gitRoot: repo, executionId: EXEC_ID, changeSet, harnessId: HARNESS,
        storage, readBlob,
      }),
    ).rejects.toThrow(/CAS manifest integrity check failed/);
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

// Slice 2a (DD-21 D2): the shared orchestration must capture and reconcile a
// NON-GIT workspace entirely from the CAS manifest — no git refs, no whole-tree
// snapshot, bounded to the paths the observer actually touched. These exercise
// capture.ts directly against a plain (non-git) temp dir; the harness wirings
// that flip `gitWorkspace=false` and observe all touched paths are slices 2b/2c.
function reconcilerReadBlob(storage: { blobs: Map<string, Buffer> }): (key: string) => Promise<Buffer> {
  return async (key: string): Promise<Buffer> => {
    const b = storage.blobs.get(key);
    if (!b) throw new Error(`missing ${key}`);
    return b;
  };
}

describe("capture orchestration — CAS-only non-git workspace (Slice 2a)", () => {
  let ws: string;
  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), "stigmer-nongit-"));
  });
  afterEach(async () => {
    await rm(ws, { recursive: true, force: true });
  });

  it("authors a CAS_MANIFEST baseline (returns \"\") + candidate with NON_GIT_CAS changes", async () => {
    const status = newStatus();
    const storage = makeStorage();

    const baseline = await captureBaselineToLedger({
      status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      harnessId: HARNESS, gitWorkspace: false,
    });
    // No git tree to pin — baseline is empty; the event still carries turn/harness
    // (the projection's only source) and a CAS-kind snapshot placeholder.
    expect(baseline).toBe("");
    const baseEv = eventsOfType(status, FileReviewEventType.BASELINE_CAPTURED)[0];
    expect(baseEv.payload.case).toBe("baselineCaptured");
    if (baseEv.payload.case === "baselineCaptured") {
      expect(baseEv.payload.value.harnessId).toBe(HARNESS);
      expect(baseEv.payload.value.turnId).toBe(CHANGE_SET_ID);
      expect(baseEv.payload.value.baselineSnapshot?.kind).toBe(SnapshotKind.CAS_MANIFEST);
    }

    await writeFile(join(ws, "app.log"), "new\n");
    await captureCandidateToLedger({
      status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, gitWorkspace: false, storage,
      casCaptures: [
        { path: "app.log", before: null, after: new TextEncoder().encode("new\n"), captureClass: FileCaptureClass.NON_GIT_CAS },
      ],
    });

    expect(candidateSnapshotKind(status)).toBe(SnapshotKind.CAS_MANIFEST);
    const cand = candidateChanges(status);
    expect(cand.map((c) => c.pathAfter)).toEqual(["app.log"]);
    expect(cand[0].captureClass).toBe(FileCaptureClass.NON_GIT_CAS);
    expect(cand[0].kind).toBe(FileChangeKind.ADD);
    // Bytes are offloaded to a content-addressed blob, never inlined.
    expect(cand[0].after?.body.case).toBe("ref");
    if (cand[0].after?.body.case === "ref") {
      expect(storage.blobs.has(cand[0].after.body.value.storageKey)).toBe(true);
    }
  });

  it("reconciles approve/reject from the manifest and authors a CAS_MANIFEST RECONCILED", async () => {
    const status = newStatus();
    const storage = makeStorage();
    const readBlob = reconcilerReadBlob(storage);
    const enc = (s: string) => new TextEncoder().encode(s);

    const baseline = await captureBaselineToLedger({
      status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      harnessId: HARNESS, gitWorkspace: false,
    });

    // The turn's edits are already on disk (the "after" state the review shows).
    await writeFile(join(ws, "created.txt"), "X");
    await writeFile(join(ws, "edited.txt"), "NEW");
    await captureCandidateToLedger({
      status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, gitWorkspace: false, storage,
      casCaptures: [
        { path: "created.txt", before: null, after: enc("X"), captureClass: FileCaptureClass.NON_GIT_CAS },
        { path: "edited.txt", before: enc("OLD"), after: enc("NEW"), captureClass: FileCaptureClass.NON_GIT_CAS },
      ],
    });

    const changeSet = decidedChangeSet(status, {
      "created.txt": FileDecisionAction.APPROVE,
      "edited.txt": FileDecisionAction.REJECT,
    });

    const result = await applyCaptureDecisions({
      status, gitRoot: ws, executionId: EXEC_ID, changeSet, harnessId: HARNESS,
      gitWorkspace: false, storage, readBlob,
    });

    expect(result.isCaptureTurn).toBe(true);
    expect(result.failed).toBe(false);
    expect(result.approvedPaths).toEqual(["created.txt"]);
    expect(result.rejectedPaths).toEqual(["edited.txt"]);

    // Approved kept at its "after" bytes; rejected snapped back to "before".
    expect(await readFile(join(ws, "created.txt"), "utf-8")).toBe("X");
    expect(await readFile(join(ws, "edited.txt"), "utf-8")).toBe("OLD");

    const reconciled = eventsOfType(status, FileReviewEventType.RECONCILED);
    expect(reconciled).toHaveLength(1);
    if (reconciled[0].payload.case === "reconciled") {
      const snap = reconciled[0].payload.value.approvedSnapshot;
      expect(snap?.kind).toBe(SnapshotKind.CAS_MANIFEST);
      // Points back at the durable candidate manifest (the reconciled state is
      // manifest + decisions; there is no tree to re-pin).
      expect(snap?.cas?.artifactUri).not.toBe("");
    }
  });

  it("a rejected ADD is removed; enforcement re-applies an approved file from the blob", async () => {
    const status = newStatus();
    const storage = makeStorage();
    const readBlob = reconcilerReadBlob(storage);
    const enc = (s: string) => new TextEncoder().encode(s);

    const baseline = await captureBaselineToLedger({
      status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      harnessId: HARNESS, gitWorkspace: false,
    });
    await writeFile(join(ws, "keep.txt"), "KEEP");
    await writeFile(join(ws, "drop.txt"), "DROP");
    await captureCandidateToLedger({
      status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, gitWorkspace: false, storage,
      casCaptures: [
        { path: "keep.txt", before: null, after: enc("KEEP"), captureClass: FileCaptureClass.NON_GIT_CAS },
        { path: "drop.txt", before: null, after: enc("DROP"), captureClass: FileCaptureClass.NON_GIT_CAS },
      ],
    });

    const changeSet = decidedChangeSet(status, {
      "keep.txt": FileDecisionAction.APPROVE,
      "drop.txt": FileDecisionAction.REJECT,
    });

    // Delete the approved file from disk first to prove reconcile re-applies it
    // from the durable blob, not the live tree.
    await rm(join(ws, "keep.txt"), { force: true });

    const result = await applyCaptureDecisions({
      status, gitRoot: ws, executionId: EXEC_ID, changeSet, harnessId: HARNESS,
      gitWorkspace: false, storage, readBlob,
    });

    expect(result.failed).toBe(false);
    expect(await readFile(join(ws, "keep.txt"), "utf-8")).toBe("KEEP");
    // A rejected create is removed (it did not exist at baseline).
    await expect(readFile(join(ws, "drop.txt"), "utf-8")).rejects.toThrow();
  });

  it("is not a capture turn when neither a git ref nor a CAS manifest exists", async () => {
    const status = newStatus();
    const storage = makeStorage();
    const readBlob = reconcilerReadBlob(storage);
    const changeSet = create(FileChangeSetSchema, { id: CHANGE_SET_ID, status: FileChangeSetStatus.DECIDED });

    const result = await applyCaptureDecisions({
      status, gitRoot: ws, executionId: EXEC_ID, changeSet, harnessId: HARNESS,
      gitWorkspace: false, storage, readBlob,
    });

    expect(result.isCaptureTurn).toBe(false);
    expect(eventsOfType(status, FileReviewEventType.RECONCILED)).toHaveLength(0);
  });

  // Slice 2d: durable across a sandbox recycle — the reconcile sources approved
  // bytes ENTIRELY from the CAS manifest + blobs (a different durability domain
  // than the workspace), so it converges even after the whole tree is wiped.
  it("is durable across a sandbox recycle: reconciles from the manifest after the tree is wiped", async () => {
    const status = newStatus();
    const storage = makeStorage();
    const readBlob = reconcilerReadBlob(storage);
    const enc = (s: string) => new TextEncoder().encode(s);

    const baseline = await captureBaselineToLedger({
      status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      harnessId: HARNESS, gitWorkspace: false,
    });
    await writeFile(join(ws, "keep.txt"), "NEW");
    await captureCandidateToLedger({
      status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, gitWorkspace: false, storage,
      casCaptures: [
        { path: "keep.txt", before: enc("OLD"), after: enc("NEW"), captureClass: FileCaptureClass.NON_GIT_CAS },
      ],
    });

    const changeSet = decidedChangeSet(status, { "keep.txt": FileDecisionAction.APPROVE });

    // Wipe the whole tree (sandbox recycle / Temporal retry on a fresh host).
    await rm(ws, { recursive: true, force: true });
    await mkdir(ws, { recursive: true });

    const result = await applyCaptureDecisions({
      status, gitRoot: ws, executionId: EXEC_ID, changeSet, harnessId: HARNESS,
      gitWorkspace: false, storage, readBlob,
    });

    expect(result.isCaptureTurn).toBe(true);
    expect(result.failed).toBe(false);
    expect(result.approvedPaths).toEqual(["keep.txt"]);
    expect(await readFile(join(ws, "keep.txt"), "utf-8")).toBe("NEW");
  });

  // Slice 2b: a non-git secret-blocked path must be labeled NON_GIT_CAS (not
  // "gitignored"), so the review UI reports its true provenance while its content
  // is still withheld (DD-E).
  it("labels a non-git secret-blocked path NON_GIT_CAS and blocks approval", async () => {
    const status = newStatus();
    const storage = makeStorage();

    const baseline = await captureBaselineToLedger({
      status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      harnessId: HARNESS, gitWorkspace: false,
    });

    await writeFile(join(ws, "app.log"), "log\n");
    await captureCandidateToLedger({
      status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, gitWorkspace: false, storage,
      casCaptures: [
        { path: "app.log", before: null, after: new TextEncoder().encode("log\n"), captureClass: FileCaptureClass.NON_GIT_CAS },
      ],
      unreviewablePaths: [".env"],
      unreviewableCaptureClass: FileCaptureClass.NON_GIT_CAS,
    });

    const byPath = new Map(candidateChanges(status).map((c) => [c.pathAfter || c.pathBefore, c]));
    const blocked = byPath.get(".env")!;
    expect(blocked.captureClass).toBe(FileCaptureClass.NON_GIT_CAS);
    expect(blocked.blockedReason).toBe(FileReviewBlockReason.SECRET_WITHHELD);
    expect(blocked.diffComplete).toBe(false);
    // The blocked path never enters storage; only the reviewable log's blob does.
    expect(blocked.before).toBeUndefined();
    expect(blocked.after).toBeUndefined();
    // One incomplete (non-binary) file forces PARTIAL_BLOCKED (approval blocked).
    expect(candidateCompleteness(status)).toBe(DiffCompleteness.PARTIAL_BLOCKED);
  });
});
