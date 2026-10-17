/**
 * Hermetic scenario: RUN FINISHED WHILE WAITING — an invocation that waited
 * for its workspace finds, once it has the lock, that its run has finished,
 * and runs nothing.
 *
 * Invariant pinned: an invocation that had to wait for the workspace lock
 * reads its run again once it holds it; a run that finished meanwhile
 * (COMPLETED, FAILED, CANCELLED or TERMINATED) is the turn's outcome. The
 * engine is never started, no model is asked, nothing is persisted and
 * nothing is appended to the session's log; the activity returns the
 * stored phase.
 *
 * Why it matters: a pause cancels the running activity, but the
 * cancellation reaches the runner only at its next heartbeat. The paused
 * invocation can finish its turn first and persist the run COMPLETED while
 * the resumed one waits for the workspace it holds. The server then refuses
 * every event of the finished run, so a resumed invocation that ran on
 * would spend a model call whose answer the log drops, and leave the
 * engine's checkpoint holding a reply the session never shows.
 *
 * Determinism: the holder is this test's own lock, released only after the
 * waiting invocation reported its wait and the run was marked finished;
 * the lock's wait is measured on the scripted clock, so it never times out.
 *
 * Regenerate: nothing to regenerate — no snapshot.
 */

import { mkdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

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
import { acquireWorkspaceLock, type ReleaseWorkspaceLock } from "../../../../shared/workspace/workspace-lock.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
  sessionWorkspaceDir,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { recordedModelBuilds } from "../../__test-utils__/scripted-model-module.js";

const WAITING = "Waiting for workspace — in use by another session";

describe("ExecuteDeepAgent hermetic — the run finished while the turn waited for its workspace", () => {
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

  it("returns the finished run's phase and runs, persists and appends nothing", async () => {
    // ── Arrange: another invocation of the run holds the session's workspace ─
    const record = deepAgentExecutionRecord({ message: "Never streams." });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => {
        throw new Error("the model must never be asked for a run that already finished");
      },
    });
    const workspaceDir = sessionWorkspaceDir(env);
    mkdirSync(workspaceDir, { recursive: true });
    let releaseHeldLock: ReleaseWorkspaceLock | undefined = await acquireWorkspaceLock(workspaceDir);

    try {
      // ── Act: the turn waits; the holder finishes the run, then lets go ─────
      const running = runDeepAgentTurn(scenario);
      await vi.waitFor(() => expect(record.setupProgress).toContain(WAITING), { timeout: 10_000, interval: 10 });
      record.execution.status!.phase = RunPhase.RUN_COMPLETED;
      await releaseHeldLock();
      releaseHeldLock = undefined;
      const invocation = await running;

      // ── Assert: the stored outcome, and nothing of this invocation's own ───
      expect(invocation.outcome.kind, "the finished run is the turn's outcome").toBe("returned");
      const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
      expect(slim.phase).toBe("RUN_COMPLETED");
      expect(recordedModelBuilds(), "no model is built for a finished run").toHaveLength(0);
      expect(record.persistedPhases, "no status is written over the finished run").toEqual([]);
      expect(record.sessionEvents, "nothing is appended to the finished run's log").toEqual([]);
      expect(record.refusedAppends).toEqual([]);
      expect(record.setupProgress.at(-1), "the turn stopped at the lock").toBe(WAITING);
    } finally {
      await releaseHeldLock?.();
    }
  });
});
