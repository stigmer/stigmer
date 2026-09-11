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
 *   5. garbage credentials keep the Q6 unclaimed-token rejection;
 *   6. (20260911.11) the identity-account arms: an unprovisioned subject is
 *      idp-shaped (whoAmI NOT_FOUND, writes stamped with the raw sub);
 *      provisionMyAccount creates the account under the derived id with
 *      the issuer's userinfo profile; from then on the verifier resolves
 *      the subject to the account id and API keys minted before OR after
 *      provisioning answer whoAmI with the owner's account; no operator
 *      account exists under the posture.
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

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";
import { PlatformQueryController } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import {
  Health,
  HealthCheckResponse_ServingStatus,
} from "@stigmer/protos/grpc/health/v1/health_pb";

import { loadConfig } from "../config.js";
import { composeServer } from "../compose.js";
import type { ComposedServer } from "../compose.js";
import { createLogger } from "../logger.js";
import {
  ACCOUNT_NOT_FOUND_FOR_CALLER_MESSAGE,
  USERINFO_UNAVAILABLE_PREFIX,
  accountIdFor,
} from "../../domain/identityaccount/constants.js";
import { AUTHENTICATION_TOKEN_MISSING_MESSAGE } from "../../pipeline/interceptors/auth.js";

const AUDIENCE = "https://api.stigmer.test/";

let dir: string;
let issuerServer: Server;
let issuer: string;
let privateKey: GenerateKeyPairResult["privateKey"];
// A lever for the UNAVAILABLE arm: the issuer's /userinfo answers 503 for
// this subject while set. Undefined = every subject is served.
let userinfoRefusesSub: string | undefined;
let server: ComposedServer;
let port: number;
// A key minted while its owner was still idp-shaped: its creator stamp is
// the raw sub. The identity-account arms prove that stamp resolves to the
// owner's account once one exists (20260911.11 A1's derived id).
let keyMintedBeforeProvisioning: string;

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
    if (req.url === "/userinfo") {
      // The provisioning lane's profile source (20260911.11 A1/Q-IA-2):
      // answers the bearer's own claims as an IdP would, given_name and
      // family_name included — the signature was already proven upstream.
      const header = req.headers.authorization ?? "";
      const token = header.startsWith("Bearer ")
        ? header.slice("Bearer ".length)
        : "";
      const payloadSegment = token.split(".")[1];
      if (payloadSegment === undefined) {
        res.statusCode = 401;
        res.end();
        return;
      }
      const claims = JSON.parse(
        Buffer.from(payloadSegment, "base64url").toString("utf8"),
      ) as { sub?: string; email?: string };
      if (
        userinfoRefusesSub !== undefined &&
        claims.sub === userinfoRefusesSub
      ) {
        res.statusCode = 503;
        res.end();
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          sub: claims.sub ?? "",
          email: claims.email ?? "",
          given_name: "Composed",
          family_name: "User",
          picture: `${issuer}/pictures/${encodeURIComponent(claims.sub ?? "")}`,
        }),
      );
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
    keyMintedBeforeProvisioning = second.spec?.keyHash ?? "";
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

