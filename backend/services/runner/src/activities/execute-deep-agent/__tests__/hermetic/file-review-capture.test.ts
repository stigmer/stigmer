/**
 * Hermetic scenario: a FILE-REVIEW CAPTURE turn on a git workspace through
 * the whole `ExecuteDeepAgent` activity.
 *
 * Invariant pinned (apply-then-review, the universal file-review model): on a
 * git work tree the deepagents `edit_file` FLOWS — the approval gate lets a
 * git-capturable path through under capture mode — and the turn boundary
 * captures the net change from the git diff against the baseline tree pinned
 * before the agent ran (`captureBaselineToLedger`, git snapshot), authors
 * CANDIDATE_CAPTURED to the file_review ledger with one card for the edited
 * file, stamps the flowed edit row with the change-set id
 * (`stampFlowedFileEditRows`), and the activity persists
 * WAITING_FOR_APPROVAL and RETURNS. The change-set id is the deterministic
 * `executionId:turnSeq`. The ledger shape is what M4's capture lift must
 * reproduce, beside Cursor's `file-review-capture.status.json`.
 *
 * Why this arm has a golden file since S3 M2a (Q-M2a-8; S3 M0 finding F-M0-9
 * closed): the orchestrator created the workspace's `.stigmer` symlink
 * unconditionally BEFORE the baseline snapshot, and the link's TARGET is the
 * platform dir under `HOME`, so the baseline and candidate tree OIDs the
 * ledger carries were per-host — and per-run here, where `HOME` is a temp
 * directory. The runtime creates the link only when a skill or attachment
 * needs it (the same rule that makes Cursor's golden byte-stable); this
 * scenario mounts neither, so no link enters either tree and both OIDs are
 * content-derived. Every content-derived byte is still asserted in code
 * (the owner's lock-timeout ruling, entry 20260911.03 M0, is the shape for
 * a status the host could reach), and `goldens/file-review-capture.status.json`
 * pins the whole ledger beside Cursor's.
 *
 * Parent phase rows exercised beyond the plain arms: a `local_path` workspace
 * entry (mounted as-is in local mode, the agent rooted at the entry per
 * `provisionWorkspace`); capture-mode derivation on a git tree; the baseline
 * pin; the turn boundary's candidate capture and row stamping; the pause for
 * review with file cards.
 *
 * Scope, recorded: this arm records turn 1 to parity with Cursor's S0 golden.
 * The second invocation that reconciles a DECIDED change set needs the
 * server's `file_change_sets` projection staged on the record; staging that by
 * hand would pin a hand-built shape, so the reconcile arm rides M4's own net
 * with both harnesses in view.
 *
 * Determinism: the fixture repo's commit and tree ids are byte-stable because
 * `initGitWorkspace` pins author, committer and both dates; the script's path
 * is virtual-absolute (`/notes.md`) so no temp directory can reach the golden.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  DiffCompleteness,
  ExecutionPhase,
  FileCaptureClass,
  FileChangeKind,
  SnapshotKind,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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

  it("lets the write flow, captures it at the boundary, and pauses for review", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const repo = join(env.workspaceRootDir, "repos", "notes");
    initGitWorkspace(repo, { [FILE]: BEFORE });
    const record = deepAgentExecutionRecord({
      message: "Append a second line to notes.md.",
      workspaceEntries: [localPathEntry("notes", repo)],
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

    // ── Assert: the edit flowed and the turn paused for review ───────────────
    expect(readFileSync(join(repo, FILE), "utf-8"), "the working tree holds the candidate").toBe(AFTER);
    expect(invocation.outcome.kind, "a review pause RETURNS to the workflow").toBe("returned");
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe(
      "EXECUTION_WAITING_FOR_APPROVAL",
    );
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
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
    // trees (F-M0-9 closed at M2a, Q-M2a-8): well-formed, distinct, and pinned
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
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final));
    expect(json, "no temp path reaches the status itself").not.toContain(env.workspaceRootDir);
    expect(json, "no host path reaches the status itself").not.toContain(env.home);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const pretty = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(pretty).toMatchFileSnapshot("./goldens/file-review-capture.status.json");
  });
});
