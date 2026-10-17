/**
 * Pins the hourly limit on hand fires through the REAL stack: a composed
 * server whose STIGMER_ROUTINE_FIRES_PER_HOUR is 2, a native gRPC client
 * and the full fire chain. The server's setting reaches the fire, a third
 * fire within the hour is refused with RESOURCE_EXHAUSTED and leaves no
 * ledger row, another routine keeps its own allowance, and a routine
 * switched off is refused as disabled before its allowance is read.
 *
 * No engine stands behind composed servers, so a fire of a live agent
 * fails on infrastructure before any ledger row exists (the routine suite's
 * own case). Each routine here targets an agent whose row is then dropped
 * without its cascade, so every fire happens and is recorded as
 * TARGET_MISSING: the ledger rows the limit counts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineCommandController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/command_pb";
import { RoutineQueryController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/query_pb";
import { RoutineFireOutcome } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { releaseNamesOfDeleted } from "../../../pipeline/steps/names.js";
import { organizationId, seedOrganizations } from "../../organization/__tests__/support.js";
import { FIRE_DISABLED_MESSAGE } from "../fire.js";
import { fireRateExceededMessage } from "../fire-rate.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

let dir: string;
let server: ComposedServer;
let transport: Transport;
let command: Client<typeof RoutineCommandController>;
let query: Client<typeof RoutineQueryController>;
let acmeId: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "routine-fire-rate-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // Deterministically closed: no engine behind the server.
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      STIGMER_ROUTINE_FIRES_PER_HOUR: "2",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  acmeId = organizationId(await seedOrganizations(transport, ["acme"]), "acme");
  command = createClient(RoutineCommandController, transport);
  query = createClient(RoutineQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A routine whose agent's row is then removed without the cascade, so its
 * fires happen and are recorded as TARGET_MISSING. Answers the routine id.
 */
async function routineOfAGoneAgent(slug: string): Promise<string> {
  const agents = createClient(AgentCommandController, transport);
  await agents.create({
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: { name: `Agent ${slug}`, org: "acme", slug },
    spec: { instructions: "a composed-test target agent" },
  });
  const created = await command.create({
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Routine",
    metadata: { name: `Routine ${slug}`, org: "acme", slug },
    spec: {
      timeZone: "Asia/Kolkata",
      enabled: true,
      agent: { agentRef: { slug, org: "" }, message: "Do the rounds" },
    },
  });
  const agent = await createClient(AgentQueryController, transport).getByReference({
    kind: ApiResourceKind.agent,
    org: "acme",
    slug,
  });
  const agentId = agent.metadata?.id ?? "";
  await server.store.deleteResource(ApiResourceKind.agent, agentId);
  await releaseNamesOfDeleted(server.store, silentLogger, ApiResourceKind.agent, acmeId, agentId);
  return created.metadata?.id ?? "";
}

async function refusal(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
}

describe("fire — the hourly limit on hand fires", () => {
  it("refuses a routine's third hand fire within the hour, recording only the two that happened", async () => {
    const id = await routineOfAGoneAgent("rate-limited");
    for (let fire = 0; fire < 2; fire += 1) {
      expect((await command.fire({ id })).outcome).toBe(RoutineFireOutcome.TARGET_MISSING);
    }

    const err = await refusal(() => command.fire({ id, text: "one more" }));
    expect(err.code).toBe(Code.ResourceExhausted);
    expect(err.rawMessage).toBe(fireRateExceededMessage(2));
    expect((await query.listFires({ routineId: id })).entries).toHaveLength(2);
  });

  it("keeps each routine's allowance its own", async () => {
    const id = await routineOfAGoneAgent("rate-neighbour");
    expect((await command.fire({ id })).outcome).toBe(RoutineFireOutcome.TARGET_MISSING);
  });

  it("refuses a routine switched off as disabled, before its allowance is read", async () => {
    const id = await routineOfAGoneAgent("rate-switched-off");
    for (let fire = 0; fire < 2; fire += 1) {
      await command.fire({ id });
    }
    // Through the store: an update re-checks the agent reference, and this
    // routine's agent is gone.
    await server.store.updateResource(ApiResourceKind.routine, id, RoutineSchema, (live) => {
      if (live.spec !== undefined) {
        live.spec.enabled = false;
      }
    });

    const err = await refusal(() => command.fire({ id }));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(FIRE_DISABLED_MESSAGE);
  });
});
