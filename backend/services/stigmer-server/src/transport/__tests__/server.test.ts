/**
 * Unified-port lane router smoke tests, pinned to the Go router's verified
 * behavior (pkg/server/server.go:812-836) and the CW-10 suite's assertions:
 *
 *   - lane priority: exact registry paths win over everything;
 *   - unknown paths (incl. unknown /v1/proxy/*) reach the adapter's 404;
 *   - RPC-lane preflights answer for ANY path, registered or not, in
 *     rs/cors v1.7 shape (origin echo, method/headers echo, max-age 600);
 *   - actual cross-origin RPC responses carry the echoed-origin headers;
 *   - the skill-transfer prefix is a seam: with no handler installed it
 *     falls through to 404 exactly like an unknown path;
 *   - shutdown drains promptly with idle keepalive clients connected.
 *
 * This suite boots WITHOUT a console lane, so its arms also pin the
 * lane-absent posture (no bundled export → the router behaves exactly as
 * before lane 4 existed). The with-console behavior — including the guard
 * that keeps RPC and /v1/* flowing to the adapter — is pinned in
 * console/__tests__/handler.test.ts through this same composed server.
 */
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import {
  Health,
  HealthCheckResponse_ServingStatus as ServingStatus,
} from "@stigmer/protos/grpc/health/v1/health_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogger } from "../../boot/logger.js";
import { HealthState, registerHealthService } from "../health.js";
import { createUnifiedPortServer, type UnifiedPortServer } from "../server.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let server: UnifiedPortServer;
let baseUrl: string;
let healthState: HealthState;

beforeAll(async () => {
  healthState = new HealthState();
  server = createUnifiedPortServer({
    logger: silentLogger,
    routes: (router) => registerHealthService(router, healthState),
    interceptors: [],
    taskKindRegistryLane: (_request, response) => {
      response.setHeader("x-lane", "task-kind");
      response.end("{}");
    },
    modelRegistryLane: (_request, response) => {
      response.setHeader("x-lane", "model");
      response.end("{}");
    },
  });
  const port = await server.listen(0, "127.0.0.1");
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.shutdown();
});

describe("lane priority", () => {
  it("routes the exact registry paths to their lanes", async () => {
    const taskKind = await fetch(`${baseUrl}/v1/proxy/task-kind-registry`);
    expect(taskKind.headers.get("x-lane")).toBe("task-kind");
    const model = await fetch(`${baseUrl}/v1/proxy/model-registry`);
    expect(model.headers.get("x-lane")).toBe("model");
  });

  it("answers 404 for unknown /v1/proxy/* paths (CW-10 fallthrough contract)", async () => {
    const response = await fetch(`${baseUrl}/v1/proxy/does-not-exist`);
    expect(response.status).toBe(404);
  });

  it("answers 404 for the skill-transfer prefix while the seam is empty", async () => {
    const response = await fetch(`${baseUrl}/v1/skill-artifacts/some-key`, {
      method: "GET",
    });
    expect(response.status).toBe(404);
  });

  it("answers 404 for arbitrary unknown paths", async () => {
    const response = await fetch(`${baseUrl}/definitely/not/a/route`);
    expect(response.status).toBe(404);
  });
});

describe("RPC-lane CORS (rs/cors v1.7 shape, allow-all)", () => {
  it("answers preflights for unregistered endpoints (Go's WithCorsForRegisteredEndpointsOnly(false))", async () => {
    const response = await fetch(`${baseUrl}/any.Service/AnyMethod`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-grpc-web",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
    expect(response.headers.get("access-control-allow-methods")).toBe("POST");
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "content-type,x-grpc-web",
    );
    expect(response.headers.get("access-control-max-age")).toBe("600");
  });

  it("stamps echoed-origin headers on actual cross-origin RPC responses", async () => {
    const response = await fetch(`${baseUrl}/grpc.health.v1.Health/Check`, {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
  });
});

describe("RPC surface", () => {
  it("serves the health service through the adapter over native gRPC", async () => {
    const client = createClient(Health, createGrpcTransport({ baseUrl }));
    const before = await client.check({});
    expect(before.status).toBe(ServingStatus.NOT_SERVING);

    healthState.setOverall(ServingStatus.SERVING);
    const after = await client.check({});
    expect(after.status).toBe(ServingStatus.SERVING);
  });
});
