/**
 * Hermetic: a THROWN TURN still carries every artifact it published — the
 * native harness drains its in-flight inline publishes before the runtime
 * writes the terminal status (stigmer#1116).
 *
 * The model writes a report in round one (`write_file`), and
 * `streaming-side-effects.ts` hands the path to `InlinePublisher`, whose
 * upload runs beside the stream. Round two's model call fails mid-stream
 * (the scripted model's `fail` ending: a provider error), so the turn never
 * reaches its settle — the one place that used to drain the publishes. The
 * adapter classifies the throw as `failed`, and the runtime writes the
 * turn's terminal status as soon as the adapter returns. The report is an
 * edit on the tree, and the hermetic environment runs in capture mode (it
 * carries artifact storage, as every hosted runner does), so that status is
 * the file review's WAITING_FOR_APPROVAL with the failure's rows riding it
 * and its phase deferred (`terminal-table.ts` `awaitingReviewArm`): the
 * production shape of this fault.
 *
 * The order is made deterministic, not left to I/O timing: the upload is
 * held until the turn asks for its publishes to drain, or until the
 * activity has returned, whichever comes first. With the drain on the
 * turn's every exit, the drain asks first and the artifact is on the
 * persisted status. Without it the activity returns first, the upload
 * lands afterwards on a status nobody persists again, and the assertion on
 * the persisted artifacts fails — the defect this pins.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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
import { LocalArtifactStorage } from "../../../../shared/artifact-storage.js";
import { StreamingSideEffects } from "../../streaming-side-effects.js";
import { TERMINAL_COPY } from "../../../../harness/terminal-table.js";

const REPORT = "report.md";
const REPORT_BODY = "# Report\n\nWritten before the provider failed.\n";
const WRITE_CALL_ID = "call-hermetic-write-0001";
const PROVIDER_FAULT = "provider stream failed mid-turn";

function systemMessages(status: AgentExecutionStatus): string[] {
  return status.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content);
}

describe("ExecuteDeepAgent hermetic — a thrown turn drains its inline publishes", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  it("persists the turn's end with the artifact it published before the model call threw", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const record = deepAgentExecutionRecord({ message: "Write the report." });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => ({
        turns: [
          {
            text: "Writing the report.",
            toolCalls: [{ id: WRITE_CALL_ID, name: "write_file", args: { file_path: `/${REPORT}`, content: REPORT_BODY } }],
            usage: { inputTokens: 1_300, outputTokens: 60 },
          },
          { text: "Now summarising", ends: { kind: "fail", error: new Error(PROVIDER_FAULT) } },
        ],
      }),
    });

    // The artifact's upload waits on `held`; the first of "the turn drains"
    // and "the activity returned" releases it (the header's deterministic
    // order). Capture mode's own blobs share the store and are never held:
    // the runtime writes them after the adapter returns.
    const artifactKey = `artifacts/${FIXTURE.executionId}/${REPORT}`;
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const upload = LocalArtifactStorage.prototype.upload;
    const uploads = vi.spyOn(LocalArtifactStorage.prototype, "upload").mockImplementation(async function (
      this: LocalArtifactStorage,
      ...args: Parameters<LocalArtifactStorage["upload"]>
    ) {
      if (args[0] === artifactKey) await held;
      return upload.apply(this, args);
    });
    const drain = StreamingSideEffects.prototype.drainPublishes;
    const drains = vi.spyOn(StreamingSideEffects.prototype, "drainPublishes").mockImplementation(async function (
      this: StreamingSideEffects,
    ) {
      release();
      return drain.apply(this);
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runDeepAgentTurn(scenario);
    release();

    // ── Assert: the turn failed, deferred behind the review, and returned ────
    expect(invocation.outcome.kind, "a provider failure RETURNS the status").toBe("returned");
    const final = record.lastFullStatus!;
    expect(final.phase, "the edit reaches review before the failure settles").toBe(
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    );
    expect(final.error, "a deferred terminal writes no error yet").toBe("");
    expect(systemMessages(final), "the failure's rows ride the review").toEqual([
      TERMINAL_COPY.internalFailure.row,
      `Error details: [Error] ${PROVIDER_FAULT}`,
    ]);

    // ── Assert: the artifact reached the terminal status ─────────────────────
    expect(
      uploads.mock.calls.map(([key]) => key).filter((key) => key === artifactKey),
      "the write was published inline, once",
    ).toHaveLength(1);
    expect(final.artifacts.map((a) => [a.name, a.storageKey])).toEqual([[REPORT, artifactKey]]);
    expect(drains, "the thrown turn drained its publishes").toHaveBeenCalled();
    expect(existsSync(join(env.artifactPath, final.artifacts[0].storageKey)), "the bytes reached the store").toBe(true);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
  });
});
