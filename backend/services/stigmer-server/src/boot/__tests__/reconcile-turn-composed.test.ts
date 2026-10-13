/**
 * Pins the composition of the reconcile turn an undo on an ended turn
 * starts: on a real composed server over SQLite, the session's
 * reviewFileChanges is served, records the undo in the session's log on
 * the change set's run, and hands the reconcile turn to
 * the in-process run create chain the composition root wires
 * (`reconcileTurns`, boot/inprocess.ts `reconcileTurnCreator`). No engine
 * is behind the server (TEMPORAL_HOST_PORT is a closed port), so the chain
 * refuses the create as Unavailable; the undo stands, the reply names no
 * turn, and the refusal is logged as the decision core logs a refused
 * create (domain/session/filereview/decide.ts). What the chain admits is
 * pinned in the run create suites. A turn that waits, has an undo decided,
 * and is then failed by its workflow without running again hands its
 * reconcile turn to the same chain, through the stopped-turn observer the
 * composition root composes beside the grading observer
 * (domain/session/filereview/stopped-turn.ts), acting as the undo's
 * decider the log names.
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
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";

import { fileReviewSeed } from "../../domain/run/__tests__/file-review-seed.js";
import { SessionEventBroker } from "../../domain/session/events/broker.js";
import { eventOf } from "../../domain/session/events/codec.js";
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
  async function seedEndedTurn(id: string, sessionId: string, phase = RunPhase.RUN_COMPLETED) {
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
        status: { ...seed.status, phase },
      }),
    );
    return seed;
  }

  /** The actions of the run's decided events in its session's log. */
  async function decisionsOf(id: string, sessionId: string) {
    const records = await server.store.sessionEvents.list(sessionId, {
      order: "asc",
      runId: id,
      types: ["stigmer.file_review.decided"],
      limit: 10,
    });
    return records.map(eventOf).flatMap((event) =>
      event.event.case === "stigmerFileReviewDecided" ? [event.event.value.action] : [],
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
    expect(await decisionsOf("run_session_undo", "ses_session_undo")).toEqual(["undo"]);
    expect(refusalsLogged() - before).toBe(1);
  });

  it("a waiting turn with an undo that its workflow fails hands its reconcile turn to the same chain", async () => {
    const seed = await seedEndedTurn("run_stopped_undo", "ses_stopped_undo", RunPhase.RUN_WAITING_FOR_APPROVAL);
    const session = createClient(SessionCommandController, server.inProcessTransport);
    const response = await session.reviewFileChanges({
      sessionId: "ses_stopped_undo",
      changeSetId: "run_stopped_undo:1",
      scope: "change_set",
      action: "undo",
      expectedDigest: seed.aggregate,
    });
    expect(response.reconcileRunId, "a turn still unfinished starts none").toBe("");
    const before = refusalsLogged();

    // The workflow's failure write after its approval cycles run out.
    await createClient(RunCommandController, server.inProcessTransport).updateStatus({
      runId: "run_stopped_undo",
      status: { phase: RunPhase.RUN_FAILED, error: "approval cycles exhausted" },
    });

    expect(refusalsLogged() - before).toBe(1);
  });
});
