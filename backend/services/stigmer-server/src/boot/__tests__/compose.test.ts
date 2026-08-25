/**
 * Boot-ordering (health gate) tests — the contract the CLI's serverGate
 * depends on (Go server.go:739-743, 839-843; grpc lib Stop :247-265):
 *
 *   - overall health is NOT_SERVING from construction until the
 *     composition root completes;
 *   - start() flips SERVING BEFORE the port binds, so the first probe that
 *     reaches the port already sees a serving server;
 *   - shutdown flips NOT_SERVING FIRST, then drains — and the port stops
 *     answering.
 */
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import {
  Health,
  HealthCheckResponse_ServingStatus as ServingStatus,
} from "@stigmer/protos/grpc/health/v1/health_pb";
import { connect as netConnect } from "node:net";
import { describe, expect, it } from "vitest";

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadConfig } from "../config.js";
import { composeServer } from "../compose.js";
import { createLogger } from "../logger.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

function compose() {
  // Each composed server gets a throwaway database — the storage stage
  // opens DB_PATH for real (never the developer's ~/.stigmer).
  const testDir = mkdtempSync(path.join(tmpdir(), "compose-test-"));
  const config = loadConfig({
    STIGMER_MODEL_REGISTRY_REFRESH: "off",
    // No engine behind composed tests: 127.0.0.1:1 is deterministically
    // closed, so boots fail the non-fatal connect fast and can never touch
    // a live local Temporal (the conformance CRUD harness does the same).
    TEMPORAL_HOST_PORT: "127.0.0.1:1",
    DB_PATH: path.join(testDir, "stigmer.db"),
    // Keep the artifact store inside the test dir (never ~/.stigmer).
    ARTIFACT_LOCAL_BASE_PATH: path.join(testDir, "artifacts"),
    // Same for the skill artifact store — its boot-time staging wipe (#8)
    // must never run against the real ~/.stigmer/storage.
    STORAGE_PATH: path.join(testDir, "storage"),
  });
  return composeServer({
    config,
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
}

describe("composition-root boot ordering", () => {
  it("is NOT_SERVING at construction and SERVING once the port answers", async () => {
    const server = compose();
    expect(server.healthState.status("")).toBe(ServingStatus.NOT_SERVING);

    const port = await server.start();
    try {
      const client = createClient(
        Health,
        createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` }),
      );
      // The serverGate contract: if the port accepts, health is already
      // SERVING — there is no bound-but-not-ready window.
      const response = await client.check({});
      expect(response.status).toBe(ServingStatus.SERVING);
    } finally {
      await server.shutdown();
    }
  });

  it("flips NOT_SERVING on shutdown and stops answering the port", async () => {
    const server = compose();
    const port = await server.start();

    await server.shutdown();

    expect(server.healthState.status("")).toBe(ServingStatus.NOT_SERVING);
    const refused = await new Promise<boolean>((resolve) => {
      const probe = netConnect(port, "127.0.0.1");
      probe.once("connect", () => {
        probe.destroy();
        resolve(false);
      });
      probe.once("error", () => resolve(true));
    });
    expect(refused, "the drained port must refuse new connections").toBe(true);
  });
});
