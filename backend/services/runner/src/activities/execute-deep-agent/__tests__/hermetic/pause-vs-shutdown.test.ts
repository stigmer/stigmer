/**
 * Hermetic goldens: the two ways a turn is INTERRUPTED from outside, and how
 * the activity tells them apart — the throw-vs-return table the control
 * plane's workflow keys on. Since #1096 the activity is the turn runtime
 * over the native adapter, and the shapes below are the runtime's terminal
 * table (`harness/terminal-table.ts`; the pause copy is Cursor's) and
 * stigmer#1071 ("persist a thrown terminal once").
 *
 *  1. USER PAUSE: the activity's `cancellationSignal` aborts. Whether the
 *     abort lands inside a model call (staged from the scripted model's
 *     `onTurn`) or while the loop is persisting (staged from the control
 *     plane's persist channel, the record's `controlSignal`), the runtime's
 *     stop controller aborts the adapter's signal, the adapter cancels the
 *     graph run and settles `interrupted`, and the runtime persists PAUSED
 *     ONCE — WITH the transcript and the row "Execution paused by user. Use
 *     resume to continue." (the runtime's pause copy is Cursor's; the
 *     orchestrator's said "… from this checkpoint.") — then throws
 *     `CancelledFailure("Activity paused by orchestrator")`. Until #1096 the
 *     orchestrator persisted PAUSED TWICE, the second write bare and erasing
 *     the transcript (stigmer#1054's double persist);
 *     `pause.bare.status.json` recorded that write and is gone with it. The
 *     one write differs by where the cancel landed — after the tool finished
 *     (`pause.loop.after-tool`) or while it was still RUNNING
 *     (`pause.loop.mid-tool`, the cancel arriving on the persist that carried
 *     the row).
 *  2. WORKER SHUTDOWN: the queue's shutdown signal is aborted before the
 *     cancel, so the interruption is EXECUTION_FAILED with the interrupted
 *     copy and one row, thrown as
 *     `CancelledFailure("Activity cancelled (worker shutdown, not user pause)")`
 *     (#776) — the workflow re-invokes instead of waiting for a resume. The
 *     copy is unchanged; what changed in #1096 (the runtime's arm
 *     wins) is that the runtime's arm KEEPS the transcript the turn produced
 *     and appends the row, where the orchestrator's `buildWorkerShutdownStatus`
 *     replaced the whole status with the row alone.
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
    it("persists PAUSED once, with the transcript and the row, and throws as a pause", async () => {
      clock.reset();
      const record = deepAgentExecutionRecord({ message: "Look at my notes.", controlSignal });
      inFlight = begin(record);

      const invocation = await runDeepAgentTurn(inFlight);

      expect(threwCancelledFailure(invocation.outcome), "a pause THROWS CancelledFailure").toBe(true);
      expect((invocation.outcome as { error: Error }).error.message).toBe("Activity paused by orchestrator");
      expect(record.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_PAUSED]);

      const pausedWrites = record.persisted.filter((s) => s.phase === ExecutionPhase.EXECUTION_PAUSED);
      expect(pausedWrites, "PAUSED is persisted exactly once (stigmer#1071)").toHaveLength(1);
      const [paused] = pausedWrites;
      expect(paused.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content)).toEqual([
        "Execution paused by user. Use resume to continue.",
      ]);
      expect(
        paused.messages.flatMap((m) => m.toolCalls).map((tc) => tc.name),
        "the read that landed before the pause is in the one write",
      ).toEqual(["read_file"]);
      expect(paused.completedAt).toBe("");
      expect(record.lastFullStatus, "the wire ends on the write that carries the transcript").toEqual(paused);

      const json = JSON.stringify(toJson(AgentExecutionStatusSchema, paused), null, 2) + "\n";
      await expect(json).toMatchFileSnapshot(loopGolden);
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
    // The transcript the turn produced is kept and the row appended (the
    // runtime's arm); the tool row sits on the message whose text
    // proposed it (since #1097 — until then on its own empty message).
    expect(final.messages.map((m) => [m.type, m.content])).toEqual([
      [MessageType.MESSAGE_AI, "Let me look."],
      [
        MessageType.MESSAGE_SYSTEM,
        "Execution interrupted: the runner worker was shut down while the agent was still running. You can retry or resume.",
      ],
    ]);
    expect(final.messages.flatMap((m) => m.toolCalls).map((tc) => tc.name), "the read that landed before the drain is kept").toEqual(["read_file"]);
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/worker-shutdown.status.json");
  });
});
