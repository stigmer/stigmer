/**
 * Hermetic scenario: a FILE-REVIEW CAPTURE turn on a git workspace through
 * the whole `ExecuteDeepAgent` activity.
 *
 * Invariant pinned (apply-then-review, in a session whose `file_review` is
 * on): on a git work tree the deepagents `edit_file` FLOWS — the approval
 * gate lets a git-capturable path through under capture mode — and the turn boundary
 * captures the net change from the git diff against the baseline tree pinned
 * before the agent ran (`captureBaselineToLedger`, git snapshot), authors
 * CANDIDATE_CAPTURED to the file_review ledger with one card for the edited
 * file, stamps the flowed edit row with the change-set id
 * (`stampFlowedFileEditRows`), writes `stigmer.file_review.changes` into the
 * session's log, and the activity persists COMPLETED and RETURNS: review
 * never holds a turn (stigmer#1471). The change-set id is the deterministic
 * `executionId:turnSeq`. The ledger shape is what the runtime's capture must
 * reproduce, beside Cursor's `file-review-capture.status.json`.
 *
 * Why this arm has a golden file since #1096: the orchestrator created the
 * workspace's `.stigmer` symlink
 * unconditionally BEFORE the baseline snapshot, and the link's TARGET is the
 * platform dir under `HOME`, so the baseline and candidate tree OIDs the
 * ledger carries were per-host — and per-run here, where `HOME` is a temp
 * directory. The runtime creates the link only when a skill or attachment
 * needs it (the same rule that makes Cursor's golden byte-stable); this
 * scenario mounts neither, so no link enters either tree and both OIDs are
 * content-derived. Every content-derived byte is still asserted in code
 * (the lock-timeout arm's rule, #1070, is the shape for
 * a status the host could reach), and `goldens/file-review-capture.status.json`
 * pins the whole ledger beside Cursor's.
 *
 * Golden hunk since #1443: the inline artifact's `createdAt` is t=1, the
 * edit's finish, where it was t=2, the moment the publisher's upload
 * returned (it reads the clock before its first await now).
 *
 * Parent phase rows exercised beyond the plain arms: a `local_path` workspace
 * entry (mounted as-is in local mode, the agent rooted at the entry per
 * `provisionWorkspace`); capture-mode derivation on a git tree; the baseline
 * pin; the turn boundary's candidate capture and row stamping; the completion
 * with the edit applied.
 *
 * Three more arms, each with goldens of its own: an Undo after the turn is
 * put back by a reconcile turn that never asks the model (the script holds
 * no turn for it, so a model call would fail the run); with review off (the
 * default) the same edit flows uncaptured and the turn completes; and a
 * secret-like write to a gitignored path is refused whatever review says.
 *
 * Determinism: the fixture repo's commit and tree ids are byte-stable because
 * `initGitWorkspace` pins author, committer and both dates; the script's path
 * is virtual-absolute (`/notes.md`) so no temp directory can reach the golden.
 *
 * The first turn's stamps are `:01` (#1097, 2026-09-15): until then the
 * golden held `:02` for message 1, its row's `startedAt`/`completedAt`, and
 * the flip to `:01` in CI was a producer/consumer race, not a change of rule.
 * This is the one native scenario whose first mid-stream persist shells out
 * (the capture substrate's `file_change_progress`), and while the loop awaited
 * it LangGraph's producer ran the tool and called the scripted model's second
 * turn, whose tick landed before message 1 was stamped — on a fast machine;
 * on a slow one the consumer won. The scripted model now waits for the
 * previous turn's tool results to be persisted settled before it ticks
 * (`ExecutionRecord.whenToolCallsSettled`, the ground a real model's latency
 * gives for free), so turn 1's stamps precede turn 2's instant every run, as
 * they do in `tool-call.status.json`. The artifact's `createdAt` stays `:02`:
 * the inline publisher stamps it when its upload lands, after the tick, and
 * the persist that releases the barrier is the fast one (progress capture is
 * throttled by its floor within the same second). Message 2, `capturedAt`,
 * the ledger events and `fileChangeProgress` are the boundary's, after turn 2.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  DiffCompleteness,
  RunPhase,
  FileCaptureClass,
  FileChangeKind,
  SnapshotKind,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { initGitWorkspace, localPathEntry } from "../../../../__test-utils__/git-workspace-fixture.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import {
  FIXTURE,
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";

const FILE = "notes.md";
const BEFORE = "# Notes\n\nfirst\n";
const AFTER = "# Notes\n\nfirst\nsecond\n";
const CALL_ID = "call-hermetic-edit-0001";
const CHANGE_SET_ID = `${FIXTURE.executionId}:0`;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("ExecuteDeepAgent hermetic — file-review capture", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  it("lets the write flow, captures it at the boundary, and completes with the edit applied", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const repo = join(env.workspaceRootDir, "repos", "notes");
    initGitWorkspace(repo, { [FILE]: BEFORE });
    const record = deepAgentExecutionRecord({
      message: "Append a second line to notes.md.",
      workspaceEntries: [localPathEntry("notes", repo)],
      fileReview: true,
    });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => ({
        turns: [
          {
            text: "Appending the line.",
            toolCalls: [
              { id: CALL_ID, name: "edit_file", args: { file_path: `/${FILE}`, old_string: "first\n", new_string: "first\nsecond\n" } },
            ],
            usage: { inputTokens: 1_300, outputTokens: 60 },
          },
          { text: "Appended.", usage: { inputTokens: 1_500, outputTokens: 10 } },
        ],
      }),
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runDeepAgentTurn(scenario);

    // ── Assert: the edit flowed and the turn completed with it ───────────────
    expect(readFileSync(join(repo, FILE), "utf-8"), "the working tree holds the candidate").toBe(AFTER);
    expect(invocation.outcome.kind).toBe("returned");
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase, "review never holds the turn").toBe(
      "RUN_COMPLETED",
    );
    expect(record.persistedPhases).toEqual([
      RunPhase.RUN_IN_PROGRESS,
      RunPhase.RUN_COMPLETED,
    ]);
    expect(record.sessionEvents.filter((e) => e.event.case === "stigmerFileReviewChanges").map((e) => e.event.value?.id)).toEqual([
      `${FIXTURE.executionId}.fr0`,
    ]);

    // ── Assert: the file_review ledger, byte by byte where the host cannot reach ──
    const final = record.lastFullStatus!;
    const events = final.fileReviewEventStream?.events ?? [];
    expect(events.map((e) => e.payload.case)).toEqual(["baselineCaptured", "candidateCaptured"]);
    const baseline = events[0].payload;
    if (baseline.case !== "baselineCaptured") throw new Error("unreachable");
    expect(baseline.value.changeSetId).toBe(CHANGE_SET_ID);
    expect(baseline.value.turnId).toBe(CHANGE_SET_ID);
    expect(baseline.value.harnessId).toBe("deep-agent");
    expect(baseline.value.baselineSnapshot?.kind).toBe(SnapshotKind.GIT_TREE_REF);
    const candidate = events[1].payload;
    if (candidate.case !== "candidateCaptured") throw new Error("unreachable");
    expect(candidate.value.changeSetId).toBe(CHANGE_SET_ID);
    expect(candidate.value.candidateSnapshot?.kind).toBe(SnapshotKind.GIT_TREE_REF);
    expect(candidate.value.diffCompleteness).toBe(DiffCompleteness.COMPLETE);
    expect(candidate.value.aggregateDigest, "content-derived, stable").toMatch(/^[0-9a-f]{64}$/);
    expect(candidate.value.changes).toHaveLength(1);
    const change = candidate.value.changes[0];
    expect(change.id).toBe(`${CHANGE_SET_ID}:${FILE}`);
    expect([change.pathBefore, change.pathAfter]).toEqual([FILE, FILE]);
    expect(change.kind).toBe(FileChangeKind.MODIFY);
    expect(change.captureClass).toBe(FileCaptureClass.GIT_TRACKED);
    expect(change.before?.body.case === "inline" ? change.before.body.value : undefined).toBe(BEFORE);
    expect(change.after?.body.case === "inline" ? change.after.body.value : undefined).toBe(AFTER);
    expect(change.beforeSha256).toBe(sha256(BEFORE));
    expect(change.afterSha256).toBe(sha256(AFTER));
    expect(final.fileChangeProgress?.changeSetId).toBe(CHANGE_SET_ID);
    expect(final.fileChangeProgress?.filesChanged).toBe(1);
    expect(final.fileChangeProgress?.linesAdded).toBe(1);

    // The two tree OIDs are content-derived now that no host path enters the
    // trees (since #1096): well-formed, distinct, and pinned
    // byte for byte by the golden below.
    const baselineOid = baseline.value.baselineSnapshot?.git?.treeOid ?? "";
    const candidateOid = candidate.value.candidateSnapshot?.git?.treeOid ?? "";
    expect(baselineOid).toMatch(/^[0-9a-f]{40}$/);
    expect(candidateOid).toMatch(/^[0-9a-f]{40}$/);
    expect(candidateOid).not.toBe(baselineOid);
    expect(candidate.value.candidateSnapshot?.git?.ref).toBe(`refs/stigmer/capture/${FIXTURE.executionId}`);

    // The flowed edit row: the category policy's verdict is stamped on the row,
    // but capture mode let it FLOW — COMPLETED, never WAITING_APPROVAL; the
    // review happens on the file card instead.
    const rows = record.toolCalls();
    expect(rows.map((tc) => [tc.id, tc.name, tc.status])).toEqual([[CALL_ID, "edit_file", ToolCallStatus.TOOL_CALL_COMPLETED]]);
    expect(record.waitingToolCalls(), "no gate row — the review is on the file card").toHaveLength(0);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    const json = JSON.stringify(toJson(RunStatusSchema, final));
    expect(json, "no temp path reaches the status itself").not.toContain(env.workspaceRootDir);
    expect(json, "no host path reaches the status itself").not.toContain(env.home);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const pretty = JSON.stringify(toJson(RunStatusSchema, final), null, 2) + "\n";
    await expect(pretty).toMatchFileSnapshot("./goldens/file-review-capture.status.json");
    await expect(record.eventsGolden()).toMatchFileSnapshot("./goldens/file-review-capture.events.json");

    // ── An Undo after the turn: a reconcile turn puts the file back ──────────
    clock.tick();
    expect(record.decideCapturedFileChanges({ reject: [FILE] }, new Date().toISOString())).toBe(1);
    const reconcileRunId = record.startReconcileTurn();
    const reconcile = await runDeepAgentTurn(scenario, { executionId: reconcileRunId });

    expect(reconcile.outcome.kind).toBe("returned");
    expect((reconcile.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(readFileSync(join(repo, FILE), "utf-8"), "the undone file is back at its baseline").toBe(BEFORE);
    const reconciled = record.reconcileFinalStatus!;
    expect(reconciled.stopCause).toBe("review_resolved");
    expect(reconciled.fileReviewEventStream?.events ?? [], "nothing reaches any ledger").toHaveLength(0);
    expect(
      record.sessionEvents.filter((e) => e.event.case === "stigmerFileReviewReconciled").map((e) => [e.runId, e.event.value?.id]),
      "one reconciled event, written by the reconcile turn",
    ).toEqual([[reconcileRunId, `${FIXTURE.executionId}.fr0.r`]]);
    const reconcileJson = JSON.stringify(toJson(RunStatusSchema, reconciled), null, 2) + "\n";
    expect(reconcileJson).not.toContain(env.workspaceRootDir);
    await expect(reconcileJson).toMatchFileSnapshot("./goldens/file-review-reconcile.status.json");
    await expect(record.eventsGolden()).toMatchFileSnapshot("./goldens/file-review-reconcile.events.json");
  });

  it("with review off (the default) the same edit flows uncaptured, and a secret-like gitignored write is refused", async () => {
    const repo = join(env.workspaceRootDir, "repos", "notes-review-off");
    initGitWorkspace(repo, { [FILE]: BEFORE, ".gitignore": ".env\n" });
    const record = deepAgentExecutionRecord({
      message: "Append a second line to notes.md and store the key in .env.",
      workspaceEntries: [localPathEntry("notes", repo)],
    });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => ({
        turns: [
          {
            text: "Appending the line and storing the key.",
            toolCalls: [
              { id: CALL_ID, name: "edit_file", args: { file_path: `/${FILE}`, old_string: "first\n", new_string: "first\nsecond\n" } },
              { id: "call-hermetic-secret-0001", name: "write_file", args: { file_path: "/.env", content: "API_KEY=abc\n" } },
            ],
            usage: { inputTokens: 1_300, outputTokens: 60 },
          },
          { text: "Appended; the key was refused.", usage: { inputTokens: 1_500, outputTokens: 10 } },
        ],
      }),
    });

    const invocation = await runDeepAgentTurn(scenario);

    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(readFileSync(join(repo, FILE), "utf-8"), "the edit is applied").toBe(AFTER);
    expect(existsSync(join(repo, ".env")), "the secret-like write never lands").toBe(false);
    expect(record.waitingToolCalls(), "nothing asked").toHaveLength(0);
    const final = record.lastFullStatus!;
    expect(final.fileReviewEventStream?.events ?? [], "nothing is captured with review off").toHaveLength(0);
    expect(record.sessionEvents.some((e) => e.event.case === "stigmerFileReviewChanges")).toBe(false);
    const json = JSON.stringify(toJson(RunStatusSchema, final), null, 2) + "\n";
    expect(json).not.toContain(env.workspaceRootDir);
    await expect(json).toMatchFileSnapshot("./goldens/file-review-off.status.json");
    await expect(record.eventsGolden()).toMatchFileSnapshot("./goldens/file-review-off.events.json");
  });
});
