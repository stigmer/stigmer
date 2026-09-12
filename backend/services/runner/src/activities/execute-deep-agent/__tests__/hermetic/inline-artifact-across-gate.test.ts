/**
 * Hermetic goldens: an INLINE-PUBLISHED ARTIFACT survives a HITL gate — the
 * arbiter for Q-S3-16 (the seed's breadth), two invocations on the durable
 * (sqlite) checkpointer.
 *
 * Turn 1: the model writes a report (`write_file`; under capture mode in a
 * non-git session workspace the write FLOWS into the CAS ledger), and
 * `streaming-side-effects.ts` hands the path to `InlinePublisher`, which
 * uploads the bytes to artifact storage and appends an `ExecutionArtifact`
 * (`storageKey = artifacts/<executionId>/<name>`, a content hash, the
 * scripted clock) to the status — a mid-turn publish the Cursor harness never
 * performs. The model then proposes a gated `execute`; WAITING_FOR_APPROVAL.
 *
 * Turn 2: after APPROVE, the reinvocation seeds its status from the persisted
 * one. On this harness `seedStatusFromExecution` clones the WHOLE status, so
 * the artifact list arrives intact and the run's final status still lists the
 * report. The server replaces `artifacts` wholesale whenever the request's
 * list is non-empty (`update-status.ts`), so a runtime that seeded messages
 * only and then published nothing new would carry an empty list — and the
 * server would keep the old one, but a runtime that published one NEW
 * artifact from an empty list would ERASE the prior one. Q-S3-16's
 * `seedFromPersistedStatus` carries `artifacts` for exactly this reason;
 * this pair of goldens (`inline-artifact.turn1`, `inline-artifact.turn2`) is
 * what proves it did.
 *
 * Also recorded, F-M0-8 (a shape fact for the owner): the write's tool row
 * shows `requiresApproval: true` with `approvalPolicySource` BUILTIN_CATEGORY
 * — the category policy's verdict — while the row is COMPLETED because
 * capture mode let it flow; the artifact carries no URL (the local store's
 * serve URL never enters the record).
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import {
  AgentExecutionStatusSchema,
  type AgentExecutionStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalAction,
  ExecutionPhase,
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
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import {
  FIXTURE,
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { CLOSING_TURN, EXECUTE_CALL_A } from "../../__test-utils__/hitl-script.js";

const REPORT = "report.md";
const REPORT_BODY = "# Report\n\nAll fixtures nominal.\n";
const WRITE_CALL_ID = "call-hermetic-write-0001";
const DECIDED_AT = "2026-01-01T00:00:30.000Z";

function statusJson(status: AgentExecutionStatus): string {
  return JSON.stringify(toJson(AgentExecutionStatusSchema, status), null, 2) + "\n";
}

describe("ExecuteDeepAgent hermetic — inline artifact across a gate (sqlite)", () => {
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

  it("publishes the report inline in turn 1 and still lists it after the approved turn 2", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const record = deepAgentExecutionRecord({ message: "Write the report, then run the command." });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      checkpointer: "sqlite",
      script: () => ({
        turns: [
          {
            text: "Writing the report.",
            toolCalls: [{ id: WRITE_CALL_ID, name: "write_file", args: { file_path: `/${REPORT}`, content: REPORT_BODY } }],
            usage: { inputTokens: 1_300, outputTokens: 60 },
          },
          { text: "Now the command.", toolCalls: [EXECUTE_CALL_A], usage: { inputTokens: 1_500, outputTokens: 40 } },
          CLOSING_TURN,
        ],
      }),
    });

    // ── Turn 1 ───────────────────────────────────────────────────────────────
    const turn1 = await runDeepAgentTurn(scenario, { turnSeq: 0 });
    expect(turn1.outcome.kind).toBe("returned");
    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL);
    const run1 = record.lastFullStatus!;
    expect(run1.artifacts.map((a) => [a.name, a.storageKey])).toEqual([
      [REPORT, `artifacts/${FIXTURE.executionId}/${REPORT}`],
    ]);
    expect(run1.artifacts[0].contentHash, "sha256 of the bytes").toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(env.artifactPath, run1.artifacts[0].storageKey)), "the bytes reached the store").toBe(true);
    const writeRow = record.toolCalls().find((tc) => tc.id === WRITE_CALL_ID)!;
    expect(writeRow.status, "capture mode let the write flow").toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(record.waitingToolCalls().map((tc) => tc.id)).toEqual([EXECUTE_CALL_A.id]);
    await expect(statusJson(run1)).toMatchFileSnapshot("./goldens/inline-artifact.turn1.status.json");

    // ── Between turns ────────────────────────────────────────────────────────
    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, DECIDED_AT)).toBe(1);

    // ── Turn 2 ───────────────────────────────────────────────────────────────
    const turn2 = await runDeepAgentTurn(scenario, { turnSeq: 1 });
    expect(turn2.outcome.kind).toBe("returned");
    expect((turn2.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_COMPLETED");
    const final = record.lastFullStatus!;
    expect(final.artifacts.map((a) => [a.name, a.storageKey, a.contentHash]), "the seed carried the artifact").toEqual(
      run1.artifacts.map((a) => [a.name, a.storageKey, a.contentHash]),
    );
    expect(final.messages.flatMap((m) => m.toolCalls).map((tc) => [tc.id, tc.status])).toEqual([
      [WRITE_CALL_ID, ToolCallStatus.TOOL_CALL_COMPLETED],
      [EXECUTE_CALL_A.id, ToolCallStatus.TOOL_CALL_COMPLETED],
    ]);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    const finalJson = statusJson(final);
    expect(finalJson, "no temp path may reach the golden").not.toContain(env.artifactPath);
    await expect(finalJson).toMatchFileSnapshot("./goldens/inline-artifact.turn2.status.json");
  });
});
