/**
 * Pins the composition of the reconcile turn an undo on an ended turn
 * starts: on a real composed server over SQLite, both decision methods (the
 * session's reviewFileChanges and the run's submitFileDecision) are served,
 * record the undo on the change set's run, and hand the reconcile turn to
 * the in-process run create chain the composition root wires
 * (`reconcileTurns`, boot/inprocess.ts `reconcileTurnCreator`). No engine
 * is behind the server (TEMPORAL_HOST_PORT is a closed port), so the chain
 * refuses the create as Unavailable; the undo stands, the reply names no
 * turn, and the refusal is logged as the decision core logs a refused
 * create (domain/session/filereview/decide.ts). What the chain admits is
 * pinned in the run create suites.
 *
 * The calls ride the in-process transport, as the server acting as itself,
 * so no sign-in is needed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";
import {
  FileDecisionAction,
  FileDecisionScope,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { fileReviewSeed } from "../../domain/run/__tests__/file-review-seed.js";
import { SessionEventBroker } from "../../domain/session/events/broker.js";
import { createRunAppendingEvents } from "../../domain/session/events/run-writes.js";
import { loadConfig } from "../config.js";
import { composeServer } from "../compose.js";
import type { ComposedServer } from "../compose.js";
import { createLogger } from "../logger.js";

const REFUSED_LOG =
  "The reconcile turn was refused; the undo stands and the next turn restores it";

describe("the composed reconcile turn", () => {
  let server: ComposedServer;
  let dir: string;
  const logLines: string[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "reconcile-turn-composed-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: createLogger({
        level: "warn",
        pretty: false,
        write: (line) => logLines.push(line),
      }),
      portOverride: 0,
      host: "127.0.0.1",
    });
    await server.start();
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  /** An ended turn of `sessionId` with one captured change set, `<id>:1`, stored as the create chain stores it. */
  async function seedEndedTurn(id: string, sessionId: string) {
    const seed = fileReviewSeed(id, `${id}:1`);
    await createRunAppendingEvents(
      {
        store: server.store,
        sessionEventBroker: new SessionEventBroker(
          createLogger({ level: "error", pretty: false, write: () => {} }),
        ),
      },
      create(RunSchema, {
        metadata: { id, org: "org_acme" },
        spec: {
          target: { case: "sessionId", value: sessionId },
          message: `edit in ${id}`,
        },
        status: { ...seed.status, phase: RunPhase.RUN_COMPLETED },
      }),
    );
    return seed;
  }

  async function decisionsOf(id: string) {
    const run = await server.store.getResource(
      ApiResourceKind.run,
      id,
      RunSchema,
    );
    return (run.status?.fileChangeSets[0]?.decisions ?? []).map(
      (d) => d.action,
    );
  }

  function refusalsLogged(): number {
    return logLines.filter(
      (line) => line.includes(REFUSED_LOG) && line.includes("[unavailable]"),
    ).length;
  }

  it("the session's undo records the decision and hands the turn to the in-process create chain", async () => {
    const seed = await seedEndedTurn("run_session_undo", "ses_session_undo");
    const before = refusalsLogged();
    const session = createClient(
      SessionCommandController,
      server.inProcessTransport,
    );

    const response = await session.reviewFileChanges({
      sessionId: "ses_session_undo",
      changeSetId: "run_session_undo:1",
      scope: "change_set",
      action: "undo",
      expectedDigest: seed.aggregate,
    });

    expect(response.reconcileRunId).toBe("");
    expect(await decisionsOf("run_session_undo")).toEqual([
      FileDecisionAction.REJECT,
    ]);
    expect(refusalsLogged() - before).toBe(1);
  });

  it("the run's undo records the decision and hands the turn to the same chain", async () => {
    const seed = await seedEndedTurn("run_run_undo", "ses_run_undo");
    const before = refusalsLogged();
    const run = createClient(RunCommandController, server.inProcessTransport);

    await run.submitFileDecision({
      runId: "run_run_undo",
      changeSetId: "run_run_undo:1",
      scope: FileDecisionScope.CHANGE_SET,
      action: FileDecisionAction.REJECT,
      expectedDigest: seed.aggregate,
    });

    expect(await decisionsOf("run_run_undo")).toEqual([
      FileDecisionAction.REJECT,
    ]);
    expect(refusalsLogged() - before).toBe(1);
  });
});
