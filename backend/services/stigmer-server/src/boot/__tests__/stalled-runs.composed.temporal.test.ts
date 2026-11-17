/**
 * Pins the composition of the stalled-run checker (domain/run/stalled-runs.ts,
 * stigmer#3120) on a real composed server over SQLite with a real local
 * Temporal behind it:
 *
 *   - a working run whose workflow the engine never held (the server
 *     stopped between saving the turn and starting its workflow) is ended
 *     by one pass as FAILED with the platform's cause, its session reads
 *     the error, and the message queued behind it is handed to the
 *     queue's turn (the composed queued-turn observer). This fixture's
 *     session has no stored session or agent, so the run create chain
 *     refuses that turn by a check, which drops the message with a
 *     session.error and leaves the session idle (domain/run/queued-turn.ts);
 *     what the chain admits is pinned in the run create suites;
 *   - a working run whose workflow was terminated out of band (closed in
 *     the engine) is ended the same way;
 *   - a working run whose workflow is open is left working.
 *
 * Its own file, so its own vitest process: the SDK Runtime is a process
 * singleton. VISIBLY skipped when the local Temporal server cannot start
 * (no `temporal` CLI), never a vacuous green.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { create } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { eventTypeOf } from "@stigmer/session-log";

import { STALLED_RUN_MIN_AGE_MS } from "../../domain/run/stalled-runs.js";
import { SessionEventBroker } from "../../domain/session/events/broker.js";
import { eventOf } from "../../domain/session/events/codec.js";
import { enqueueMessage } from "../../domain/session/events/queue.js";
import { createRunAppendingEvents } from "../../domain/session/events/run-writes.js";
import { readSessionState } from "../../domain/session/events/state.js";
import { invokeWorkflowIdFor } from "../../temporal/agentexecution/names.js";
import { loadConfig } from "../config.js";
import { composeServer } from "../compose.js";
import type { ComposedServer } from "../compose.js";
import { createLogger } from "../logger.js";

type TestWorkflowEnvironment =
  import("@temporalio/testing").TestWorkflowEnvironment;

/** A port nothing listens on now: bound by the OS, then released. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const OLD_SECONDS = BigInt(
  Math.floor((Date.now() - STALLED_RUN_MIN_AGE_MS - 60_000) / 1000),
);

function workingRun(id: string, sessionId: string): Run {
  return create(RunSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Run",
    metadata: { id, org: "org_acme" },
    spec: {
      target: { case: "sessionId", value: sessionId },
      message: "build it",
    },
    status: {
      phase: RunPhase.RUN_IN_PROGRESS,
      audit: { specAudit: { createdAt: { seconds: OLD_SECONDS, nanos: 0 } } },
    },
  });
}

describe("the composed stalled-run checker", () => {
  let env: TestWorkflowEnvironment | undefined;
  let server: ComposedServer | undefined;
  let dir: string;
  let unavailable = "";

  beforeAll(async () => {
    const port = await freePort();
    try {
      const { TestWorkflowEnvironment: TWE } =
        await import("@temporalio/testing");
      env = await TWE.createLocal({ server: { port } });
    } catch (error) {
      unavailable = error instanceof Error ? error.message : String(error);
      return;
    }
    dir = mkdtempSync(path.join(tmpdir(), "stalled-runs-composed-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: `127.0.0.1:${port}`,
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
      portOverride: 0,
      host: "127.0.0.1",
    });
    await server.start();
  }, 120_000);

  afterAll(async () => {
    await server?.shutdown();
    await env?.teardown();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("ends a working run whose workflow is gone, starts the queue's turn, and leaves one whose workflow is open", async (testCtx) => {
    if (server === undefined || env === undefined) {
      console.warn(
        `Temporal test server unavailable (test skipped): ${unavailable}`,
      );
      return testCtx.skip();
    }
    const deps = {
      store: server.store,
      sessionEventBroker: new SessionEventBroker(
        createLogger({ level: "error", pretty: false, write: () => {} }),
      ),
    };
    await createRunAppendingEvents(deps, workingRun("run_stuck", "ses_stuck"));
    await enqueueMessage(deps, {
      sessionId: "ses_stuck",
      org: "org_acme",
      sender: "ida_sender",
      turn: create(RunSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Run",
        metadata: { name: "hello", org: "org_acme" },
        spec: {
          target: { case: "sessionId", value: "ses_stuck" },
          message: "hello?",
        },
      }),
    });
    // A live workflow under the pinned id: open, on a queue no worker polls.
    await createRunAppendingEvents(deps, workingRun("run_live", "ses_live"));
    await env.client.workflow.start("stalled-runs-composed-probe", {
      workflowId: invokeWorkflowIdFor("run_live"),
      taskQueue: "stalled-runs-composed-nobody",
    });

    await server.stalledRuns.runPass();

    const stuck = await server.store.getResource(
      ApiResourceKind.run,
      "run_stuck",
      RunSchema,
    );
    expect([
      stuck.status?.phase,
      stuck.status?.stopCause,
      stuck.status?.stopDetail?.kind,
    ]).toEqual([RunPhase.RUN_FAILED, "failed", "internal"]);
    const log = (
      await server.store.sessionEvents.list("ses_stuck", {
        order: "asc",
        limit: 100,
      })
    ).map((record) => ({
      runId: record.runId,
      type: eventTypeOf(eventOf(record)),
    }));
    expect(
      log
        .filter((entry) => entry.runId === "run_stuck")
        .map((entry) => entry.type),
    ).toContain("session.error");
    expect(
      await server.store.sessionEvents.queued("ses_stuck"),
      "the queued message is handed to the queue's turn",
    ).toHaveLength(0);
    expect(
      log.filter((entry) => entry.runId === "").map((entry) => entry.type),
      "the queue's turn was tried: its message, then the check's refusal",
    ).toEqual(["user.message", "session.error", "session.status_idle"]);
    expect(await readSessionState(server.store, "ses_stuck")).toBe("idle");

    const live = await server.store.getResource(
      ApiResourceKind.run,
      "run_live",
      RunSchema,
    );
    expect(live.status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);
  }, 60_000);

  it("ends a working run whose workflow was terminated out of band", async (testCtx) => {
    if (server === undefined || env === undefined) {
      console.warn(
        `Temporal test server unavailable (test skipped): ${unavailable}`,
      );
      return testCtx.skip();
    }
    const deps = {
      store: server.store,
      sessionEventBroker: new SessionEventBroker(
        createLogger({ level: "error", pretty: false, write: () => {} }),
      ),
    };
    await createRunAppendingEvents(
      deps,
      workingRun("run_terminated", "ses_terminated"),
    );
    const handle = await env.client.workflow.start(
      "stalled-runs-composed-probe",
      {
        workflowId: invokeWorkflowIdFor("run_terminated"),
        taskQueue: "stalled-runs-composed-nobody",
      },
    );
    await handle.terminate("an operator reset the engine");

    await server.stalledRuns.runPass();

    const ended = await server.store.getResource(
      ApiResourceKind.run,
      "run_terminated",
      RunSchema,
    );
    expect([
      ended.status?.phase,
      ended.status?.stopCause,
      ended.status?.stopDetail?.kind,
    ]).toEqual([RunPhase.RUN_FAILED, "failed", "internal"]);
    expect(await readSessionState(server.store, "ses_terminated")).toBe("idle");
  }, 60_000);
});
