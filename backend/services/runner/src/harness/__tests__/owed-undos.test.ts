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
import { RunSchema, RunStatusSchema, type Run, type RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import { decideCapturedFileChanges } from "../../__test-utils__/file-review-projection.js";
import { initGitWorkspace } from "../../__test-utils__/git-workspace-fixture.js";
import { captureBaselineToLedger, captureCandidateToLedger, type UndoOutcome } from "../../shared/filereview/capture.js";
import { owedChangeSets, readOwedUndos, reconcileOwedUndos, type OwedUndoDeps } from "../owed-undos.js";

const SESSION = "ses_owed";
const EARLIER = "run_earlier";
const THIS = "run_this";
const CHANGE_SET = `${EARLIER}:0`;

let n = 0;
function userMessage(runId: string): SessionEvent {
  return create(SessionEventSchema, { runId, event: { case: "userMessage", value: { id: `sevt_um_${n++}` } } });
}
function decided(changeSetId: string, action: "keep" | "undo", runId = EARLIER): SessionEvent {
  return create(SessionEventSchema, {
    runId,
    event: { case: "stigmerFileReviewDecided", value: { id: `sevt_fd_${n++}`, changeSetId, scope: "change_set", action, origin: "person" } },
  });
}
function reconciled(changeSetId: string, runId = THIS): SessionEvent {
  return create(SessionEventSchema, {
    runId,
    event: { case: "stigmerFileReviewReconciled", value: { id: `${changeSetId}.r`, changeSetId } },
  });
}

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

describe("owedChangeSets", () => {
  it("an undo with no reconciled is owed, once, oldest decision first; a keep and a reconciled undo are not", () => {
    const newestFirst = [
      decided("run_c:0", "undo"),
      reconciled("run_b:0"),
      decided("run_a:0", "undo"),
      decided("run_b:0", "undo"),
      decided("run_d:0", "keep"),
      decided("run_a:0", "undo"),
    ];
    expect(owedChangeSets(newestFirst)).toEqual(["run_a:0", "run_c:0"]);
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
    expect(owed.changeSetIds, "the undo before the previous turn's message is outside the slice").toEqual([CHANGE_SET, `${THIS}:0`]);
    expect(owed.previousMessageRunId).toBe(EARLIER);
    expect(log.listSessionEvents, "two pages reach the previous message; the third is never read").toHaveBeenCalledTimes(2);
    expect(log.listSessionEvents.mock.calls[0]![1]).toMatchObject({
      types: ["user.message", "stigmer.file_review.decided", "stigmer.file_review.reconciled"],
    });
  });

  it("a session with no earlier message reads the whole log and names no previous run", async () => {
    const log = logClient([userMessage(THIS), decided(`${THIS}:0`, "undo", THIS)], new Map());
    expect(await readOwedUndos(log, SESSION, THIS)).toEqual({ changeSetIds: [`${THIS}:0`], previousMessageRunId: undefined });
  });
});

describe("reconcileOwedUndos", () => {
  let repo: string;
  let earlier: Run;

  const git = (args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf-8" });
  const read = (rel: string): string => readFileSync(join(repo, rel), "utf-8");

  /** The earlier turn: it captured edits to a.md and b.md; the person undoes a.md and keeps b.md. */
  async function earlierTurnCaptured(): Promise<RunStatus> {
    const status = create(RunStatusSchema, {});
    const baseline = await captureBaselineToLedger({ status, gitRoot: repo, executionId: EARLIER, changeSetId: CHANGE_SET, harnessId: "unit" });
    writeFileSync(join(repo, "a.md"), "a after\n");
    writeFileSync(join(repo, "b.md"), "b after\n");
    await captureCandidateToLedger({ status, gitRoot: repo, executionId: EARLIER, changeSetId: CHANGE_SET, baselineTree: baseline, harnessId: "unit" });
    decideCapturedFileChanges(status, { reject: ["a.md"], approve: ["b.md"] }, "2026-10-12T00:00:00Z");
    return status;
  }

  function deps(log: ReturnType<typeof logClient>, overrides: Partial<OwedUndoDeps> = {}): OwedUndoDeps & { readonly recorded: UndoOutcome[][] } {
    const recorded: UndoOutcome[][] = [];
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
    const log = logClient([userMessage(EARLIER), decided(CHANGE_SET, "undo"), userMessage(THIS)], new Map([[EARLIER, earlier]]));
    const d = deps(log);

    const outcomes = await reconcileOwedUndos(d);

    expect(outcomes).toEqual([{ changeSetId: CHANGE_SET, undonePaths: ["a.md"], failure: "", failureDetail: "" }]);
    expect(read("a.md")).toBe("a before\n");
    expect(read("b.md"), "a kept file is left as it is").toBe("b after\n");
    expect(d.recorded).toEqual([outcomes]);
    expect(log.getExecution).toHaveBeenCalledWith(EARLIER);
    expect(git(["for-each-ref", `refs/stigmer/`]).trim(), "the closed window's refs are gone").toBe("");
  });

  it("a reconcile turn puts the file back and drops nothing: its turn's window is still open", async () => {
    const log = logClient([userMessage(EARLIER), decided(CHANGE_SET, "undo")], new Map([[EARLIER, earlier]]));
    const d = deps(log, { runId: "run_reconcile", reconcileTurn: true });

    await reconcileOwedUndos(d);

    expect(read("a.md")).toBe("a before\n");
    expect(git(["for-each-ref", `refs/stigmer/`]).trim()).not.toBe("");
  });

  it("an undo the slice already holds a reconciled for is skipped: nothing restored, nothing written", async () => {
    const log = logClient([userMessage(EARLIER), decided(CHANGE_SET, "undo"), reconciled(CHANGE_SET, "run_reconcile"), userMessage(THIS)], new Map([[EARLIER, earlier]]));
    const d = deps(log);

    expect(await reconcileOwedUndos(d)).toEqual([]);
    expect(read("a.md"), "the other turn already put it back; this one never touches it").toBe("a after\n");
    expect(d.recorded).toEqual([]);
    expect(log.getExecution).not.toHaveBeenCalled();
  });

  it("a capture that no longer matches what was reviewed restores nothing and is recorded as hash_mismatch", async () => {
    earlier.status!.fileChangeSets[0]!.changes.find((c) => c.pathAfter === "a.md")!.beforeSha256 = "deadbeef".repeat(8);
    const log = logClient([userMessage(EARLIER), decided(CHANGE_SET, "undo")], new Map([[EARLIER, earlier]]));
    const d = deps(log, { runId: "run_reconcile", reconcileTurn: true });

    const outcomes = await reconcileOwedUndos(d);

    expect(outcomes.map((o) => o.failure)).toEqual(["hash_mismatch"]);
    expect(outcomes[0]!.undonePaths).toEqual([]);
    expect(read("a.md")).toBe("a after\n");
    expect(d.recorded).toEqual([outcomes]);
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
    expect(d.recorded).toEqual([outcomes]);
  });

  it("a turn with no primary tree reads nothing", async () => {
    const log = logClient([decided(CHANGE_SET, "undo")], new Map([[EARLIER, earlier]]));
    expect(await reconcileOwedUndos(deps(log, { workspace: { primaryDir: "", gitWorkspace: false } }))).toEqual([]);
    expect(log.listSessionEvents).not.toHaveBeenCalled();
  });
});