describe("identity accounts under the OIDC posture (20260911.11; Q-IA-2, A1, A2)", () => {
  const SUB = "auth0|loop-user";
  const accountId = accountIdFor(SUB);

  it("no operator account exists under an authentication posture — the boot-time ensure is trusted-local only", async () => {
    const rows = await server.store.listResources(
      ApiResourceKind.identity_account,
    );
    expect(rows).toHaveLength(0);
  });

  it("whoAmI for an unprovisioned subject is NOT_FOUND with the cloud's copy, and its writes stay stamped with the raw sub", async () => {
    const token = await mintOidcToken(SUB, "loop@example.com");
    const query = createClient(
      IdentityAccountQueryController,
      transportWith(token),
    );
    const error = await query.whoAmI({}).catch((e: unknown) => e);
    expect(ConnectError.from(error).code).toBe(Code.NotFound);
    expect(ConnectError.from(error).rawMessage).toBe(
      ACCOUNT_NOT_FOUND_FOR_CALLER_MESSAGE,
    );
  });

  it("provisionMyAccount creates the account under the derived id with the userinfo profile", async () => {
    const token = await mintOidcToken(SUB, "loop@example.com");
    const command = createClient(
      IdentityAccountCommandController,
      transportWith(token),
    );
    const account = await command.provisionMyAccount({});
    expect(account.metadata?.id).toBe(accountId);
    expect(account.metadata?.name).toBe("loop@example.com");
    expect(account.spec).toMatchObject({
      idpId: SUB,
      email: "loop@example.com",
      firstName: "Composed",
      lastName: "User",
      provisioningMode: IdentityAccountProvisioningMode.direct,
      isMachineAccount: false,
    });
    // The account is created BY the subject it is for: the stamp is the
    // sub the verifier admitted idp-shaped — no account existed yet.
    expect(account.status?.audit?.specAudit?.createdBy?.id).toBe(SUB);
  });

  it("from the next request on, the verifier resolves the subject to the account id — whoAmI answers and writes are stamped with it", async () => {
    const token = await mintOidcToken(SUB, "loop@example.com");
    const query = createClient(
      IdentityAccountQueryController,
      transportWith(token),
    );
    const me = await query.whoAmI({});
    expect(me.metadata?.id).toBe(accountId);

    const keys = createClient(ApiKeyCommandController, transportWith(token));
    const key = await keys.create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: { name: "minted after provisioning", org: "local" },
      spec: {},
    });
    expect(key.status?.audit?.specAudit?.createdBy?.id).toBe(accountId);
    expect(key.status?.audit?.specAudit?.createdBy?.email).toBe(
      "loop@example.com",
    );

    // Over that key, whoAmI is the owner's account — the key is the user.
    const overKey = createClient(
      IdentityAccountQueryController,
      transportWith(key.spec?.keyHash ?? ""),
    );
    expect((await overKey.whoAmI({})).metadata?.id).toBe(accountId);
  });

  it("a key minted BEFORE provisioning still resolves to the owner's account — the raw-sub stamp derives to the same id", async () => {
    const overLegacyKey = createClient(
      IdentityAccountQueryController,
      transportWith(keyMintedBeforeProvisioning),
    );
    expect((await overLegacyKey.whoAmI({})).metadata?.id).toBe(accountId);
  });

  it("provisionMyAccount is idempotent for a provisioned subject", async () => {
    const token = await mintOidcToken(SUB, "loop@example.com");
    const command = createClient(
      IdentityAccountCommandController,
      transportWith(token),
    );
    const before = (
      await server.store.listResources(ApiResourceKind.identity_account)
    ).length;
    const again = await command.provisionMyAccount({});
    expect(again.metadata?.id).toBe(accountId);
    expect(
      (await server.store.listResources(ApiResourceKind.identity_account))
        .length,
    ).toBe(before);
  });

  it("two concurrent first logins for one subject end in exactly one account", async () => {
    const token = await mintOidcToken("auth0|racer", "racer@example.com");
    const command = createClient(
      IdentityAccountCommandController,
      transportWith(token),
    );
    const before = (
      await server.store.listResources(ApiResourceKind.identity_account)
    ).length;
    const [a, b] = await Promise.all([
      command.provisionMyAccount({}),
      command.provisionMyAccount({}),
    ]);
    expect(a.metadata?.id).toBe(accountIdFor("auth0|racer"));
    expect(b.metadata?.id).toBe(a.metadata?.id);
    expect(
      (await server.store.listResources(ApiResourceKind.identity_account))
        .length,
    ).toBe(before + 1);
  });

  it("a userinfo failure is UNAVAILABLE with the cloud's copy, and no account is created", async () => {
    // A real token (the verifier must admit it) whose subject the issuer's
    // /userinfo refuses while the lever is set.
    const token = await mintOidcToken(
      "auth0|userinfo-down",
      "down@example.com",
    );
    userinfoRefusesSub = "auth0|userinfo-down";
    try {
      const command = createClient(
        IdentityAccountCommandController,
        transportWith(token),
      );
      const error = await command
        .provisionMyAccount({})
        .catch((e: unknown) => e);
      expect(ConnectError.from(error).code).toBe(Code.Unavailable);
      expect(
        ConnectError.from(error).rawMessage.startsWith(
          USERINFO_UNAVAILABLE_PREFIX,
        ),
      ).toBe(true);
      const query = createClient(
        IdentityAccountQueryController,
        transportWith(token),
      );
      const missing = await query.whoAmI({}).catch((e: unknown) => e);
      expect(ConnectError.from(missing).code).toBe(Code.NotFound);
    } finally {
      userinfoRefusesSub = undefined;
    }
  });
});
