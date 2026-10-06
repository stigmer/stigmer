/**
 * Hermetic net: a session paused for approval on the engine that still bound
 * a `think` tool resumes on this one, which binds none (#1976). A saved
 * conversation is the engine's memory, and the graph reads every earlier
 * round on resume, so "a history that holds a call to a tool the graph no
 * longer has" is a state the runner must carry, not one it may refuse.
 *
 * The fixture, `./fixtures/paused-session.think-bound.json`, is the checkpoint
 * rows the last engine that bound `think` wrote, recorded on it before the
 * retirement and committed with it, never regenerated. The scenario it froze
 * (thinking left off, the mode that bound the tool):
 *
 *  - round 0: the model calls `think`, which the engine answers;
 *  - round 1: the model proposes a gated `execute`; the gate's `interrupt()`
 *    pauses the graph and the activity persists WAITING_FOR_APPROVAL.
 *
 * What it proves on the CURRENT engine, on sqlite end to end: the rows are
 * loaded into the session's checkpoint file, the server-held status is seeded,
 * APPROVE is decided as `SubmitApproval` would, and the reinvocation resumes
 * inside the gate: the command runs exactly once, the run closes COMPLETED,
 * and the `think` row of round 0 stays in the record as `TOOL_KIND_THINK`, so
 * the transcript still renders it. The proxy wire's half of a resume is the
 * engine-upgrade net's (`resume-across-engine-upgrade.test.ts`): the stored
 * bytes cross it unchanged whatever graph reads them. The real provider's
 * acceptance of the same history is the live twin's
 * (`../resume-across-think-retirement.live.test.ts`).
 *
 * Recording the fixture (once, on the engine that binds `think`; the arm
 * refuses to overwrite it):
 *   RECORD_THINK_RETIREMENT_FIXTURE=1 npx vitest run src/activities/execute-deep-agent/__tests__/hermetic/resume-across-think-retirement.test.ts
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fromJson, toJson } from "@bufbuild/protobuf";
import { AgentRunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import {
  ApprovalAction,
  RunPhase,
  ToolCallStatus,
  ToolKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";

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
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { getCheckpointDbPath } from "../../../../shared/workspace/platform-dir.js";
import {
  FIXTURE,
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";
import type { ScriptedTurn } from "../../__test-utils__/scripted-model.js";
import { CLOSING_TURN, EXECUTE_CALL_A, GATED_OPENING_TURN } from "../../__test-utils__/hitl-script.js";
import {
  THINK_BOUND_FIXTURE_FILE,
  THINK_CALL_ID,
  THINK_RETIREMENT_MESSAGE,
  thinkBoundSession,
} from "../../__test-utils__/think-bound-session.js";
import {
  engineVersions,
  loadRows,
  readRows,
  type PausedSessionFixture,
} from "../../__test-utils__/paused-session-fixture.js";

const DECIDED_AT = "2026-01-01T00:00:30.000Z";
const RESUME_AFTER_MS = 60_000;
const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", THINK_BOUND_FIXTURE_FILE);
const RECORDING = process.env.RECORD_THINK_RETIREMENT_FIXTURE === "1";

/** Round 0: the reasoning note the old engine answered. */
const THINK_TURN: ScriptedTurn = {
  text: "Let me work out the step first.",
  toolCalls: [{ id: THINK_CALL_ID, name: "think", args: { thought: "One command, then report it." } }],
  usage: { inputTokens: 1_200, outputTokens: 40 },
};

const SCRIPT = () => ({ turns: [THINK_TURN, GATED_OPENING_TURN, CLOSING_TURN] });

describe("ExecuteDeepAgent hermetic — a session saved with a think call resumes on an engine that binds none", () => {
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

  it.runIf(RECORDING)("records the paused session on the engine that binds think", async () => {
    expect(existsSync(FIXTURE_PATH), `${FIXTURE_PATH} is frozen; it is recorded once, before the retirement`).toBe(false);

    clock.reset();
    const record = deepAgentExecutionRecord({ message: THINK_RETIREMENT_MESSAGE });
    const scenario = beginDeepAgentScenario({ env, clock, record, checkpointer: "sqlite", script: SCRIPT });
    const turn = await runDeepAgentTurn(scenario, { turnSeq: 0 });
    expect(turn.outcome.kind).toBe("returned");
    expect(record.lastFullStatus?.phase).toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
    const thinkRow = record.toolCalls().find((tc) => tc.id === THINK_CALL_ID);
    expect(thinkRow?.status, "the engine bound and answered think").toBe(ToolCallStatus.TOOL_CALL_COMPLETED);

    const fixture: PausedSessionFixture = {
      recordedWith: engineVersions(),
      threadId: FIXTURE.threadId,
      ...readRows(getCheckpointDbPath(FIXTURE.sessionId)),
      status: toJson(AgentRunStatusSchema, record.lastFullStatus!),
    };
    mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
    writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + "\n");
  });

  it.skipIf(RECORDING)("resumes inside the gate on sqlite: the command runs once, the think row stays", async () => {
    const fixture = thinkBoundSession();

    // ── Arrange: the old engine's rows and the status the server held ───────
    clock.reset();
    const record = deepAgentExecutionRecord({ message: THINK_RETIREMENT_MESSAGE });
    const scenario = beginDeepAgentScenario({ env, clock, record, checkpointer: "sqlite", script: SCRIPT });
    await loadRows(getCheckpointDbPath(FIXTURE.sessionId), fixture);
    record.applyStatusUpdate(fromJson(AgentRunStatusSchema, fixture.status));
    // The approval arrives after the pause, as it does live; the resumed
    // turn's checkpoints must sort after the paused one they continue.
    clock.tick(RESUME_AFTER_MS);
    expect(record.waitingToolCalls().map((tc) => tc.id)).toEqual([EXECUTE_CALL_A.id]);

    // ── Between turns: what SubmitApproval does to the row ───────────────────
    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, DECIDED_AT)).toBe(1);

    // ── Act: the reinvocation on THIS engine ─────────────────────────────────
    const turn = await runDeepAgentTurn(scenario, { turnSeq: 1 });

    // ── Assert ───────────────────────────────────────────────────────────────
    expect(turn.outcome.kind).toBe("returned");
    expect((turn.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    const final = record.lastFullStatus!;
    const calls = final.messages.flatMap((m) => m.toolCalls);
    const executed = calls.filter((tc) => tc.id === EXECUTE_CALL_A.id);
    expect(executed, "exactly one copy of the gated call — a resume, not a replay").toHaveLength(1);
    expect(executed[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(executed[0].result, "the command ran on this engine").toContain("hermetic-a");
    const thought = calls.filter((tc) => tc.id === THINK_CALL_ID);
    expect(thought, "the old engine's think call stays in the record, once").toHaveLength(1);
    expect(thought[0].name).toBe("think");
    expect(thought[0].toolKind, "classified for history, so the transcript still renders it").toBe(ToolKind.THINK);
    expect(thought[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(final.messages.at(-1)?.content).toBe(CLOSING_TURN.text);
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
  });
});
