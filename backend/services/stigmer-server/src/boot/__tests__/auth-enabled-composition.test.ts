/**
 * Pins the auth-enabled modeled state end to end (O3 rulings Q1+Q2+Q3)
 * through the REAL stack: a composed server with STIGMER_OIDC_ISSUER
 * pointing at a hermetic local issuer, real RS256 tokens, real gRPC.
 *
 * The full credential loop this proves is the multi-user self-host story:
 *   1. tokenless requests are UNAUTHENTICATED "authentication token
 *      missing" (the Java copy) — except is_public methods (getServerInfo)
 *      and the gRPC health service by name (a Kubernetes grpc probe;
 *      stigmer#974, entry 20260904.02);
 *   2. an OIDC access token authenticates; the caller's sub becomes the
 *      audit identity on resources it creates;
 *   3. an API key minted over that OIDC session authenticates as its
 *      owning user (the runner's credential lane, ruling Q3 — the runner
 *      presents exactly such a key via STIGMER_TOKEN);
 *   4. deleting the key revokes it on the very next request;
 *   5. garbage credentials keep the Q6 unclaimed-token rejection.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { once } from "node:events";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Interceptor, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { GenerateKeyPairResult } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { PlatformQueryController } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import {
  Health,
  HealthCheckResponse_ServingStatus,
} from "@stigmer/protos/grpc/health/v1/health_pb";

import { loadConfig } from "../config.js";
import { composeServer } from "../compose.js";
import type { ComposedServer } from "../compose.js";
import { createLogger } from "../logger.js";
import { AUTHENTICATION_TOKEN_MISSING_MESSAGE } from "../../pipeline/interceptors/auth.js";

const AUDIENCE = "https://api.stigmer.test/";

let dir: string;
let issuerServer: Server;
let issuer: string;
let privateKey: GenerateKeyPairResult["privateKey"];
let server: ComposedServer;
let port: number;

function bearer(token: string): Interceptor {
  return (next) => (request) => {
    request.header.set("authorization", `Bearer ${token}`);
    return next(request);
  };
}

function transportWith(token?: string): Transport {
  return createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
    interceptors: token !== undefined ? [bearer(token)] : [],
  });
}

async function mintOidcToken(sub: string, email: string): Promise<string> {
  return new SignJWT({ email, name: "Composed Test User" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience(AUDIENCE)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "test-key",
    alg: "RS256",
  };
  issuerServer = createServer((req, res) => {
    if (req.url === "/.well-known/openid-configuration") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
      return;
    }
    if (req.url === "/jwks") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  issuerServer.listen(0, "127.0.0.1");
  await once(issuerServer, "listening");
  const address = issuerServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("issuer server did not bind a port");
  }
  issuer = `http://127.0.0.1:${address.port}`;

  dir = mkdtempSync(path.join(tmpdir(), "auth-enabled-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      STIGMER_OIDC_ISSUER: issuer,
      STIGMER_OIDC_AUDIENCE: AUDIENCE,
    }),
    logger: createLogger({ level: "error", pretty: false, write: () => {} }),
    portOverride: 0,
    host: "127.0.0.1",
  });
  port = await server.start();
});

afterAll(async () => {
  await server.shutdown();
  issuerServer.close();
  await once(issuerServer, "close");
  rmSync(dir, { recursive: true, force: true });
});

describe("the require-authentication posture on the wire", () => {
  it("a tokenless RPC is UNAUTHENTICATED with the Java byte-pinned copy", async () => {
    const query = createClient(ApiKeyQueryController, transportWith());
    const error = await query.findAll({}).catch((e: unknown) => e);
    expect(ConnectError.from(error).code).toBe(Code.Unauthenticated);
    expect(ConnectError.from(error).rawMessage).toBe(
      AUTHENTICATION_TOKEN_MISSING_MESSAGE,
    );
  });

  it("is_public methods stay reachable tokenless (getServerInfo)", async () => {
    const platform = createClient(PlatformQueryController, transportWith());
    const info = await platform.getServerInfo({});
    expect(info.edition).not.toBe("");
  });

  it("the gRPC health service stays reachable tokenless — a Kubernetes grpc probe survives the posture (stigmer#974)", async () => {
    const health = createClient(Health, transportWith());
    const response = await health.check({ service: "" });
    expect(response.status).toBe(HealthCheckResponse_ServingStatus.SERVING);
  });

  it("a garbage bearer keeps the Q6 unclaimed-token rejection", async () => {
    const query = createClient(
      ApiKeyQueryController,
      transportWith("not-a-credential"),
    );
    const error = await query.findAll({}).catch((e: unknown) => e);
    expect(ConnectError.from(error).code).toBe(Code.Unauthenticated);
    expect(ConnectError.from(error).rawMessage).toBe(
      "the presented token was not accepted by any configured identity verifier",
    );
  });
});

describe("the full credential loop (OIDC login → API key → revocation)", () => {
  let apiKeyPlaintext: string;
  let apiKeyId: string;

  it("an OIDC token authenticates and its sub becomes the audit identity", async () => {
    const oidcToken = await mintOidcToken(
      "auth0|loop-user",
      "loop@example.com",
    );
    const command: Client<typeof ApiKeyCommandController> = createClient(
      ApiKeyCommandController,
      transportWith(oidcToken),
    );
    const created = await command.create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: { name: "loop key", org: "local" },
      spec: {},
    });
    apiKeyPlaintext = created.spec?.keyHash ?? "";
    apiKeyId = created.metadata?.id ?? "";
    expect(apiKeyPlaintext.startsWith("stk_")).toBe(true);
    expect(created.status?.audit?.specAudit?.createdBy?.id).toBe(
      "auth0|loop-user",
    );
    expect(created.status?.audit?.specAudit?.createdBy?.email).toBe(
      "loop@example.com",
    );
  });

  it("the minted API key authenticates as its owning user (the runner's lane)", async () => {
    const query = createClient(
      ApiKeyQueryController,
      transportWith(apiKeyPlaintext),
    );
    const fetched = await query.get({ value: apiKeyId });
    expect(fetched.metadata?.id).toBe(apiKeyId);

    // A write over the key stamps the OWNER's identity on the audit — the
    // key is the user, not a second principal.
    const command = createClient(
      ApiKeyCommandController,
      transportWith(apiKeyPlaintext),
    );
    const second = await command.create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: { name: "minted over the api key", org: "local" },
      spec: {},
    });
    expect(second.status?.audit?.specAudit?.createdBy?.id).toBe(
      "auth0|loop-user",
    );
  });

  it("deleting the key revokes it on the very next request", async () => {
    const oidcToken = await mintOidcToken(
      "auth0|loop-user",
      "loop@example.com",
    );
    const command = createClient(
      ApiKeyCommandController,
      transportWith(oidcToken),
    );
    await command.delete({ value: apiKeyId });

    const query = createClient(
      ApiKeyQueryController,
      transportWith(apiKeyPlaintext),
    );
    const error = await query.findAll({}).catch((e: unknown) => e);
    expect(ConnectError.from(error).code).toBe(Code.Unauthenticated);
    expect(ConnectError.from(error).rawMessage).toBe("invalid token");
  });
});
