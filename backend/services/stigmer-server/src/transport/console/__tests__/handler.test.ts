/**
 * Console lane HTTP contract, proven through the real unified-port server
 * against a fixture export in a temp directory:
 *
 *   - documents, flight payloads, redirects, and the 404 posture arrive
 *     with the right status, Content-Type, and Cache-Control;
 *   - /config.json is synthesized per request with a Host-derived apiUrl;
 *   - the guard: RPC (POST and service-shaped GET), /v1/* paths, and
 *     OPTIONS preflights flow exactly as they do WITHOUT the lane — the
 *     wire-invisibility half of the P3 acceptance;
 *   - both protocol stacks serve the lane (the demux routes browsers to
 *     HTTP/1.1, but HTTP/2 clients share the same lane router);
 *   - asset discovery models "not bundled" as absence, not an error.
 */
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import {
  Health,
  HealthCheckResponse_ServingStatus as ServingStatus,
} from "@stigmer/protos/grpc/health/v1/health_pb";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect as http2Connect } from "node:http2";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogger } from "../../../boot/logger.js";
import { HealthState, registerHealthService } from "../../health.js";
import {
  createUnifiedPortServer,
  type UnifiedPortServer,
} from "../../server.js";
import { resolveConsoleAssets } from "../assets.js";
import { createConsoleLane } from "../handler.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/** The fixture export: path → content. Mirrors client-apps/web/out's shape. */
const FIXTURE_FILES: Record<string, string> = {
  "index.html": "<html>app shell</html>",
  "404.html": "<html>not found page</html>",
  "embed.js": "// embed loader",
  "conversations.html": "<html>conversations</html>",
  "conversations.txt": "flight:conversations",
  "sessions/__placeholder__.html": "<html>session detail</html>",
  "sessions/__placeholder__.txt": "flight:session",
  "sessions/__placeholder__/__next.sessions.txt": "flight:nested-session",
  "_next/static/chunks/app-1a2b3c.js": "// hashed chunk",
};

let fixtureRoot: string;
let server: UnifiedPortServer;
let port: number;
let baseUrl: string;

beforeAll(async () => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), "console-lane-fixture-"));
  for (const [file, content] of Object.entries(FIXTURE_FILES)) {
    const target = path.join(fixtureRoot, ...file.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  const assets = resolveConsoleAssets(fixtureRoot, silentLogger);
  if (assets === undefined) {
    throw new Error("fixture export was not discovered");
  }
  const healthState = new HealthState();
  healthState.setOverall(ServingStatus.SERVING);
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
    consoleLane: createConsoleLane({
      assets,
      grpcPort: 7234,
      logger: silentLogger,
    }),
  });
  port = await server.listen(0, "127.0.0.1");
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.shutdown();
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("document serving", () => {
  it("serves the root document with the app shell and no-cache", async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toBe(FIXTURE_FILES["index.html"]);
  });

  it("serves a dynamic deep link its placeholder document", async () => {
    const response = await fetch(`${baseUrl}/sessions/ses_abc123`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      FIXTURE_FILES["sessions/__placeholder__.html"],
    );
  });

  it("serves RSC flight payloads for dynamic routes as text/plain", async () => {
    const flat = await fetch(`${baseUrl}/sessions/ses_abc123.txt`);
    expect(flat.status).toBe(200);
    expect(flat.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await flat.text()).toBe("flight:session");

    const nested = await fetch(
      `${baseUrl}/sessions/ses_abc123/__next.sessions.txt`,
    );
    expect(nested.status).toBe(200);
    expect(await nested.text()).toBe("flight:nested-session");
  });

  it("serves unknown URLs the real 404 page WITH a 404 status", async () => {
    const response = await fetch(`${baseUrl}/zz-definitely/zz-not/zz-here`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(await response.text()).toBe(FIXTURE_FILES["404.html"]);
  });

  it("301s trailing slashes to the canonical URL, query intact", async () => {
    const response = await fetch(`${baseUrl}/conversations/?tab=all`, {
      redirect: "manual",
    });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/conversations?tab=all");
  });

  it("marks hashed build assets immutable and the embed loader short-lived", async () => {
    const chunk = await fetch(`${baseUrl}/_next/static/chunks/app-1a2b3c.js`);
    expect(chunk.status).toBe(200);
    expect(chunk.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    const embed = await fetch(`${baseUrl}/embed.js`);
    expect(embed.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("answers HEAD with the document's headers and no body", async () => {
    const response = await fetch(`${baseUrl}/conversations`, {
      method: "HEAD",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(
      String(FIXTURE_FILES["conversations.html"]!.length),
    );
    expect(await response.text()).toBe("");
  });

  it("rejects malformed percent-escapes with the 404 page", async () => {
    const response = await fetch(`${baseUrl}/%zz`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe(FIXTURE_FILES["404.html"]);
  });
});

describe("/config.json synthesis", () => {
  it("derives apiUrl from the request Host and forbids caching", async () => {
    const response = await fetch(`${baseUrl}/config.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe(
      "no-cache, no-store, must-revalidate",
    );
    expect(await response.json()).toEqual({
      apiUrl: `http://127.0.0.1:${port}`,
      appUrl: "",
      authMode: "disabled",
      oidcIssuer: "",
      oidcClientId: "",
      oidcAudience: "",
    });
  });
});

describe("the guard: RPC and /v1/* flow exactly as without the lane", () => {
  it("keeps the adapter's terse 404 for unknown /v1/proxy/* (CW-10)", async () => {
    const response = await fetch(`${baseUrl}/v1/proxy/does-not-exist`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).not.toBe(
      "text/html; charset=utf-8",
    );
  });

  it("leaves service-shaped GETs to the adapter, not the 404 page", async () => {
    const response = await fetch(`${baseUrl}/grpc.health.v1.Health/Check`);
    expect(response.headers.get("content-type")).not.toBe(
      "text/html; charset=utf-8",
    );
  });

  it("answers RPC preflights on console-looking paths (CORS untouched)", async () => {
    const response = await fetch(`${baseUrl}/conversations`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
  });

  it("serves native gRPC through the adapter with the lane installed", async () => {
    const client = createClient(Health, createGrpcTransport({ baseUrl }));
    const check = await client.check({});
    expect(check.status).toBe(ServingStatus.SERVING);
  });
});

describe("HTTP/2 stack", () => {
  it("serves console documents over a prior-knowledge h2c session", async () => {
    const session = http2Connect(baseUrl);
    try {
      const { status, body } = await new Promise<{
        status: number;
        body: string;
      }>((resolve, reject) => {
        session.on("error", reject);
        const stream = session.request({
          ":method": "GET",
          ":path": "/sessions/ses_abc123",
        });
        let status = 0;
        stream.on("response", (headers) => {
          status = Number(headers[":status"]);
        });
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () =>
          resolve({ status, body: Buffer.concat(chunks).toString("utf8") }),
        );
        stream.on("error", reject);
      });
      expect(status).toBe(200);
      expect(body).toBe(FIXTURE_FILES["sessions/__placeholder__.html"]);
    } finally {
      session.close();
    }
  });
});

describe("asset discovery", () => {
  it("models a missing or empty export as absence, not an error", () => {
    expect(
      resolveConsoleAssets(
        path.join(fixtureRoot, "zz-does-not-exist"),
        silentLogger,
      ),
    ).toBeUndefined();
    const empty = mkdtempSync(path.join(tmpdir(), "console-empty-"));
    try {
      expect(resolveConsoleAssets(empty, silentLogger)).toBeUndefined();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
