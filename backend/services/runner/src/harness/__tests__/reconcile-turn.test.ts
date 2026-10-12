/**
 * Pins the two ways a reconcile turn (`turn-context.ts`
 * `resolveReconcileTurn`, the run a person's Undo on an ended turn starts)
 * settles before it puts anything back:
 *
 *  - the run's values are refused for a reason its person fixes: the turn
 *    settles `values-refused` with the server's message and never provisions
 *    the workspace;
 *  - another turn holds the primary tree past the lock's wait: the turn
 *    settles `workspace-lock-timeout`, holds no lock, and reads no owed undo.
 *
 * What it puts back once it has the tree is `owed-undos.test.ts`'s; the
 * reconcile turn end to end is the kit's runtime arm. The control-plane
 * client is a double; `HOME` and the workspace root are the hermetic
 * environment's, so the session directory and the lock artifacts land under
 * a temp dir.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ExecutionValuesSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/values_pb";

import { createHermeticEnvironment } from "../../__test-utils__/hermetic-activity.js";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { acquireWorkspaceLock } from "../../shared/workspace/workspace-lock.js";
import { TranscriptBuilder } from "../transcript/builder.js";
import { resolveReconcileTurn, type ResolutionDeps, type TurnFrame } from "../turn-context.js";

const env = createHermeticEnvironment();
afterAll(() => env.dispose());

/** Below the lock's 1 s poll interval: the first contended attempt times out, with no sleep. */
const LOCK_TIMEOUT_MS = 250;

function depsWith(client: ResolutionDeps["client"], sessionId: string): { deps: ResolutionDeps; labels: string[] } {
  const labels: string[] = [];
  const status = create(RunStatusSchema, {});
  return {
    labels,
    deps: {
      input: { executionId: `aex-${sessionId}`, threadId: "", turnSeq: 0 },
      client,
      config: testConfig({ workspaceRootDir: env.workspaceRootDir, workspaceLockTimeoutMs: LOCK_TIMEOUT_MS }),
      status,
      transcript: new TranscriptBuilder(`aex-${sessionId}`, status),
      artifactStorage: undefined,
      timing: new TimingRecorder(),
      signal: new AbortController().signal,
      heartbeat: () => {},
      enterPhase: () => {},
      reportProgress: async (label) => {
        labels.push(label);
      },
      identifyRun: () => {},
      recordReconciled: async () => {},
    },
  };
}

function emptyFrame(): TurnFrame {
  return { primaryDir: undefined, releaseWorkspaceLock: undefined, writeback: null, evalMocks: undefined, evalReadFiles: undefined };
}

describe("resolveReconcileTurn: the settlements before the undo", () => {
  it("a refused values fetch settles values-refused with the server's message and provisions nothing", async () => {
    const client = mockStigmerClient({
      fetchExecutionValues: vi.fn().mockRejectedValue(new ConnectError("the entry is gone from its vault", Code.FailedPrecondition)),
    });
    const { deps, labels } = depsWith(client, "ses-reconcile-values");
    const frame = emptyFrame();

    const resolution = await resolveReconcileTurn(deps, frame, "ses-reconcile-values");

    expect(resolution).toEqual({ kind: "settled", settlement: { kind: "values-refused", message: "the entry is gone from its vault" } });
    expect(labels, "the turn stops before the workspace").not.toContain("Provisioning workspace");
    expect(frame.primaryDir).toBeUndefined();
    expect(client.listSessionEvents).not.toHaveBeenCalled();
  });

  it("a tree another turn holds past the wait settles workspace-lock-timeout and reads no owed undo", async () => {
    const sessionId = "ses-reconcile-lock";
    const client = mockStigmerClient({ fetchExecutionValues: vi.fn(async () => create(ExecutionValuesSchema)) });
    const { deps } = depsWith(client, sessionId);
    const frame = emptyFrame();
    const sessionDir = join(env.workspaceRootDir, "sessions", sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const releaseHeld = await acquireWorkspaceLock(sessionDir);

    try {
      const resolution = await resolveReconcileTurn(deps, frame, sessionId);

      expect(resolution.kind).toBe("settled");
      const settlement = resolution.kind === "settled" ? resolution.settlement : undefined;
      expect(settlement?.kind).toBe("workspace-lock-timeout");
      expect(frame.primaryDir, "the workspace was provisioned before the lock").toBe(sessionDir);
      expect(frame.releaseWorkspaceLock, "no lock is held to release").toBeUndefined();
      expect(client.listSessionEvents).not.toHaveBeenCalled();
    } finally {
      await releaseHeld();
    }
  });
});
