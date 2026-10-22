/**
 * Pins the undos a turn's start owes (`../owed-undos.ts`), on a REAL git work
 * tree with the log and the change set's run stood in by a client double:
 *
 *  - the owed slice: an `undo` decided with no `reconciled` beside it, read
 *    newest first back to and including the newest `user.message` that is
 *    not this run's, across pages, and nothing older;
 *  - an undo already reconciled in the slice is skipped;
 *  - only the files decided REJECT are put back, kept ones untouched, and
 *    the outcome is written at once as `reconciled`;
 *  - a capture that no longer matches what was reviewed, or a change set
 *    whose run cannot be read, restores nothing and is recorded as a
 *    failure, so it is not tried again;
 *  - the previous message turn's capture refs are dropped in a message turn
 *    only; a reconcile turn's window is still open, so it keeps them.
 *
 * The undo's restore rules themselves are `shared/filereview/__tests__/
 * capture.test.ts`'s; the reconcile turn end to end is the kit's runtime arm.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunSchema, RunStatusSchema, type Run, type RunStatus } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import { initGitWorkspace } from "../../__test-utils__/git-workspace-fixture.js";
import { captureBaselineToLedger, captureCandidateToLedger } from "../../shared/filereview/capture.js";
import { fileReviewReconciledEventId } from "../events/ids.js";
import { decisionsBySet, owedUndos, readOwedUndos, reconcileOwedUndos, type OwedUndoDeps, type ReconciledUndo } from "../owed-undos.js";
import { fileRecordOf } from "../../shared/filereview/record.js";
import { TurnRowsSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

const SESSION = "ses_owed";
const EARLIER = "run_earlier";
const THIS = "run_this";
const CHANGE_SET = `${EARLIER}:0`;

let n = 0;
function userMessage(runId: string): SessionEvent {
  return create(SessionEventSchema, { runId, event: { case: "userMessage", value: { id: `sevt_um_${n++}` } } });
}
function decided(changeSetId: string, action: "keep" | "undo", runId = EARLIER, file?: string): SessionEvent {
  return create(SessionEventSchema, {
    runId,
    event: {
      case: "stigmerFileReviewDecided",
      value: {
        id: `sevt_fd_${n++}`,
        changeSetId,
        scope: file === undefined ? "change_set" : "file",
        fileChangeId: file === undefined ? "" : `${changeSetId}:${file}`,
        action,
        origin: "person",
      },
    },
  });
}
/** The `reconciled` that answers the undo `decision`. */
function reconciled(decision: SessionEvent, runId = THIS): SessionEvent {
  const value = decision.event.case === "stigmerFileReviewDecided" ? decision.event.value : undefined;
  const changeSetId = value?.changeSetId ?? "";
  return create(SessionEventSchema, {
    runId,
    event: { case: "stigmerFileReviewReconciled", value: { id: fileReviewReconciledEventId(changeSetId, value?.id ?? ""), changeSetId } },
  });
}
const idOf = (event: SessionEvent): string => (event.event.case === "stigmerFileReviewDecided" ? event.event.value.id : "");

/** A log double answering the typed read newest first, `pageSize` events a page. */
function logClient(oldestFirst: readonly SessionEvent[], runs: ReadonlyMap<string, Run>, pageSize = 1000) {
  const newestFirst = [...oldestFirst].reverse();
  const listSessionEvents = vi.fn(async (_session: string, query: { readonly pageToken: string; readonly order: string }) => {
    expect(query.order).toBe("desc");
    const start = query.pageToken === "" ? 0 : Number(query.pageToken);
    const events = newestFirst.slice(start, start + pageSize);
    const next = start + pageSize < newestFirst.length ? String(start + pageSize) : "";
    return { events, nextPageToken: next };
  });
  const getExecution = vi.fn(async (id: string) => {
    const run = runs.get(id);
    if (run === undefined) throw new Error(`no run ${id}`);
    return run;
  });
  return { listSessionEvents, getExecution };
}

