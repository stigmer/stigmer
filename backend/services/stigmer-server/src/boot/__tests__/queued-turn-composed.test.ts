/**
 * Pins the composition of the turn a session's queue starts: on a real
 * composed server over SQLite, a turn that ends with a message queued
 * hands the queue's turn to the in-process run create chain the
 * composition root wires (`queuedTurnCreator`, boot/inprocess.ts), through
 * the status observer composed beside the stopped-turn observer
 * (domain/run/queued-turn.ts), as the message's sender. No engine is
 * behind the server (TEMPORAL_HOST_PORT is a closed port), so the chain
 * refuses the create as Unavailable, a fault: the message stays queued for
 * the workflow's end to start, and the observer logs it. What the chain
 * admits is pinned in the run create suites.
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

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/command_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { SessionEventBroker } from "../../domain/session/events/broker.js";
import { enqueueMessage } from "../../domain/session/events/queue.js";
import { createRunAppendingEvents } from "../../domain/session/events/run-writes.js";
import { loadConfig } from "../config.js";
import { composeServer } from "../compose.js";
import type { ComposedServer } from "../compose.js";
import { createLogger } from "../logger.js";

const NOT_STARTED_LOG = "the queue's turn could not be started yet; the workflow's end starts it";

describe("the composed queue's turn", () => {
  let server: ComposedServer;
  let dir: string;
  const logLines: string[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "queued-turn-composed-"));
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

  it("a turn that ends with a message queued hands the queue's turn to the in-process create chain", async () => {
    const deps = {
      store: server.store,
      sessionEventBroker: new SessionEventBroker(createLogger({ level: "error", pretty: false, write: () => {} })),
    };
    await createRunAppendingEvents(
      deps,
      create(RunSchema, {
        metadata: { id: "run_working", org: "org_acme" },
        spec: { target: { case: "sessionId", value: "ses_queue" }, message: "build it" },
        status: { phase: RunPhase.RUN_IN_PROGRESS },
      }),
    );
    await enqueueMessage(deps, {
      sessionId: "ses_queue",
      org: "org_acme",
      sender: "ida_sender",
      turn: create(RunSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Run",
        metadata: { name: "the-readme", org: "org_acme" },
        spec: { target: { case: "sessionId", value: "ses_queue" }, message: "and the README" },
      }),
    });

    await createClient(RunCommandController, server.inProcessTransport).updateStatus({
      runId: "run_working",
      status: { phase: RunPhase.RUN_COMPLETED },
    });

    expect(logLines.filter((line) => line.includes(NOT_STARTED_LOG) && line.includes("ses_queue"))).toHaveLength(1);
    expect(await server.store.sessionEvents.queued("ses_queue")).toHaveLength(1);
  });
});
