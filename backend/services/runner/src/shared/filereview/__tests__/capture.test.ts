/**
 * @regression file-hitl-gate — pins three rules of git capture mode: a
 * no-commit tree-ref snapshot and restore with one card per changed file;
 * edits stay applied after the turn and an undo restores from the pinned
 * refs; an undo snaps only the files decided REJECT back byte for byte,
 * leaves kept and undecided files as they are, and restores nothing when
 * what it would restore no longer matches what was reviewed.
 *
 * Tests the harness-agnostic capture orchestration directly, under one
 * harness id (since #1096 the runtime is the ONE caller for every harness,
 * `harness/capture.ts`; until then each adapter called this seam and the
 * Cursor side had its own test, `execute-cursor/capture-flow.test.ts`, whose
 * three reconcile arms no other file carried moved here). Confirms that the
 * ledger entries depend on nothing but `harness_id` and that with no
 * excludePaths every changed file is captured. Runs against a REAL temp git repo.
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clone, create, toBinary } from "@bufbuild/protobuf";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import {
  DiffCompleteness,
  FileCaptureClass,
  FileChangeKind,
  FileReviewBlockReason,
  SnapshotKind,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { ArtifactStorage } from "../../artifact-storage.js";
import { makeInMemoryArtifactStorage } from "../../../__test-utils__/fake-artifact-storage.js";
import {
  captureBaselineToLedger,
  captureCandidateToLedger,
  deriveCaptureMode,
  deriveCaptureSubstrate,
  partitionGitChangesBySecret,
  undoChangeSet,
} from "../capture.js";
import { dropCaptureRefs } from "../git-substrate.js";
import type { GitSubstrateChange } from "../git-substrate.js";
import { casBlobReader } from "../cas-substrate.js";
import {
  FileChangeType,
  FileReviewEventType,
} from "../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { TurnRowsSchema, type TurnRows } from "../../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import type { LoggedFileDecision } from "../capture.js";
import type { FileReviewEvent } from "../../../gen/turn/ai/stigmer/runner/turn/v1/ledger_pb.js";
import { fileRecordOf } from "../record.js";

const execFileAsync = promisify(execFile);
const EXEC_ID = "exec-da-1";
const CHANGE_SET_ID = `${EXEC_ID}:0`;
const HARNESS = "deep-agent";

// ── deriveCaptureMode: the shared capture-vs-deny-gate decision (both harnesses) ──
// Capture needs both facts: the turn's review is on, and the workspace has a
// substrate. A non-git workspace with NO artifact storage (or no workspace) has
// no capture substrate, so a turn with review on falls back to the deny-gate —
// the branch this pins for BOTH the Cursor (exact-apply) and deep-agent
// (LangGraph-replay) harnesses. With review off nothing is captured whatever
// the workspace can do.
describe("deriveCaptureMode", () => {
  // primary dir, git, storage → substrate; then review on / off → capture.
  const TABLE: ReadonlyArray<readonly [string | undefined, boolean, boolean, boolean]> = [
    ["/ws", true, true, true],
    ["/ws", true, false, true],
    ["/ws", false, true, true],
    ["/ws", false, false, false],
    [undefined, true, true, false],
    [undefined, false, false, false],
    ["", true, true, false],
  ];

  it.each(TABLE)("dir=%s git=%s storage=%s: substrate=%s", (dir, git, storage, substrate) => {
    expect(deriveCaptureSubstrate(dir, git, storage)).toBe(substrate);
  });

  it.each(TABLE)("dir=%s git=%s storage=%s: review on captures iff the substrate holds (%s)", (dir, git, storage, substrate) => {
    expect(deriveCaptureMode(dir, git, storage, true)).toBe(substrate);
  });

  it.each(TABLE)("dir=%s git=%s storage=%s: review off never captures", (dir, git, storage) => {
    expect(deriveCaptureMode(dir, git, storage, false)).toBe(false);
  });
});

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

function newStatus(): TurnRows {
  return create(TurnRowsSchema, {});
}
function eventsOfType(status: TurnRows, type: FileReviewEventType): FileReviewEvent[] {
  return (status.fileReviewEventStream?.events ?? []).filter((e) => e.eventType === type);
}
function candidateChanges(status: TurnRows): CapturedFileChange[] {
  const ev = eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED)[0];
  return ev?.payload.case === "candidateCaptured" ? ev.payload.value.changes : [];
}
function decidedChangeSet(
  status: TurnRows,
  decisionByPath: Record<string, "keep" | "undo">,
) {
  const changes = candidateChanges(status).map((c) => clone(CapturedFileChangeSchema, c));
  const decisions: LoggedFileDecision[] = changes
    .filter((c) => decisionByPath[c.pathAfter || c.pathBefore] !== undefined)
    .map((c) => ({ scope: "file", fileChangeId: c.id, action: decisionByPath[c.pathAfter || c.pathBefore]! }));
  // Carry the candidate snapshot too (as the server projection does), so an undo
  // finds the CAS manifest the candidate recorded. Git tests undo from git refs
  // and ignore it.
  const candEv = eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED)[0];
  const candidateSnapshot =
    candEv?.payload.case === "candidateCaptured" ? candEv.payload.value.candidateSnapshot : undefined;
  return Object.assign(create(FileChangeSetSchema, { id: CHANGE_SET_ID, changes, candidateSnapshot }), { decisions });
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
      rows: status,
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
      rows: status,
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

  it("undoes only the files decided REJECT, from the refs; kept and undecided files stay; nothing reaches the ledger", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await write("notes.md", "planton notes\n");
    await write("src/main.ts", "export const x = 99;\n");
    await write("src/new.ts", "export const y = 2;\n");
    await captureCandidateToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS,
    });
    const ledgerBefore = status.fileReviewEventStream?.events.length ?? 0;

    // notes.md kept, src/main.ts undone, src/new.ts undecided.
    const changeSet = decidedChangeSet(status, {
      "notes.md": "keep",
      "src/main.ts": "undo",
    });

    const outcome = await undoChangeSet({ gitRoot: repo, changeSet, decisions: changeSet.decisions, gitWorkspace: true });

    expect(outcome).toEqual({ changeSetId: CHANGE_SET_ID, undonePaths: ["src/main.ts"], failure: "", failureDetail: "" });
    // The undone file is back at its baseline; the kept and the undecided stay applied; nothing committed.
    expect(await read("src/main.ts")).toBe("export const x = 1;\n");
    expect(await read("notes.md")).toBe("planton notes\n");
    expect(await read("src/new.ts")).toBe("export const y = 2;\n");
    expect((await git(["log", "--oneline"])).trim().split("\n")).toHaveLength(1);
    // The outcome is the caller's to record: no ledger event, and the refs stay for the next message turn to drop.
    expect(status.fileReviewEventStream?.events.length ?? 0).toBe(ledgerBefore);
    expect((await git(["for-each-ref", "refs/stigmer/"])).trim()).not.toBe("");
  });

  it("a set with nothing decided REJECT puts nothing back and reads no ref", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({ rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS });
    await write("notes.md", "planton notes\n");
    await captureCandidateToLedger({ rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, baselineTree: baseline, harnessId: HARNESS });
    const changeSet = decidedChangeSet(status, { "notes.md": "keep" });

    expect(await undoChangeSet({ gitRoot: repo, changeSet, decisions: changeSet.decisions, gitWorkspace: true })).toEqual({
      changeSetId: CHANGE_SET_ID, undonePaths: [], failure: "", failureDetail: "",
    });
    expect(await read("notes.md")).toBe("planton notes\n");
  });

  it("a git-only undo never probes storage for a CAS manifest, even when exists() lies (regression: proxy 404 crash)", async () => {
    // Regression for the file-review reconcile crash in cloud/desktop (proxy)
    // artifact mode. `ProxyArtifactStorage.exists()` reports true for ANY key
    // (the presign endpoint mints a URL regardless of object existence), so the
    // old reconcile "found" a CAS manifest that a git-only turn never wrote,
    // downloaded it, and died on the R2 `NoSuchKey` 404 (the ExecuteCursor
    // crash `proxy-reconcile.test.ts` reproduces). The undo decides "is this a CAS turn?"
    // from the change set's CANDIDATE snapshot — a git-only turn carries no cas
    // ref — so a lying `exists()` can never turn a git undo into a doomed
    // download.
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await write("notes.md", "planton notes\n");
    await captureCandidateToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS,
    });

    const changeSet = decidedChangeSet(status, { "notes.md": "undo" });
    // Precondition: this is a git-only turn — its candidate snapshot has no CAS ref.
    expect(changeSet.candidateSnapshot?.kind).toBe(SnapshotKind.GIT_TREE_REF);
    expect(changeSet.candidateSnapshot?.cas).toBeUndefined();

    // A storage that behaves like the proxy: `exists()` lies (true for every key)
    // and a download of the absent manifest fails (the R2 404 from error.md).
    const { storage } = makeInMemoryArtifactStorage();
    storage.exists.mockResolvedValue(true);

    const outcome = await undoChangeSet({ gitRoot: repo, changeSet, decisions: changeSet.decisions, gitWorkspace: true, readBlob: casBlobReader(storage) });

    // Undone via git; nothing crashed.
    expect(outcome.failure).toBe("");
    expect(outcome.undonePaths).toEqual(["notes.md"]);
    expect(await read("notes.md")).toBe("platon notes\n");
    // The proof: the git-only undo never asked storage for the CAS manifest.
    const manifestKey =
      `artifacts/${EXEC_ID}/filereview/cas/${CHANGE_SET_ID.replace(/[^A-Za-z0-9._-]/g, "_")}.manifest.json`;
    expect(storage.download).not.toHaveBeenCalledWith(manifestKey);
  });

  it("undoes a binary byte-exact — the digest gate accepts a byte-true binary", async () => {
    // A binary is captured incomplete (no text diff). The undo's digest gate
    // must ACCEPT the byte-true binary (never spuriously hash_mismatch on a
    // body-less side) and restore the exact baseline bytes from the git ref.
    const BIN_BEFORE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x80, 0x01]);
    const BIN_AFTER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x80, 0xff]);
    await mkdir(join(repo, "assets"), { recursive: true });
    await writeFile(join(repo, "assets/logo.png"), BIN_BEFORE);
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "logo"]);
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await writeFile(join(repo, "assets/logo.png"), BIN_AFTER); // binary modify

    await captureCandidateToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS,
    });

    // Captured honestly: incomplete (binary), is_binary set, no inline body.
    const bin = candidateChanges(status).find((c) => c.pathAfter === "assets/logo.png")!;
    expect(bin.diffComplete).toBe(false);
    expect(bin.after?.isBinary).toBe(true);
    expect(bin.after?.body.case).toBeUndefined(); // body-less

    const changeSet = decidedChangeSet(status, { "assets/logo.png": "undo" });
    const outcome = await undoChangeSet({ gitRoot: repo, changeSet, decisions: changeSet.decisions, gitWorkspace: true });

    expect(outcome.failure).toBe("");
    expect(outcome.undonePaths).toEqual(["assets/logo.png"]);
    expect((await readFile(join(repo, "assets/logo.png"))).equals(BIN_BEFORE)).toBe(true);
  });
});

// In-memory artifact store for the CAS composition tests — the canonical double.
function makeStorage(): ArtifactStorage & { blobs: Map<string, Buffer> } {
  const { storage, blobs } = makeInMemoryArtifactStorage();
  return Object.assign(storage, { blobs });
}

function candidateSnapshotKind(status: TurnRows): SnapshotKind | undefined {
  const ev = eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED)[0];
  return ev?.payload.case === "candidateCaptured"
    ? ev.payload.value.candidateSnapshot?.kind
    : undefined;
}
function candidateCompleteness(status: TurnRows): DiffCompleteness | undefined {
  const ev = eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED)[0];
  return ev?.payload.case === "candidateCaptured"
    ? ev.payload.value.diffCompleteness
    : undefined;
}

describe("undo after the turn — the decision rules it enforces", () => {
  async function captureTwoFileTurn(status: TurnRows): Promise<void> {
    const baseline = await captureBaselineToLedger({ rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS });
    await write("notes.md", "planton notes\n");
    await write("src/main.ts", "export const x = 99;\n");
    await captureCandidateToLedger({ rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, baselineTree: baseline, harnessId: HARNESS });
  }

  it("restores an undone file from the ref whatever the tree holds now (retry-safe)", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({ rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS });
    await write("notes.md", "planton notes\n");
    await captureCandidateToLedger({ rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, baselineTree: baseline, harnessId: HARNESS });
    const changeSet = decidedChangeSet(status, { "notes.md": "undo" });

    // The tree moved on before the undo (a retry, a recycle): the pinned refs survive.
    await write("notes.md", "something else entirely\n");

    const outcome = await undoChangeSet({ gitRoot: repo, changeSet, decisions: changeSet.decisions, gitWorkspace: true });

    expect(outcome.undonePaths).toEqual(["notes.md"]);
    // Restore-from-refs puts back the baseline bytes whatever the tree holds.
    expect(await read("notes.md")).toBe("platon notes\n");
    // A second run converges on the same bytes (idempotent).
    expect((await undoChangeSet({ gitRoot: repo, changeSet, decisions: changeSet.decisions, gitWorkspace: true })).failure).toBe("");
    expect(await read("notes.md")).toBe("platon notes\n");
  });

  it("CHANGE_SET-scoped undo covers all files; a FILE keep overrides it (most-specific-wins)", async () => {
    const status = newStatus();
    await captureTwoFileTurn(status);
    const changes = candidateChanges(status);
    const notesChange = changes.find((c) => c.pathAfter === "notes.md")!;
    const changeSet = create(FileChangeSetSchema, { id: CHANGE_SET_ID, changes });
    const decisions: LoggedFileDecision[] = [
      // A FILE decision keeps notes.md…
      { scope: "file", fileChangeId: notesChange.id, action: "keep" },
      // …and a CHANGE_SET decision undoes the rest (more specific wins whatever the order).
      { scope: "change_set", fileChangeId: "", action: "undo" },
    ];

    const outcome = await undoChangeSet({ gitRoot: repo, changeSet, decisions, gitWorkspace: true });

    expect(outcome.undonePaths).toEqual(["src/main.ts"]);
    expect(await read("notes.md")).toBe("planton notes\n");
    expect(await read("src/main.ts")).toBe("export const x = 1;\n");
  });

  it("answers hash_mismatch and restores NOTHING when an undone file's capture no longer matches what was reviewed", async () => {
    const status = newStatus();
    await captureTwoFileTurn(status);
    // Both undone, but the recorded before_sha256 for notes.md no longer matches
    // the captured bytes (what-you-reviewed-is-what-is-undone fails).
    const changeSet = decidedChangeSet(status, { "notes.md": "undo", "src/main.ts": "undo" });
    changeSet.changes.find((c) => c.pathAfter === "notes.md")!.beforeSha256 = "deadbeef".repeat(8);
    const ledgerBefore = status.fileReviewEventStream?.events.length ?? 0;

    const outcome = await undoChangeSet({ gitRoot: repo, changeSet, decisions: changeSet.decisions, gitWorkspace: true });

    expect(outcome.failure).toBe("hash_mismatch");
    expect(outcome.failureDetail).toContain("notes.md");
    expect(outcome.undonePaths).toEqual([]);
    // NOTHING was restored (a partial undo under a verification failure is worse than none).
    expect(await read("src/main.ts")).toBe("export const x = 99;\n");
    expect(await read("notes.md")).toBe("planton notes\n");
    expect(status.fileReviewEventStream?.events.length ?? 0).toBe(ledgerBefore);
  });

  it("answers hash_mismatch and restores NOTHING when an undone file is one the turn's refs never captured", async () => {
    const status = newStatus();
    await captureTwoFileTurn(status);
    const changeSet = decidedChangeSet(status, { "src/main.ts": "undo" });
    // A reviewed file the pinned refs do not hold: captured differently from what was reviewed.
    const ghost = clone(CapturedFileChangeSchema, changeSet.changes.find((c) => c.pathAfter === "src/main.ts")!);
    ghost.id = `${CHANGE_SET_ID}:ghost.md`;
    ghost.pathAfter = "ghost.md";
    ghost.pathBefore = "ghost.md";
    changeSet.changes.push(ghost);
    changeSet.decisions.push(
      { scope: "file", fileChangeId: ghost.id, action: "undo" },
    );

    const outcome = await undoChangeSet({ gitRoot: repo, changeSet, decisions: changeSet.decisions, gitWorkspace: true });

    expect(outcome.failure).toBe("hash_mismatch");
    expect(outcome.failureDetail).toContain("ghost.md");
    expect(outcome.failureDetail).not.toContain("src/main.ts");
    expect(outcome.undonePaths).toEqual([]);
    expect(await read("src/main.ts"), "the file that does match is not put back either").toBe("export const x = 99;\n");
  });

  it("answers reconcile_failed when the turn's refs are gone (the window closed and a later turn dropped them)", async () => {
    const status = newStatus();
    await captureTwoFileTurn(status);
    const changeSet = decidedChangeSet(status, { "src/main.ts": "undo" });
    await dropCaptureRefs(repo, EXEC_ID);

    const outcome = await undoChangeSet({ gitRoot: repo, changeSet, decisions: changeSet.decisions, gitWorkspace: true });

    expect(outcome.failure).toBe("reconcile_failed");
    expect(outcome.failureDetail).toContain("src/main.ts");
    expect(await read("src/main.ts")).toBe("export const x = 99;\n");
  });
});

describe("capture orchestration — hybrid git + CAS", () => {
  it("composes git-tracked and CAS captures into one HYBRID change set", async () => {
    const status = newStatus();
    const storage = makeStorage();
    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });

    // A git-tracked edit AND an ignored file the harness captured out-of-band.
    await write("notes.md", "planton notes\n");
    const gitChanges = await captureCandidateToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
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
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await write("notes.md", "planton notes\n");
    await captureCandidateToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, storage, casCaptures: [],
    });
    expect(candidateSnapshotKind(status)).toBe(SnapshotKind.GIT_TREE_REF);
    expect(storage.blobs.size).toBe(0);
  });

  it("marks the change set BINARY_SUMMARY_ONLY when the only incomplete file is a binary CAS file", async () => {
    const status = newStatus();
    const storage = makeStorage();
    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await captureCandidateToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, storage,
      casCaptures: [
        { path: "cache.bin", before: null, after: new Uint8Array([1, 0, 2]), captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED },
      ],
    });
    const cand = candidateChanges(status);
    expect(cand[0].diffComplete).toBe(false);
    // Binary is conveyed by FileContent.is_binary, not blocked_reason.
    expect(cand[0].blockedReason).toBe(FileReviewBlockReason.UNSPECIFIED);
    // Binary is the set's only blocker, so it is keepable in one acknowledged action.
    expect(candidateCompleteness(status)).toBe(DiffCompleteness.BINARY_SUMMARY_ONLY);
  });

  it("undoes hybrid decisions after the turn: the undone CAS file reverted, the kept ones untouched", async () => {
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
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });

    // Apply the turn's edits to disk (the "after" state the review window shows).
    await write("notes.md", "planton\n"); // git-tracked
    await write("dist/out.txt", "X"); // ignored ADD
    await write("build/cache.txt", "NEW"); // ignored MODIFY (baseline was OLD)

    await captureCandidateToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, storage,
      casCaptures: [
        { path: "dist/out.txt", before: null, after: enc("X"), captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED },
        { path: "build/cache.txt", before: enc("OLD"), after: enc("NEW"), captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED },
      ],
    });

    const changeSet = decidedChangeSet(status, {
      "notes.md": "keep",
      "dist/out.txt": "keep",
      "build/cache.txt": "undo",
    });

    const outcome = await undoChangeSet({ gitRoot: repo, changeSet, decisions: changeSet.decisions, gitWorkspace: true, readBlob });

    expect(outcome.failure).toBe("");
    expect(outcome.undonePaths).toEqual(["build/cache.txt"]);
    // Kept git + kept CAS untouched; the undone CAS file reverted to its baseline bytes.
    expect(await read("notes.md")).toBe("planton\n");
    expect(await read("dist/out.txt")).toBe("X");
    expect(await read("build/cache.txt")).toBe("OLD");
  });

  it("answers reconcile_failed when the candidate records CAS files but no blob reader is provided", async () => {
    // The ledger says CAS files were captured; a caller that cannot read blobs
    // back must not silently skip them (the undo would go unenforced).
    const status = newStatus();
    const storage = makeStorage();
    await write(".gitignore", "dist/\n");
    await git(["add", ".gitignore"]);
    await git(["commit", "-q", "-m", "ignore"]);
    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await write("dist/out.txt", "X");
    await captureCandidateToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, storage,
      casCaptures: [
        { path: "dist/out.txt", before: null, after: new TextEncoder().encode("X"), captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED },
      ],
    });
    const changeSet = decidedChangeSet(status, { "dist/out.txt": "undo" });

    const outcome = await undoChangeSet({ gitRoot: repo, changeSet, decisions: changeSet.decisions, gitWorkspace: true });

    expect(outcome.failure).toBe("reconcile_failed");
    expect(outcome.failureDetail).toContain("dist/out.txt");
    expect(await read("dist/out.txt")).toBe("X");
  });

  it("answers reconcile_failed when the stored manifest no longer hashes to the ledger's manifestDigest", async () => {
    // The undo must verify the manifest it downloads against the digest the
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
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await write("dist/out.txt", "X");
    await captureCandidateToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, storage,
      casCaptures: [
        { path: "dist/out.txt", before: null, after: new TextEncoder().encode("X"), captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED },
      ],
    });
    const changeSet = decidedChangeSet(status, { "dist/out.txt": "undo" });

    // Tamper with the stored manifest between review and undo.
    const manifestUri = changeSet.candidateSnapshot!.cas!.artifactUri;
    const stored = storage.blobs.get(manifestUri)!;
    storage.blobs.set(manifestUri, Buffer.from(stored.toString("utf8").replace("dist/out.txt", "dist/evil.txt"), "utf8"));

    const outcome = await undoChangeSet({ gitRoot: repo, changeSet, decisions: changeSet.decisions, gitWorkspace: true, readBlob });

    expect(outcome.failure).toBe("reconcile_failed");
    expect(outcome.failureDetail).toMatch(/CAS manifest integrity check failed/);
    expect(await read("dist/out.txt")).toBe("X");
  });

  it("throws if CAS captures are supplied without a storage backend", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await expect(
      captureCandidateToLedger({
        rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
        baselineTree: baseline, harnessId: HARNESS,
        casCaptures: [
          { path: ".env", before: null, after: new TextEncoder().encode("X=1"), captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED },
        ],
      }),
    ).rejects.toThrow(/requires an ArtifactStorage/);
  });
});

describe("capture orchestration — secret-blocked DIFF_UNREVIEWABLE", () => {
  it("authors a content-less DIFF_UNREVIEWABLE entry that blocks approval and persists nothing", async () => {
    const status = newStatus();
    const storage = makeStorage();
    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });

    await write("notes.md", "planton\n"); // a real git change alongside the block

    await captureCandidateToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, storage,
      unreviewablePaths: [".env"],
    });

    const byPath = new Map(candidateChanges(status).map((c) => [c.pathAfter || c.pathBefore, c]));
    expect([...byPath.keys()].sort()).toEqual([".env", "notes.md"]);

    const secret = byPath.get(".env")!;
    expect(secret.captureClass).toBe(FileCaptureClass.GIT_IGNORED_CAPTURED);
    expect(secret.diffComplete).toBe(false);
    // The honest cause is recorded so the UI can say *why*, while the
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
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });

    // The only thing that "happened" is a blocked secret write attempt.
    await captureCandidateToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS,
      unreviewablePaths: [".env"],
    });

    expect(eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED)).toHaveLength(1);
    expect(candidateChanges(status).map((c) => c.pathAfter)).toEqual([".env"]);
    expect(candidateCompleteness(status)).toBe(DiffCompleteness.PARTIAL_BLOCKED);
  });
});

// A git-TRACKED secret-like file (a committed credentials.json, .env.example,
// ...) FLOWS in capture mode (the gate allows tracked mutations with no secret
// check), so it reaches the turn boundary in the git diff WITH real bytes. Those
// bytes must never enter the ledger: the capture seam authors it content-less
// (SECRET_WITHHELD / GIT_TRACKED), discard-only, and the git substrate reverts
// it byte-exact on reject. This is the one place that can withhold a DELETE's
// baseline (before) secret too — the gate never sees a delete's content.
describe("capture orchestration — git-tracked secret withheld", () => {
  const SECRET_PATH = "config/credentials.json";
  const BASELINE_SECRET = "OLD_API_KEY=sk-live-OLDSECRET-do-not-persist-111\n";
  const NEW_SECRET = "NEW_API_KEY=sk-live-NEWSECRET-do-not-persist-222\n";

  async function commitBaselineSecret(): Promise<void> {
    await write(SECRET_PATH, BASELINE_SECRET);
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "add tracked secret"]);
  }

  // Serialize the WHOLE of what leaves the runner (the rows with their ledger,
  // and the status carrying the file record read from it) and assert neither
  // the baseline nor the new secret bytes survive anywhere — the leak-scan that
  // would FAIL before this fix (the git diff carried the inline body).
  function assertNoSecretBytes(status: TurnRows): void {
    const wire = Buffer.concat([
      Buffer.from(toBinary(TurnRowsSchema, status)),
      Buffer.from(toBinary(RunStatusSchema, create(RunStatusSchema, { fileChanges: fileRecordOf(status) }))),
    ]);
    expect(wire.includes(Buffer.from(BASELINE_SECRET))).toBe(false);
    expect(wire.includes(Buffer.from(NEW_SECRET))).toBe(false);
  }

  it("MODIFY: content-less SECRET_WITHHELD/GIT_TRACKED entry; PARTIAL_BLOCKED; nothing persisted", async () => {
    await commitBaselineSecret();
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await write(SECRET_PATH, NEW_SECRET); // the agent edits the committed secret

    await captureCandidateToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS,
    });

    const entry = candidateChanges(status).find((c) => (c.pathAfter || c.pathBefore) === SECRET_PATH)!;
    expect(entry).toBeDefined();
    expect(entry.captureClass).toBe(FileCaptureClass.GIT_TRACKED);
    expect(entry.kind).toBe(FileChangeKind.MODIFY);
    expect(entry.diffComplete).toBe(false);
    expect(entry.blockedReason).toBe(FileReviewBlockReason.SECRET_WITHHELD);
    // No content and no enforcement digests on EITHER side (before is secret too).
    expect(entry.before).toBeUndefined();
    expect(entry.after).toBeUndefined();
    expect(entry.beforeSha256).toBe("");
    expect(entry.afterSha256).toBe("");
    expect(candidateCompleteness(status)).toBe(DiffCompleteness.PARTIAL_BLOCKED);
    assertNoSecretBytes(status);
  });

  it("CREATE: a newly-created tracked secret is content-less (kind ADD, no after bytes)", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await write(SECRET_PATH, NEW_SECRET); // brand-new secret file this turn

    await captureCandidateToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS,
    });

    const entry = candidateChanges(status).find((c) => (c.pathAfter || c.pathBefore) === SECRET_PATH)!;
    expect(entry.kind).toBe(FileChangeKind.ADD);
    expect(entry.captureClass).toBe(FileCaptureClass.GIT_TRACKED);
    expect(entry.diffComplete).toBe(false);
    expect(entry.blockedReason).toBe(FileReviewBlockReason.SECRET_WITHHELD);
    expect(entry.after).toBeUndefined();
    expect(entry.afterSha256).toBe("");
    expect(candidateCompleteness(status)).toBe(DiffCompleteness.PARTIAL_BLOCKED);
    assertNoSecretBytes(status);
  });

  it("DELETE: withholds the deleted file's baseline (before) secret bytes (kind DELETE)", async () => {
    await commitBaselineSecret();
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await rm(join(repo, SECRET_PATH), { force: true }); // the agent deletes the secret

    await captureCandidateToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS,
    });

    const entry = candidateChanges(status).find((c) => c.pathBefore === SECRET_PATH)!;
    expect(entry).toBeDefined();
    expect(entry.kind).toBe(FileChangeKind.DELETE);
    expect(entry.captureClass).toBe(FileCaptureClass.GIT_TRACKED);
    expect(entry.diffComplete).toBe(false);
    // The DELETE's `before` side is the committed secret — the leak only this
    // seam can withhold (the gate never sees a delete's content).
    expect(entry.before).toBeUndefined();
    expect(entry.beforeSha256).toBe("");
    expect(candidateCompleteness(status)).toBe(DiffCompleteness.PARTIAL_BLOCKED);
    assertNoSecretBytes(status);
  });

  it("mixed set: the non-secret file stays keepable; the secret reverts byte-exact on reject", async () => {
    await commitBaselineSecret();
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await write("notes.md", "planton notes\n"); // reviewable tracked change
    await write(SECRET_PATH, NEW_SECRET); // withheld tracked secret change

    await captureCandidateToLedger({
      rows: status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS,
    });

    const byPath = new Map(candidateChanges(status).map((c) => [c.pathAfter || c.pathBefore, c]));
    // The non-secret file is fully reviewable/keepable (content present).
    expect(byPath.get("notes.md")!.diffComplete).toBe(true);
    expect(byPath.get("notes.md")!.after).toBeDefined();
    expect(byPath.get("notes.md")!.blockedReason).toBe(FileReviewBlockReason.UNSPECIFIED);
    // The secret rides alongside content-less, forcing the set PARTIAL_BLOCKED.
    expect(byPath.get(SECRET_PATH)!.diffComplete).toBe(false);
    expect(byPath.get(SECRET_PATH)!.blockedReason).toBe(FileReviewBlockReason.SECRET_WITHHELD);
    expect(candidateCompleteness(status)).toBe(DiffCompleteness.PARTIAL_BLOCKED);
    assertNoSecretBytes(status);

    // Keep the reviewable file; undo the secret. The git substrate reverts the
    // secret to its committed baseline BYTE-EXACT (not deleted) and leaves notes.md.
    // The secret's entry carries no digest (its bytes were never recorded), so
    // the undo restores it from the refs alone.
    const changeSet = decidedChangeSet(status, {
      "notes.md": "keep",
      [SECRET_PATH]: "undo",
    });
    const outcome = await undoChangeSet({ gitRoot: repo, changeSet, decisions: changeSet.decisions, gitWorkspace: true });

    expect(outcome.failure).toBe("");
    expect(outcome.undonePaths).toEqual([SECRET_PATH]);
    expect(await read("notes.md")).toBe("planton notes\n");
    expect(await read(SECRET_PATH)).toBe(BASELINE_SECRET); // reverted byte-exact
    // Even after the undo, no secret bytes are anywhere in the persisted status.
    assertNoSecretBytes(status);
  });
});

// partitionGitChangesBySecret: the pure split the composition relies on.
describe("partitionGitChangesBySecret (pure)", () => {
  const mk = (path: string): GitSubstrateChange => ({
    path,
    changeType: FileChangeType.MODIFY,
    before: { kind: "inline", text: "a" },
    after: { kind: "inline", text: "b" },
  });

  it("routes secret-like paths to `secret` and everything else to `safe`", () => {
    const { safe, secret } = partitionGitChangesBySecret([
      mk("src/main.ts"),
      mk("config/credentials.json"),
      mk(".env"),
      mk("README.md"),
      mk("keys/id_rsa"),
    ]);
    expect(safe.map((c) => c.path)).toEqual(["src/main.ts", "README.md"]);
    expect(secret.map((c) => c.path)).toEqual(["config/credentials.json", ".env", "keys/id_rsa"]);
  });

  it("returns everything safe when no path is secret-like", () => {
    const { safe, secret } = partitionGitChangesBySecret([mk("a.ts"), mk("b/c.md")]);
    expect(safe).toHaveLength(2);
    expect(secret).toHaveLength(0);
  });
});

// The shared orchestration must capture and reconcile a
// NON-GIT workspace entirely from the CAS manifest — no git refs, no whole-tree
// snapshot, bounded to the paths the observer actually touched. These exercise
// capture.ts directly against a plain (non-git) temp dir; the harness wirings
// that flip `gitWorkspace=false` and observe all touched paths are tested
// with each harness.
function reconcilerReadBlob(storage: { blobs: Map<string, Buffer> }): (key: string) => Promise<Buffer> {
  return async (key: string): Promise<Buffer> => {
    const b = storage.blobs.get(key);
    if (!b) throw new Error(`missing ${key}`);
    return b;
  };
}

describe("capture orchestration — CAS-only non-git workspace", () => {
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
      rows: status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
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
      rows: status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
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

  it("undoes from the manifest: the undone file back to its before bytes, the kept one untouched", async () => {
    const status = newStatus();
    const storage = makeStorage();
    const readBlob = reconcilerReadBlob(storage);
    const enc = (s: string) => new TextEncoder().encode(s);

    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      harnessId: HARNESS, gitWorkspace: false,
    });

    // The turn's edits are already on disk (the "after" state the review shows).
    await writeFile(join(ws, "created.txt"), "X");
    await writeFile(join(ws, "edited.txt"), "NEW");
    await captureCandidateToLedger({
      rows: status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, gitWorkspace: false, storage,
      casCaptures: [
        { path: "created.txt", before: null, after: enc("X"), captureClass: FileCaptureClass.NON_GIT_CAS },
        { path: "edited.txt", before: enc("OLD"), after: enc("NEW"), captureClass: FileCaptureClass.NON_GIT_CAS },
      ],
    });

    const changeSet = decidedChangeSet(status, {
      "created.txt": "keep",
      "edited.txt": "undo",
    });
    const ledgerBefore = status.fileReviewEventStream?.events.length ?? 0;

    const outcome = await undoChangeSet({ gitRoot: ws, changeSet, decisions: changeSet.decisions, gitWorkspace: false, readBlob });

    expect(outcome).toEqual({ changeSetId: CHANGE_SET_ID, undonePaths: ["edited.txt"], failure: "", failureDetail: "" });
    expect(await readFile(join(ws, "created.txt"), "utf-8")).toBe("X");
    expect(await readFile(join(ws, "edited.txt"), "utf-8")).toBe("OLD");
    expect(status.fileReviewEventStream?.events.length ?? 0, "nothing reaches the ledger").toBe(ledgerBefore);
  });

  it("an undone ADD is removed; a kept file is left exactly as the tree holds it", async () => {
    const status = newStatus();
    const storage = makeStorage();
    const readBlob = reconcilerReadBlob(storage);
    const enc = (s: string) => new TextEncoder().encode(s);

    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      harnessId: HARNESS, gitWorkspace: false,
    });
    await writeFile(join(ws, "keep.txt"), "KEEP");
    await writeFile(join(ws, "drop.txt"), "DROP");
    await captureCandidateToLedger({
      rows: status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, gitWorkspace: false, storage,
      casCaptures: [
        { path: "keep.txt", before: null, after: enc("KEEP"), captureClass: FileCaptureClass.NON_GIT_CAS },
        { path: "drop.txt", before: null, after: enc("DROP"), captureClass: FileCaptureClass.NON_GIT_CAS },
      ],
    });

    const changeSet = decidedChangeSet(status, {
      "keep.txt": "keep",
      "drop.txt": "undo",
    });

    // A later edit removed the kept file: an undo of another file never touches it.
    await rm(join(ws, "keep.txt"), { force: true });

    const outcome = await undoChangeSet({ gitRoot: ws, changeSet, decisions: changeSet.decisions, gitWorkspace: false, readBlob });

    expect(outcome.failure).toBe("");
    await expect(readFile(join(ws, "keep.txt"), "utf-8")).rejects.toThrow();
    // An undone create is removed (it did not exist at baseline).
    await expect(readFile(join(ws, "drop.txt"), "utf-8")).rejects.toThrow();
  });

  it("authors a DELETE from {before, after:null}; an undone DELETE is restored, a kept one stays gone (issue #303)", async () => {
    // The delete flow end-to-end at this seam: the harness captured the
    // pre-delete bytes and the file is gone from disk (the tool ran). The
    // candidate must carry a DELETE with the before blob; a kept DELETE stays
    // deleted, an undone DELETE is restored byte-exact from the blob.
    const status = newStatus();
    const storage = makeStorage();
    const readBlob = reconcilerReadBlob(storage);
    const enc = (s: string) => new TextEncoder().encode(s);

    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      harnessId: HARNESS, gitWorkspace: false,
    });
    await captureCandidateToLedger({
      rows: status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, gitWorkspace: false, storage,
      casCaptures: [
        { path: "gone-approved.txt", before: enc("A"), after: null, captureClass: FileCaptureClass.NON_GIT_CAS },
        { path: "gone-rejected.txt", before: enc("B"), after: null, captureClass: FileCaptureClass.NON_GIT_CAS },
      ],
    });

    const cand = candidateChanges(status);
    expect(cand.map((c) => c.kind)).toEqual([FileChangeKind.DELETE, FileChangeKind.DELETE]);
    // A DELETE names its path on the BEFORE side only, with the restorable blob.
    expect(cand.map((c) => c.pathBefore)).toEqual(["gone-approved.txt", "gone-rejected.txt"]);
    expect(cand.map((c) => c.pathAfter)).toEqual(["", ""]);
    expect(cand[0].before?.body.case).toBe("ref");
    expect(cand[0].after).toBeUndefined();

    const changeSet = decidedChangeSet(status, {
      "gone-approved.txt": "keep",
      "gone-rejected.txt": "undo",
    });
    const outcome = await undoChangeSet({ gitRoot: ws, changeSet, decisions: changeSet.decisions, gitWorkspace: false, readBlob });

    expect(outcome.failure).toBe("");
    expect(outcome.undonePaths).toEqual(["gone-rejected.txt"]);
    await expect(readFile(join(ws, "gone-approved.txt"), "utf-8")).rejects.toThrow();
    expect(await readFile(join(ws, "gone-rejected.txt"), "utf-8")).toBe("B");
  });

  it("answers hash_mismatch and restores nothing when a CAS file's blobs differ from what was reviewed", async () => {
    const status = newStatus();
    const storage = makeStorage();
    const readBlob = reconcilerReadBlob(storage);
    const enc = (s: string) => new TextEncoder().encode(s);
    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS, gitWorkspace: false,
    });
    await writeFile(join(ws, "edited.txt"), "NEW");
    await captureCandidateToLedger({
      rows: status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, gitWorkspace: false, storage,
      casCaptures: [{ path: "edited.txt", before: enc("OLD"), after: enc("NEW"), captureClass: FileCaptureClass.NON_GIT_CAS }],
    });
    const changeSet = decidedChangeSet(status, { "edited.txt": "undo" });
    changeSet.changes[0]!.afterSha256 = "deadbeef".repeat(8);

    const outcome = await undoChangeSet({ gitRoot: ws, changeSet, decisions: changeSet.decisions, gitWorkspace: false, readBlob });

    expect(outcome.failure).toBe("hash_mismatch");
    expect(outcome.failureDetail).toContain("edited.txt");
    expect(await readFile(join(ws, "edited.txt"), "utf-8")).toBe("NEW");
  });

  it("a change set with no files undoes nothing", async () => {
    const storage = makeStorage();
    const readBlob = reconcilerReadBlob(storage);
    const changeSet = create(FileChangeSetSchema, { id: CHANGE_SET_ID });

    expect(await undoChangeSet({ gitRoot: ws, changeSet, decisions: [], gitWorkspace: false, readBlob })).toEqual({
      changeSetId: CHANGE_SET_ID, undonePaths: [], failure: "", failureDetail: "",
    });
  });

  // Durable across a sandbox recycle — the undo sources its bytes ENTIRELY
  // from the CAS manifest + blobs (a different durability domain than the
  // workspace), so it converges even after the whole tree is wiped.
  it("is durable across a sandbox recycle: undoes from the manifest after the tree is wiped", async () => {
    const status = newStatus();
    const storage = makeStorage();
    const readBlob = reconcilerReadBlob(storage);
    const enc = (s: string) => new TextEncoder().encode(s);

    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      harnessId: HARNESS, gitWorkspace: false,
    });
    await writeFile(join(ws, "edited.txt"), "NEW");
    await captureCandidateToLedger({
      rows: status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS, gitWorkspace: false, storage,
      casCaptures: [
        { path: "edited.txt", before: enc("OLD"), after: enc("NEW"), captureClass: FileCaptureClass.NON_GIT_CAS },
      ],
    });

    const changeSet = decidedChangeSet(status, { "edited.txt": "undo" });

    // Wipe the whole tree (sandbox recycle / Temporal retry on a fresh host).
    await rm(ws, { recursive: true, force: true });
    await mkdir(ws, { recursive: true });

    const outcome = await undoChangeSet({ gitRoot: ws, changeSet, decisions: changeSet.decisions, gitWorkspace: false, readBlob });

    expect(outcome.failure).toBe("");
    expect(outcome.undonePaths).toEqual(["edited.txt"]);
    expect(await readFile(join(ws, "edited.txt"), "utf-8")).toBe("OLD");
  });

  // A non-git secret-blocked path must be labeled NON_GIT_CAS (not
  // "gitignored"), so the review UI reports its true provenance while its content
  // is still withheld.
  it("labels a non-git secret-blocked path NON_GIT_CAS and blocks approval", async () => {
    const status = newStatus();
    const storage = makeStorage();

    const baseline = await captureBaselineToLedger({
      rows: status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      harnessId: HARNESS, gitWorkspace: false,
    });

    await writeFile(join(ws, "app.log"), "log\n");
    await captureCandidateToLedger({
      rows: status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
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