describe("owedUndos", () => {
  it("an undo no reconciled answers is owed, oldest first; a keep and an answered undo are not", () => {
    const undoA = decided("run_a:0", "undo");
    const undoB = decided("run_b:0", "undo");
    const undoC = decided("run_c:0", "undo");
    const newestFirst = [undoC, reconciled(undoB), undoA, undoB, decided("run_d:0", "keep")];
    expect(owedUndos(newestFirst).map((undo) => [undo.changeSetId, undo.decidedEventId])).toEqual([
      ["run_a:0", idOf(undoA)],
      ["run_c:0", idOf(undoC)],
    ]);
  });

  it("is keyed per undo: a second file's undo on a set whose first undo was answered is still owed", () => {
    const undoFirst = decided(CHANGE_SET, "undo", EARLIER, "a.md");
    const undoSecond = decided(CHANGE_SET, "undo", EARLIER, "b.md");
    const owed = owedUndos([undoSecond, reconciled(undoFirst, "run_reconcile"), undoFirst]);
    expect(owed).toEqual([{ decidedEventId: idOf(undoSecond), changeSetId: CHANGE_SET, scope: "file", fileChangeId: `${CHANGE_SET}:b.md` }]);
  });
});

describe("decisionsBySet", () => {
  it("is every decision the slice holds, by change set, oldest first, keeps included", () => {
    const keepB = decided(CHANGE_SET, "keep", EARLIER, "b.md");
    const undoA = decided(CHANGE_SET, "undo", EARLIER, "a.md");
    const other = decided("run_other:0", "undo", "run_other");
    const bySet = decisionsBySet([other, undoA, userMessage(EARLIER), keepB]);
    expect(bySet.get(CHANGE_SET)).toEqual([
      { scope: "file", fileChangeId: `${CHANGE_SET}:b.md`, action: "keep" },
      { scope: "file", fileChangeId: `${CHANGE_SET}:a.md`, action: "undo" },
    ]);
    expect(bySet.get("run_other:0")).toEqual([{ scope: "change_set", fileChangeId: "", action: "undo" }]);
  });

  it("takes no decision written under a run other than the set's own", () => {
    const own = decided(CHANGE_SET, "undo", EARLIER, "a.md");
    const foreign = decided(CHANGE_SET, "keep", THIS);
    expect(decisionsBySet([foreign, own]).get(CHANGE_SET)).toEqual([
      { scope: "file", fileChangeId: `${CHANGE_SET}:a.md`, action: "undo" },
    ]);
  });
});

describe("readOwedUndos", () => {
  it("pages newest first back to the newest user.message that is not this run's, that event included, and reads no further", async () => {
    const log = logClient(
      [
        userMessage("run_older"),
        decided("run_older:0", "undo", "run_older"),
        userMessage(EARLIER),
        decided(CHANGE_SET, "undo"),
        userMessage(THIS),
        decided(`${THIS}:0`, "undo", THIS),
      ],
      new Map(),
      2,
    );
    const owed = await readOwedUndos(log, SESSION, THIS);
    expect(
      owed.undos.map((undo) => undo.changeSetId),
      "the undo before the previous turn's message is outside the slice",
    ).toEqual([CHANGE_SET, `${THIS}:0`]);
    expect(owed.previousMessageRunId).toBe(EARLIER);
    expect(log.listSessionEvents, "two pages reach the previous message; the third is never read").toHaveBeenCalledTimes(2);
    expect(log.listSessionEvents.mock.calls[0]![1]).toMatchObject({
      types: ["user.message", "stigmer.file_review.decided", "stigmer.file_review.reconciled"],
    });
  });

  it("reads past a message still queued (no run) and one this run read while it worked, to the previous turn's", async () => {
    const log = logClient(
      [
        userMessage(EARLIER),
        decided(CHANGE_SET, "undo"),
        userMessage(THIS),
        userMessage(""),
        userMessage(THIS),
        decided(`${THIS}:0`, "undo", THIS),
      ],
      new Map(),
    );
    const owed = await readOwedUndos(log, SESSION, THIS);
    expect(owed.previousMessageRunId).toBe(EARLIER);
    expect(owed.undos.map((undo) => undo.changeSetId)).toEqual([CHANGE_SET, `${THIS}:0`]);
  });

  it("a session with no earlier message reads the whole log and names no previous run", async () => {
    const log = logClient([userMessage(THIS), decided(`${THIS}:0`, "undo", THIS)], new Map());
    const owed = await readOwedUndos(log, SESSION, THIS);
    expect([owed.undos.map((undo) => undo.changeSetId), owed.previousMessageRunId]).toEqual([[`${THIS}:0`], undefined]);
  });
});

