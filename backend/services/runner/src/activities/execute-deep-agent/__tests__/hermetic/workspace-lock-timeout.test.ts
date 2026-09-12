/**
 * Hermetic scenario: WORKSPACE LOCK TIMEOUT — a turn that cannot acquire its
 * workspace within the configured wait fails with an actionable reason and
 * RETURNS.
 *
 * Invariant pinned: the activity serializes on the workspace root
 * (`shared/workspace/workspace-lock.ts`); while another turn holds the lock it
 * reports a visible waiting state and heartbeats; past
 * `Config.workspaceLockTimeoutMs` it maps `WorkspaceLockTimeoutError` to
 * EXECUTION_FAILED with the lock's own message (which names the directory)
 * and one system row, persists ONCE, and returns — a Temporal retry would only
 * queue behind the same holder.
 *
 * What this arm records about TODAY's order, for Q-S3-8's ruled alignment:
 * on this harness the lock is taken AFTER the whole of `performSetup` — the
 * model is built, the sub-agents compiled and the graph created before the
 * wait begins (`index.ts` L249, after L156). The runtime takes the lock before
 * the tool surface. The `setupProgress` sequence asserted below is the
 * pre-alignment shape M2b's predicted diff is measured against.
 *
 * Why this is the one terminal arm WITHOUT a file golden (owner ruling,
 * 2026-09-11, entry 20260911.03 M0; carried for native): the wire copy embeds
 * the absolute workspace path, a per-run temp directory. The S0 rule is to
 * control a volatile source at its origin or escalate — never redact — so
 * this scenario pins every byte the path does not touch with explicit
 * assertions and builds the expected message with the SAME error class over
 * the real resolved path.
 *
 * Determinism: the lock wait is `waitedMs + pollIntervalMs > timeoutMs`, so a
 * timeout below the 1 s poll interval fails on the FIRST contended attempt with
 * no sleep; `waitedMs` is measured on the scripted clock, so it is 0.
 *
 * Regenerate: nothing to regenerate — no snapshot.
 */

import { mkdirSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
  WorkspaceLockTimeoutError,
  acquireWorkspaceLock,
  type ReleaseWorkspaceLock,
} from "../../../../shared/workspace/workspace-lock.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
  sessionWorkspaceDir,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { recordedModelBuilds } from "../../__test-utils__/scripted-model-module.js";

/** Below the lock's 1 s poll interval: the first contended attempt times out. */
const LOCK_TIMEOUT_MS = 250;

describe("ExecuteDeepAgent hermetic — workspace lock timeout", () => {
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

  it("fails the turn with the lock's message when another turn holds the workspace", async () => {
    // ── Arrange: another turn already holds this session's workspace ─────────
    const record = deepAgentExecutionRecord({ message: "Never streams." });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => {
        throw new Error("the model must never be asked while the workspace is held");
      },
      config: { workspaceLockTimeoutMs: LOCK_TIMEOUT_MS },
    });
    // Created AFTER the scenario begins (which clears the session workspace)
    // and BEFORE either side locks it, so both resolve the same realpath
    // (macOS's /var -> /private/var) and contend on ONE key.
    const workspaceDir = sessionWorkspaceDir(env);
    mkdirSync(workspaceDir, { recursive: true });
    const resolvedDir = await realpath(workspaceDir);
    let releaseHeldLock: ReleaseWorkspaceLock | undefined = await acquireWorkspaceLock(workspaceDir);

    try {
      // ── Act ────────────────────────────────────────────────────────────────
      const invocation = await runDeepAgentTurn(scenario);

      // ── Assert: outcome and phases ─────────────────────────────────────────
      expect(invocation.outcome.kind, "a lock timeout RETURNS — a retry would queue behind the same holder").toBe(
        "returned",
      );
      const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
      expect(slim.phase).toBe("EXECUTION_FAILED");
      expect(record.persistedPhases, "the one and only full persist").toEqual([ExecutionPhase.EXECUTION_FAILED]);

      // ── Assert: the copy, built with the same class over the real path ─────
      const expectedMessage = new WorkspaceLockTimeoutError(resolvedDir, 0).message;
      const final = record.lastFullStatus!;
      expect(final.error).toBe(expectedMessage);
      expect(final.completedAt).not.toBe("");
      expect(final.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content)).toEqual([
        `Execution failed: ${expectedMessage}`,
      ]);
      expect(final.messages, "the system row is the whole transcript").toHaveLength(1);

      // ── Assert: today's order — the whole setup ran BEFORE the wait ────────
      expect(record.setupProgress).toEqual([
        "Fetching execution…",
        "Resolving agent…",
        "Resolving environment…",
        "Initializing workspace…",
        "Configuring sub-agents…",
        "Creating agent…",
        "Waiting for workspace — in use by another session",
      ]);
      expect(recordedModelBuilds().length, "the model was built before the lock was even tried").toBeGreaterThan(0);

      // ── Assert: hermeticity ────────────────────────────────────────────────
      expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
      // Today's heartbeat posture, recorded for Q-S3-8 (parent Q8): native
      // pulses only from its stream loop and per lock-wait poll; nothing during
      // setup, and a wait that fails on its first attempt never polls. The
      // runtime's whole-activity heartbeat makes this count positive at M2b.
      expect(invocation.heartbeats, "no heartbeat before the stream on this harness today").toHaveLength(0);
    } finally {
      await releaseHeldLock?.();
      releaseHeldLock = undefined;
    }
  });
});
