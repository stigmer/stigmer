/**
 * Hermetic scenario: WORKSPACE LOCK TIMEOUT — a turn that cannot acquire its
 * workspace within the configured wait fails with an actionable reason and
 * RETURNS, before any agent exists.
 *
 * Invariant pinned: every turn serializes on its primary workspace directory
 * (shared/workspace/workspace-lock.ts) before the first tree mutation. While
 * another turn holds the lock the activity reports a visible waiting state and
 * heartbeats; past `Config.workspaceLockTimeoutMs` it maps
 * `WorkspaceLockTimeoutError` to EXECUTION_FAILED with the lock's own message
 * (which names the directory) and one system message, persists ONCE, and
 * returns — a Temporal retry would only queue behind the same holder. No
 * `Agent.create`, no `harness_state_id` bind, nothing streamed.
 *
 * Why this is the one terminal arm WITHOUT a file golden (owner ruling,
 * 2026-09-11, entry 20260911.03 M0): the wire copy embeds the absolute
 * workspace path, which is a per-run temp directory and differs between macOS
 * and CI. The S0 driver's rule is to control a volatile source at its origin
 * or escalate — never redact — so this scenario pins every byte the path does
 * not touch with explicit assertions and builds the expected message with the
 * SAME error class over the real resolved path.
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
import {
  WorkspaceLockTimeoutError,
  acquireWorkspaceLock,
  type ReleaseWorkspaceLock,
} from "../../../../shared/workspace/workspace-lock.js";
import { _parkedAgentCountForTests } from "../../agent-session-cache.js";
import { ScriptedCursorAgent } from "../../__test-utils__/scripted-agent.js";
import {
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
  sessionWorkspaceDir,
  stubRegistryFetch,
} from "../../__test-utils__/hermetic-cursor.js";

const USER_MESSAGE = "Rename the config module.";
/** Below the lock's 1 s poll interval, so the first contended attempt times out. */
const LOCK_TIMEOUT_MS = 500;

describe("ExecuteCursor hermetic — workspace lock timeout", () => {
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
    // The directory is created BEFORE either side locks it so both resolve the
    // same realpath (macOS's /var -> /private/var) and contend on ONE key.
    const workspaceDir = sessionWorkspaceDir(env);
    mkdirSync(workspaceDir, { recursive: true });
    const resolvedDir = await realpath(workspaceDir);
    let releaseHeldLock: ReleaseWorkspaceLock | undefined = await acquireWorkspaceLock(workspaceDir);

    const neverUsed = new ScriptedCursorAgent({ agentId: "agent-hermetic-never-locked", turns: [] });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({
      env,
      clock,
      record,
      sdk: { agents: [neverUsed], catalog: SDK_CATALOG },
      config: { workspaceLockTimeoutMs: LOCK_TIMEOUT_MS },
    });

    try {
      // ── Act ────────────────────────────────────────────────────────────────
      const invocation = await runCursorTurn(scenario);

      // ── Assert: outcome and phases ─────────────────────────────────────────
      expect(invocation.outcome.kind, "a lock timeout RETURNS — a retry would queue behind the same holder").toBe(
        "returned",
      );
      const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
      expect(slim.phase).toBe("EXECUTION_FAILED");
      expect(record.persistedPhases, "the one and only full persist").toEqual([ExecutionPhase.EXECUTION_FAILED]);

      // ── Assert: the copy, built with the same class over the real path ─────
      const expectedMessage = new WorkspaceLockTimeoutError(resolvedDir, 0).message;
      expect(expectedMessage).toBe(
        `Workspace is in use by another session: ${resolvedDir} (waited 0s). ` +
          `Another agent execution is operating on this workspace directory; retry after it finishes.`,
      );
      const final = record.lastFullStatus!;
      expect(final.error).toBe(expectedMessage);
      expect(final.completedAt).not.toBe("");
      expect(final.startedAt).not.toBe("");
      expect(
        final.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content),
      ).toEqual([`Execution failed: ${expectedMessage}`]);
      expect(final.messages, "the system message is the whole transcript").toHaveLength(1);

      // ── Assert: the visible waiting state, then nothing past the lock ──────
      expect(record.setupProgress).toEqual([
        "Fetching execution",
        "Resolving agent blueprint",
        "Resolving environment",
        "Provisioning workspace",
        "Waiting for workspace — in use by another session",
      ]);
      expect(scenario.sdk.resolutions, "no agent was created").toHaveLength(0);
      expect(neverUsed.sends).toHaveLength(0);
      expect(record.sessionUpdates, "no harness_state_id to bind").toHaveLength(0);
      expect(_parkedAgentCountForTests()).toBe(0);

      // ── Assert: hermeticity ────────────────────────────────────────────────
      expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
      expect(invocation.heartbeats.length, "the activity heartbeat before the lock").toBeGreaterThan(0);
    } finally {
      await releaseHeldLock?.();
      releaseHeldLock = undefined;
    }
  });
});