describe("reconcileOwedUndos", () => {
  let repo: string;
  let earlier: Run;

  const git = (args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf-8" });
  const read = (rel: string): string => readFileSync(join(repo, rel), "utf-8");

  /** The earlier turn: it captured edits to a.md and b.md, and its run holds the change set on its file record. */
  async function earlierTurnCaptured(): Promise<RunStatus> {
    const rows = create(TurnRowsSchema, {});
    const baseline = await captureBaselineToLedger({ rows, gitRoot: repo, executionId: EARLIER, changeSetId: CHANGE_SET, harnessId: "unit" });
    writeFileSync(join(repo, "a.md"), "a after\n");
    writeFileSync(join(repo, "b.md"), "b after\n");
    await captureCandidateToLedger({ rows, gitRoot: repo, executionId: EARLIER, changeSetId: CHANGE_SET, baselineTree: baseline, harnessId: "unit" });
    return create(RunStatusSchema, { fileChanges: fileRecordOf(rows) });
  }

  function deps(log: ReturnType<typeof logClient>, overrides: Partial<OwedUndoDeps> = {}): OwedUndoDeps & { readonly recorded: ReconciledUndo[][] } {
    const recorded: ReconciledUndo[][] = [];
    return {
      client: log,
      runId: THIS,
      sessionId: SESSION,
      workspace: { primaryDir: repo, gitWorkspace: true },
      artifactStorage: undefined,
      reconcileTurn: false,
      recordReconciled: async (outcomes) => {
        recorded.push([...outcomes]);
      },
      recorded,
      ...overrides,
    };
  }

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), "stigmer-owed-undos-"));
    initGitWorkspace(repo, { "a.md": "a before\n", "b.md": "b before\n" });
    earlier = create(RunSchema, { metadata: { id: EARLIER }, status: await earlierTurnCaptured() });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("a message turn puts back only the undone file, records it at once, then drops the previous turn's refs", async () => {
    const undo = decided(CHANGE_SET, "undo", EARLIER, "a.md");
    const log = logClient([userMessage(EARLIER), decided(CHANGE_SET, "keep", EARLIER, "b.md"), undo, userMessage(THIS)], new Map([[EARLIER, earlier]]));
    const d = deps(log);

    const outcomes = await reconcileOwedUndos(d);

    expect(outcomes).toEqual([{ changeSetId: CHANGE_SET, undonePaths: ["a.md"], failure: "", failureDetail: "" }]);
    expect(read("a.md")).toBe("a before\n");
    expect(read("b.md"), "a kept file is left as it is").toBe("b after\n");
    expect(d.recorded).toEqual([[{ ...outcomes[0]!, decidedEventId: idOf(undo) }]]);
    expect(log.getExecution).toHaveBeenCalledWith(EARLIER);
    expect(git(["for-each-ref", `refs/stigmer/`]).trim(), "the closed window's refs are gone").toBe("");
  });

  it("a reconcile turn puts the file back and drops nothing: its turn's window is still open", async () => {
    const log = logClient([userMessage(EARLIER), decided(CHANGE_SET, "undo", EARLIER, "a.md")], new Map([[EARLIER, earlier]]));
    const d = deps(log, { runId: "run_reconcile", reconcileTurn: true });

    await reconcileOwedUndos(d);

    expect(read("a.md")).toBe("a before\n");
    expect(read("b.md"), "a file no decision undoes is left as it is").toBe("b after\n");
    expect(git(["for-each-ref", `refs/stigmer/`]).trim()).not.toBe("");
  });

  it("an undo the slice already holds a reconciled for is skipped: nothing restored, nothing written", async () => {
    const undo = decided(CHANGE_SET, "undo");
    const log = logClient([userMessage(EARLIER), undo, reconciled(undo, "run_reconcile"), userMessage(THIS)], new Map([[EARLIER, earlier]]));
    const d = deps(log);

    expect(await reconcileOwedUndos(d)).toEqual([]);
    expect(read("a.md"), "the other turn already put it back; this one never touches it").toBe("a after\n");
    expect(d.recorded).toEqual([]);
    expect(log.getExecution).not.toHaveBeenCalled();
  });

  it("a capture that no longer matches what was reviewed restores nothing and is recorded as hash_mismatch", async () => {
    earlier.status!.fileChanges[0]!.changes.find((c) => c.pathAfter === "a.md")!.beforeSha256 = "deadbeef".repeat(8);
    const log = logClient([userMessage(EARLIER), decided(CHANGE_SET, "undo")], new Map([[EARLIER, earlier]]));
    const d = deps(log, { runId: "run_reconcile", reconcileTurn: true });

    const outcomes = await reconcileOwedUndos(d);

    expect(outcomes.map((o) => o.failure)).toEqual(["hash_mismatch"]);
    expect(outcomes[0]!.undonePaths).toEqual([]);
    expect(read("a.md")).toBe("a after\n");
    expect(d.recorded[0]!.map((answer) => [answer.failure, answer.undonePaths])).toEqual([["hash_mismatch", []]]);
  });

  it("a change set its run no longer holds is recorded as reconcile_failed", async () => {
    const log = logClient([userMessage(EARLIER), decided(`${EARLIER}:9`, "undo")], new Map([[EARLIER, earlier]]));
    const outcomes = await reconcileOwedUndos(deps(log, { runId: "run_reconcile", reconcileTurn: true }));
    expect(outcomes.map((o) => [o.changeSetId, o.failure])).toEqual([[`${EARLIER}:9`, "reconcile_failed"]]);
  });

  it("a change set whose run cannot be read is recorded as reconcile_failed, with the read's error", async () => {
    const log = logClient([userMessage(EARLIER), decided("run_gone:0", "undo")], new Map([[EARLIER, earlier]]));
    const d = deps(log, { runId: "run_reconcile", reconcileTurn: true });

    const outcomes = await reconcileOwedUndos(d);

    expect(outcomes).toEqual([
      { changeSetId: "run_gone:0", undonePaths: [], failure: "reconcile_failed", failureDetail: "the turn's changes could not be read: no run run_gone" },
    ]);
    expect(d.recorded[0]!.map((answer) => answer.failure)).toEqual(["reconcile_failed"]);
  });

  it("a second file's undo after the first was put back is put back too, answered under its own id", async () => {
    // Both files undone one at a time: a.md's undo already answered, b.md's
    // decided after it on the same set (the slice holds both). a.md is back
    // at its baseline already, as the first reconcile left it.
    writeFileSync(join(repo, "a.md"), "a before\n");
    const undoA = decided(CHANGE_SET, "undo", EARLIER, "a.md");
    const undoB = decided(CHANGE_SET, "undo", EARLIER, "b.md");
    const log = logClient(
      [userMessage(EARLIER), undoA, reconciled(undoA, "run_reconcile"), undoB],
      new Map([[EARLIER, earlier]]),
    );
    const d = deps(log, { runId: "run_reconcile_2", reconcileTurn: true });

    await reconcileOwedUndos(d);

    expect(read("b.md"), "the second undo lands").toBe("b before\n");
    expect(read("a.md"), "the first stays put back").toBe("a before\n");
    expect(d.recorded).toEqual([
      [{ changeSetId: CHANGE_SET, undonePaths: ["b.md"], failure: "", failureDetail: "", decidedEventId: idOf(undoB) }],
    ]);
  });

  it("a turn with no primary tree reads nothing", async () => {
    const log = logClient([decided(CHANGE_SET, "undo")], new Map([[EARLIER, earlier]]));
    expect(await reconcileOwedUndos(deps(log, { workspace: { primaryDir: "", gitWorkspace: false } }))).toEqual([]);
    expect(log.listSessionEvents).not.toHaveBeenCalled();
  });
});
