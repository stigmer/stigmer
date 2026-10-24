/*
 * Spike probe: the defer round trip through Stigmer's own
 * turn runtime. The throwaway adapter runs the real engine behind
 * `loopbackHostedRow` (the remote adapter in front, the adapter in an agent
 * host behind an in-process pipe), under `runActivityHermetically`, twice:
 *
 *  - invocation one persists RUN_WAITING_FOR_APPROVAL with one waiting row
 *    whose id is the deferred call's id, and returns;
 *  - the person's answer is written to the session's log, as the server
 *    writes it, and invocation two reads it into `approvalDecisions`,
 *    resumes the engine with no prompt, runs that call, and settles its row;
 *  - a REJECT settles the row without running the call.
 *
 * The adapter is put in the Cursor row (activity `ExecuteCursor`) so nothing
 * on `main` changes; the stand-in proxy behind `loopbackHostedRow` dials
 * nothing, so the engine is pointed straight at the mock (the proxy probe proves
 * the proxy path on its own). Every SDK message, every event the adapter
 * applied and every usage report is traced for questions 7 and 8.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../client/stigmer-client.js", async () =>
  (await import("../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  bindHermeticClient,
  createHermeticEnvironment,
  runActivityHermetically,
  statusGolden,
  type ActivityInvocation,
  type HermeticEnvironment,
  type ExecutionRecord,
} from "../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../__test-utils__/model-registry-fixture.js";
import {
  FIXTURE,
  cursorExecutionRecord,
  hermeticCursorConfig,
  resetCursorModuleState,
  sessionWorkspaceDir,
} from "../../activities/execute-cursor/__test-utils__/hermetic-cursor.js";
import { ApprovalAction, ToolCallStatus } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import type { HarnessRow } from "../../harness/registry.js";
import type { Config } from "../../config.js";
import { createClaudeSpikeAdapter } from "./adapter.js";
import {
  SPIKE_MODEL,
  appendEvidence,
  freshDirs,
  spikeEnv,
  startSpikeMock,
  toolId,
  writeEvidence,
  type SpikeMock,
} from "./harness.js";
import { oneCall, scenarios } from "./scripts.js";

const TIMEOUT = 240_000;

interface Scenario {
  env: HermeticEnvironment;
  record: ExecutionRecord;
  config: Config;
  row: HarnessRow;
  engineSessionId(): string | undefined;
}

function begin(label: string, message: string, mock: SpikeMock): Scenario {
  const env = createHermeticEnvironment();
  resetCursorModuleState();
  const record = cursorExecutionRecord({ message });
  bindHermeticClient(record.client());
  const config = { ...hermeticCursorConfig(env) };
  const dirs = freshDirs(label);
  let engineSession: string | undefined;
  const adapter = createClaudeSpikeAdapter({
    model: SPIKE_MODEL,
    envFor: () => spikeEnv({ mockUrl: mock.url, dirs }),
    onTrace: (entry) => {
      if (entry.message !== undefined && "session_id" in entry.message && engineSession === undefined) {
        engineSession = entry.message.session_id;
      }
      appendEvidence(`${label}.trace.jsonl`, entry);
    },
  });
  return { env, record, config, row: { harness: "cursor", adapter }, engineSessionId: () => engineSession };
}

async function invoke(s: Scenario, hosted: HarnessRow, threadId: string, turnSeq: number): Promise<ActivityInvocation> {
  const { createHarnessActivities } = await import("../../harness/registry.js");
  await hosted.adapter.boot(s.config);
  const activities = await createHarnessActivities([hosted], s.config);
  return runActivityHermetically(activities.ExecuteCursor!, [{ execution_id: s.record.executionId, thread_id: threadId, turn_seq: turnSeq }], {
    taskQueue: "hermetic-test-queue",
  });
}

describe("q1 (iii): the defer round trip through the runtime", () => {
  let registry: ReturnType<typeof stubRegistryFetch>;
  beforeEach(() => {
    registry = stubRegistryFetch();
  });
  afterEach(() => {
    registry.restore();
  });

  for (const action of ["approve", "reject"] as const) {
    it(`a deferred Bash call waits for the person, then ${action === "approve" ? "runs exactly once" : "never runs"}`, async () => {
      const label = `adapter-${action}`;
      const BASH = toolId(`adapter_${action}`);
      const marker = `Q1III-${action.toUpperCase()}`;
      let proof = "";
      const mock = await startSpikeMock(
        label,
        (c) => scenarios([oneCall(marker, { toolCallId: BASH, toolName: "Bash", toolInput: { command: `echo approved-by-person > ${proof}`, description: "write" } }, `${marker} done`)])(c),
      );
      const s = begin(label, `${marker} run the command`, mock);
      proof = join(sessionWorkspaceDir(s.env), "proof.txt");
      const { loopbackHostedRow } = await import("../../__test-utils__/loopback-host.js");
      const hosted = loopbackHostedRow(s.row);
      try {
        const turn1 = await invoke(s, hosted, "", 0);
        const waiting = s.record.waitingToolCalls();
        const facts1 = {
          outcome: turn1.outcome.kind,
          phase: turn1.outcome.kind === "returned" ? (turn1.outcome.value as Record<string, unknown>).phase : undefined,
          persistedPhases: s.record.persistedPhases,
          waiting: waiting.map((w) => ({ id: w.id, name: w.name, args: w.args, requiresApproval: w.requiresApproval })),
          proofAfter1: existsSync(proof),
          status: s.record.lastFullStatus === undefined ? undefined : JSON.parse(statusGolden(s.record.lastFullStatus)),
        };
        writeEvidence(`${label}.turn1.facts.json`, facts1);
        expect.soft(facts1.phase, "invocation one waits for approval").toBe("RUN_WAITING_FOR_APPROVAL");
        expect.soft(waiting.map((w) => w.id), "one waiting row, the deferred call's id").toEqual([BASH]);
        expect.soft(facts1.proofAfter1).toBe(false);

        const answered = s.record.decideWaitingToolCalls(
          action === "approve" ? ApprovalAction.APPROVE : ApprovalAction.REJECT,
          new Date().toISOString(),
          undefined,
          action === "reject" ? "Not this command." : "",
        );
        const turn2 = await invoke(s, hosted, s.engineSessionId() ?? FIXTURE.agentId, 1);
        const row = s.record.toolCalls().find((tc) => tc.id === BASH);
        const facts2 = {
          answered,
          outcome: turn2.outcome.kind,
          phase: turn2.outcome.kind === "returned" ? (turn2.outcome.value as Record<string, unknown>).phase : undefined,
          persistedPhases: s.record.persistedPhases,
          row: row === undefined ? undefined : { id: row.id, status: ToolCallStatus[row.status], result: row.result, approvalAction: ApprovalAction[row.approvalAction] },
          rowsNamedBash: s.record.toolCalls().filter((tc) => tc.name === "Bash").length,
          proof: existsSync(proof) ? readFileSync(proof, "utf8").trim() : null,
          status: s.record.lastFullStatus === undefined ? undefined : JSON.parse(statusGolden(s.record.lastFullStatus)),
        };
        writeEvidence(`${label}.turn2.facts.json`, facts2);
        expect.soft(facts2.phase).toBe("RUN_COMPLETED");
        expect.soft(facts2.rowsNamedBash, "one row for the call, never a second").toBe(1);
        if (action === "approve") {
          expect.soft(facts2.row?.status).toBe("TOOL_CALL_COMPLETED");
          expect.soft(facts2.proof, "the approved call ran, exactly as proposed").toBe("approved-by-person");
        } else {
          expect.soft(facts2.proof, "a rejected call never runs").toBeNull();
          expect.soft(facts2.row?.status).not.toBe("TOOL_CALL_WAITING_APPROVAL");
        }
      } finally {
        await hosted.adapter.shutdown();
        await mock.close();
        s.env.dispose();
      }
    }, TIMEOUT);
  }
});
