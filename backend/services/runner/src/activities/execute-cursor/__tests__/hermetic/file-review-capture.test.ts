/**
 * Hermetic golden: a FILE-REVIEW CAPTURE turn on a git workspace through the
 * whole `ExecuteCursor` activity.
 *
 * Invariant pinned (apply-then-review, the universal file-review model): on a
 * git work tree the file edit FLOWS — the hook the activity installed ALLOWS
 * the write (capture mode gates only gitignored paths, shell and MCP) — and the
 * turn boundary captures the net change from the git diff against the baseline
 * tree pinned before the agent ran, authors CANDIDATE_CAPTURED to the
 * file_review ledger with one card for the edited file, stamps the flowed edit
 * row with the change-set id, and the activity persists WAITING_FOR_APPROVAL
 * and RETURNS without consulting `run.wait()`. The change-set id is the
 * deterministic `executionId:turnSeq`. The golden
 * (`goldens/file-review-capture.status.json`) pins the ledger shape S2 must
 * reproduce.
 *
 * Parent phase rows exercised beyond `deny-and-retry`: provision a `local_path`
 * workspace entry (mounted as-is in local mode); capture-mode derivation on a
 * git tree; the baseline pin (`captureBaselineToLedger`, git snapshot); the
 * turn boundary's candidate capture (`captureTurnToLedger`) and row stamping;
 * the pause for review with file cards.
 *
 * Determinism: the fixture repo's commit and tree ids are byte-stable because
 * `initGitWorkspace` pins author, committer and both dates. The stream's edit
 * args use the REPO-RELATIVE path so no temp directory can reach the golden;
 * the hook input carries the absolute path the SDK would pass (the hook's
 * `git check-ignore` resolves it against the baked workspace root).
 *
 * Skipped where `bash` is unavailable — reported as SKIPPED, never a silent pass.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("@cursor/sdk", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { hasBash, hookWrite } from "../../__test-utils__/cursor-hook-harness.js";
import { ScriptedCursorAgent, sdkEvents, step } from "../../__test-utils__/scripted-agent.js";
import {
  FIXTURE,
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  initGitWorkspace,
  localPathEntry,
  runCursorTurn,
  runWorkspaceHook,
  stubRegistryFetch,
} from "../../__test-utils__/hermetic-cursor.js";

const AGENT_ID = "agent-hermetic-capture-0001";
const RUN_ID = "run-hermetic-capture-0001";
const CALL_ID = "call-hermetic-edit-0001";
const USER_MESSAGE = "Add a line to notes.md saying the fixture was reviewed.";
const FILE = "notes.md";
const BEFORE = "# Notes\n\nA fixture file.\n";
const AFTER = "# Notes\n\nA fixture file.\n\nReviewed by the hermetic run.\n";
const CHANGE_SET_ID = `${FIXTURE.executionId}:0`;

describe.skipIf(!hasBash)("ExecuteCursor hermetic — file-review capture on a git workspace", () => {
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

  it("lets the edit flow, captures it at the boundary, and pauses for review", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const repo = join(env.workspaceRootDir, "repos", "notes");
    initGitWorkspace(repo, { [FILE]: BEFORE });
    const absFile = join(repo, FILE);
    const hookDecisions: string[] = [];

    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant("Appending the review line.")),
          // The SDK runs the hook before the write tool executes...
          step.effect("hook: Write (expect allow in capture mode)", () => {
            hookDecisions.push(runWorkspaceHook(repo, hookWrite(absFile, AFTER)).permission);
          }),
          // ...then performs the write itself...
          step.effect("write notes.md", () => writeFileSync(absFile, AFTER, "utf-8")),
          // ...and streams the tool call.
          step.event(ev.toolCall(CALL_ID, "edit", "running", { path: FILE, content: AFTER })),
          step.event(ev.toolCall(CALL_ID, "edit", "completed", { path: FILE, content: AFTER }, "ok")),
          step.event(ev.assistant("Done — notes.md now records the review.")),
          step.turnEnded({ inputTokens: 2_400, outputTokens: 70 }),
          step.finished({ result: "Done", model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({
      message: USER_MESSAGE,
      workspaceEntries: [localPathEntry("notes", repo)],
    });
    const scenario = beginCursorScenario({
      env,
      clock,
      record,
      sdk: { agents: [agent], catalog: SDK_CATALOG },
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario);

    // ── Assert: the edit flowed and the turn paused for review ───────────────
    expect(hookDecisions, "capture mode lets the write flow").toEqual(["allow"]);
    expect(readFileSync(absFile, "utf-8"), "the working tree holds the candidate").toBe(AFTER);
    expect(invocation.outcome.kind, "a review pause RETURNS to the workflow").toBe("returned");
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe(
      "EXECUTION_WAITING_FOR_APPROVAL",
    );
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    ]);
    expect(agent.runs[0].cancelCalls, "a flowed edit is not a denial; nothing is cancelled").toHaveLength(0);

    // ── Assert: the file_review ledger ───────────────────────────────────────
    const events = record.status?.fileReviewEventStream?.events ?? [];
    const types = events.map((e) => e.payload.case);
    expect(types).toEqual(["baselineCaptured", "candidateCaptured"]);
    const candidate = events[1].payload;
    if (candidate.case !== "candidateCaptured") throw new Error("unreachable");
    expect(candidate.value.changeSetId).toBe(CHANGE_SET_ID);
    expect(candidate.value.changes.map((c) => c.pathAfter)).toEqual([FILE]);

    // The flowed edit row: the built-in policy still classifies `edit` as a
    // gated category (`requiresApproval: true` is the policy's verdict, stamped
    // at fold time), but capture mode let it FLOW — so the row is COMPLETED,
    // never WAITING_APPROVAL, and the review happens on the file card instead.
    const rows = record.toolCalls();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("edit");
    expect(rows[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(rows[0].requiresApproval, "policy verdict, not the gate outcome").toBe(true);
    expect(record.waitingToolCalls(), "no gate row — the review is on the file card").toHaveLength(0);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, record.lastFullStatus!), null, 2) + "\n";
    expect(json, "no temp path may reach the golden").not.toContain(env.workspaceRootDir);
    await expect(json).toMatchFileSnapshot("./goldens/file-review-capture.status.json");
  });
});
