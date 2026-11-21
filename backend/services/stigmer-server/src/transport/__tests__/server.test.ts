/**
 * Unified-port lane router smoke tests, pinned to the lane contract and the
 * registry-proxy conformance suite's assertions:
 *
 *   - lane priority: exact registry paths win over everything;
 *   - unknown paths (incl. unknown /v1/proxy/*) reach the adapter's 404;
 *   - RPC-lane preflights answer for ANY path, registered or not, in
 *     rs/cors v1.7 shape (origin echo, method/headers echo, max-age 600);
 *   - actual cross-origin RPC responses carry the echoed-origin headers;
 *   - the skill-transfer prefix is a seam: with no handler installed it
 *     falls through to 404 exactly like an unknown path;
 *   - the runner artifact lane's two exact paths reach it when it is
 *     installed, a query string included, and nothing else under them
 *     does; with none installed they are the adapter's 404;
 *   - shutdown drains promptly with idle keepalive clients connected;
 *   - the health service keeps whether sessions can start as its own named
 *     status (stigmer.sandboxes), apart from the overall one, and answers
 *     it over Connect JSON as the Kubernetes operator asks it.
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
} from "@stigmer/apis/grpc/health/v1/health_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogger } from "../../boot/logger.js";
import {
  HealthState,
  registerHealthService,
  SANDBOXES_HEALTH_SERVICE,
} from "../health.js";
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
    const model = await fetch(`${baseUrl}/v1/proxy/model-registry`);
    expect(model.headers.get("x-lane")).toBe("model");
  });

  it("answers 404 for unknown /v1/proxy/* paths (the conformance fallthrough contract)", async () => {
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

describe("the runner artifact lane", () => {
  const UPLOAD = "/v1/proxy/artifacts/presigned-upload-url";
  const DOWNLOAD = "/v1/proxy/artifacts/presigned-download-url";

  it("is the adapter's 404 while no lane is installed", async () => {
    expect((await fetch(`${baseUrl}${UPLOAD}`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${baseUrl}${DOWNLOAD}`, { method: "POST" })).status).toBe(404);
  });

  it("routes exactly its two paths to the installed lane, a query string included", async () => {
    const withLane = createUnifiedPortServer({
      logger: silentLogger,
      routes: () => {},
      interceptors: [],
      modelRegistryLane: (_request, response) => {
        response.end("{}");
      },
      runnerArtifactLane: (request, response) => {
        response.setHeader("x-lane", "runner-artifacts");
        response.setHeader("x-url", request.url ?? "");
        response.end();
      },
    });
    const port = await withLane.listen(0, "127.0.0.1");
    try {
      const at = `http://127.0.0.1:${port}`;
      for (const route of [UPLOAD, DOWNLOAD, `${UPLOAD}?attempt=2`]) {
        const response = await fetch(`${at}${route}`, { method: "POST" });
        expect(response.headers.get("x-lane"), route).toBe("runner-artifacts");
        expect(response.headers.get("x-url"), route).toBe(route);
      }
      const beneath = await fetch(`${at}${UPLOAD}/more`, { method: "POST" });
      expect(beneath.headers.get("x-lane")).toBeNull();
      expect(beneath.status).toBe(404);
    } finally {
      await withLane.shutdown();
    }
  });
});

describe("RPC-lane CORS (rs/cors v1.7 shape, allow-all)", () => {
  it("answers preflights for unregistered endpoints", async () => {
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

  it("keeps whether sessions can start as its own named status, apart from the overall one", async () => {
    const client = createClient(Health, createGrpcTransport({ baseUrl }));
    healthState.setOverall(ServingStatus.SERVING);
    healthState.set(SANDBOXES_HEALTH_SERVICE, ServingStatus.NOT_SERVING);

    expect((await client.check({})).status).toBe(ServingStatus.SERVING);
    expect(
      (await client.check({ service: SANDBOXES_HEALTH_SERVICE })).status,
    ).toBe(ServingStatus.NOT_SERVING);
    const listed = await client.list({});
    expect(Object.keys(listed.statuses).sort()).toEqual([
      "",
      SANDBOXES_HEALTH_SERVICE,
    ]);

    // The operator asks it over Connect JSON (deploy/operator/internal/serverhealth).
    healthState.set(SANDBOXES_HEALTH_SERVICE, ServingStatus.SERVING);
    const response = await fetch(`${baseUrl}/grpc.health.v1.Health/Check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: SANDBOXES_HEALTH_SERVICE }),
    });
    expect(await response.json()).toEqual({ status: "SERVING" });
  });
});
