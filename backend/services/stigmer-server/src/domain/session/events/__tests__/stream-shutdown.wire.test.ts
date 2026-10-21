/**
 * A composed server's shutdown ends its session event streams at once with
 * UNAVAILABLE, the code every client resumes from, rather than holding
 * them until the transport's drain destroys their sockets
 * (SHUTDOWN_DRAIN_TIMEOUT_MS): the first thing a server that is leaving
 * does, after it stops answering healthy (boot/compose.ts).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/query_pb";

import { loadConfig } from "../../../../boot/config.js";
import { composeServer } from "../../../../boot/compose.js";
import type { ComposedServer } from "../../../../boot/compose.js";
import { createLogger } from "../../../../boot/logger.js";
import { SHUTDOWN_DRAIN_TIMEOUT_MS } from "../../../../transport/constants.js";
import { seedOrganizations } from "../../../organization/__tests__/support.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const ORG = "shutdown-org";

let server: ComposedServer;
let dir: string;
let port: number;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "session-stream-shutdown-"));
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("STIGMER_RUNNER_TOKEN_KEY", Buffer.alloc(32, 8).toString("base64"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  port = await server.start();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it("ends an open session stream with UNAVAILABLE as shutdown begins, long before the drain", async () => {
  const transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  await seedOrganizations(transport, [ORG]);
  const session = await createClient(SessionCommandController, transport).create({
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Session",
    metadata: { name: "Leaving", org: ORG },
    spec: {},
  });
  const sessionId = session.metadata?.id ?? "";
  const stream = createClient(SessionQueryController, transport).streamEvents({ sessionId, afterSeq: 0n });
  const ended = (async () => {
    try {
      for await (const _frame of stream) {
        // a fresh session holds no events
      }
      return undefined;
    } catch (error) {
      return ConnectError.from(error);
    }
  })();
  await vi.waitFor(() => expect(server.sessionEventBroker.subscriberCount(sessionId)).toBe(1));

  const startedAt = Date.now();
  const stopped = server.shutdown();
  const error = await ended;
  expect(error?.code).toBe(Code.Unavailable);
  expect(Date.now() - startedAt).toBeLessThan(SHUTDOWN_DRAIN_TIMEOUT_MS);
  await stopped;
});
