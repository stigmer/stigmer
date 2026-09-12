/**
 * Hermetic goldens: the two ways a turn is INTERRUPTED from outside, and how
 * the activity tells them apart — the throw-vs-return table the control
 * plane's workflow keys on, recorded on today's code for Q-S3-7's ruled copy
 * alignments (P-1: the runtime's pause copy is Cursor's).
 *
 *  1. USER PAUSE: the activity's `cancellationSignal` aborts. Whether the
 *     abort lands inside a model call (staged from the scripted model's
 *     `onTurn`) or while the loop is persisting (staged from the control
 *     plane's persist channel, the record's `controlSignal`), the stream
 *     loop's `isCancelledFn` sees it on the next event and PERSISTS PAUSED
 *     WITH the transcript and the row "Execution paused by user. Use resume
 *     to continue from this checkpoint." (`streaming-terminal.ts`), then
 *     throws `CancelledFailure("Activity paused by orchestrator")` — which
 *     the activity's OWN outer catch catches and answers with a SECOND
 *     persist: a bare PAUSED carrying NO messages. The last status on the
 *     wire erases the transcript the first one carried. Recorded as found
 *     (S3 M0 finding F-M0-6, for the owner): this is stigmer#1054's double
 *     persist, fixed in the runtime by stigmer#1071 ("persist a thrown
 *     terminal once"), still present on native because native does not run
 *     the runtime yet; the runtime's `settleWith` closes it at M2b. Both
 *     writes are goldens. The loop's write differs by where the cancel
 *     landed — after the tool finished (`pause.loop.after-tool`) or while it
 *     was still RUNNING (`pause.loop.mid-tool`, the cancel arriving on the
 *     persist that carried the row); the bare write is the same status from
 *     either staging and both match `pause.bare.status.json`.
 *  2. WORKER SHUTDOWN: the queue's shutdown signal is aborted before the
 *     cancel, so the PAUSED the loop marked is rewritten as EXECUTION_FAILED
 *     with the interrupted copy and one row, and the throw is
 *     `CancelledFailure("Activity cancelled (worker shutdown, not user pause)")`
 *     (#776) — the workflow re-invokes instead of waiting for a resume. This
 *     copy is byte-identical to the runtime's (`buildWorkerShutdownStatus`).
 *
 * Every interruption is staged deterministically — from a model turn or from
 * a persist, never from a timer.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import {
  AgentExecutionStatusSchema,
  type AgentExecutionStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionControlSignal,
  ExecutionPhase,
  MessageType,
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
  threwCancelledFailure,
  type HermeticEnvironment,
  type InvocationControls,
} from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
  type DeepAgentScenario,
} from "../../__test-utils__/hermetic-deep-agent.js";
import type { RoleScript } from "../../__test-utils__/scripted-model.js";

const READ_CALL = { id: "call-hermetic-read-0001", name: "read_file", args: { file_path: "/notes.md" } };

/** A turn that reads, then would speak again — the interruption lands before it can. */
const SCRIPT: RoleScript = {
  turns: [
    { text: "Let me look.", toolCalls: [READ_CALL], usage: { inputTokens: 1_200, outputTokens: 30 } },
    { text: "Never reaches the record.", usage: { inputTokens: 1_400, outputTokens: 10 } },
  ],
};

describe("ExecuteDeepAgent hermetic — pause vs worker shutdown", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();
  /** The scenario whose invocation is running — the persist-channel staging cancels it. */
  let inFlight: DeepAgentScenario | undefined;

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

  describe.each([
    {
      staging: "inside a model call",
      begin: (record: ReturnType<typeof deepAgentExecutionRecord>) =>
        beginDeepAgentScenario({
          env,
          clock,
          record,
          script: () => SCRIPT,
          onTurn: (info, controls) => {
            if (info.round === 1) controls.cancel();
          },
        }),
      controlSignal: undefined as ((status: AgentExecutionStatus) => ExecutionControlSignal) | undefined,
      loopGolden: "./goldens/pause.loop.after-tool.status.json",
    },
    {
      staging: "between events",
      begin: (record: ReturnType<typeof deepAgentExecutionRecord>) =>
        beginDeepAgentScenario({ env, clock, record, script: () => SCRIPT }),
      // The platform answers the persist that carries the first tool row by
      // cancelling the activity (the workflow's pause).
      controlSignal: (status: AgentExecutionStatus) => {
        if (status.messages.some((m) => m.toolCalls.length > 0)) inFlight?.controls?.cancel();
        return ExecutionControlSignal.UNSPECIFIED;
      },
      loopGolden: "./goldens/pause.loop.mid-tool.status.json",
    },
  ])("user pause $staging", ({ begin, controlSignal, loopGolden }) => {
    it("persists PAUSED with the row, then bare (F-M0-6), and throws as a pause", async () => {
      clock.reset();
      const record = deepAgentExecutionRecord({ message: "Look at my notes.", controlSignal });
      inFlight = begin(record);

      const invocation = await runDeepAgentTurn(inFlight);

      expect(threwCancelledFailure(invocation.outcome), "a pause THROWS CancelledFailure").toBe(true);
      expect((invocation.outcome as { error: Error }).error.message).toBe("Activity paused by orchestrator");
      expect(record.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_PAUSED]);

      const pausedWrites = record.persisted.filter((s) => s.phase === ExecutionPhase.EXECUTION_PAUSED);
      expect(pausedWrites, "PAUSED is persisted twice").toHaveLength(2);
      const [fromLoop, fromCatch] = pausedWrites;
      expect(fromLoop.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content)).toEqual([
        "Execution paused by user. Use resume to continue from this checkpoint.",
      ]);
      expect(
        fromLoop.messages.flatMap((m) => m.toolCalls).map((tc) => tc.name),
        "the read that landed before the pause is in the loop's write",
      ).toEqual(["read_file"]);
      expect(fromCatch.messages, "the catch's write carries no messages").toHaveLength(0);
      expect(fromCatch.completedAt).toBe("");
      expect(record.lastFullStatus, "the wire ends on the bare write").toEqual(fromCatch);

      const loopJson = JSON.stringify(toJson(AgentExecutionStatusSchema, fromLoop), null, 2) + "\n";
      await expect(loopJson).toMatchFileSnapshot(loopGolden);
      const bareJson = JSON.stringify(toJson(AgentExecutionStatusSchema, fromCatch), null, 2) + "\n";
      await expect(bareJson).toMatchFileSnapshot("./goldens/pause.bare.status.json");
    });
  });

  it("worker shutdown: FAILED with the interrupted copy, thrown as a shutdown", async () => {
    clock.reset();
    const record = deepAgentExecutionRecord({ message: "Look at my notes." });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => SCRIPT,
      onTurn: (info, controls: InvocationControls) => {
        if (info.round === 1) {
          controls.signalWorkerShutdown();
          controls.cancel();
        }
      },
    });

    const invocation = await runDeepAgentTurn(scenario);

    expect(threwCancelledFailure(invocation.outcome), "a drain THROWS so the workflow re-invokes").toBe(true);
    expect((invocation.outcome as { error: Error }).error.message).toBe(
      "Activity cancelled (worker shutdown, not user pause)",
    );
    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_FAILED);
    const final = record.lastFullStatus!;
    expect(final.error).toBe("Execution interrupted: runner worker was shut down. Retry or resume.");
    expect(final.messages.map((m) => [m.type, m.content])).toEqual([
      [
        MessageType.MESSAGE_SYSTEM,
        "Execution interrupted: the runner worker was shut down while the agent was still running. You can retry or resume.",
      ],
    ]);
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/worker-shutdown.status.json");
  });
});
