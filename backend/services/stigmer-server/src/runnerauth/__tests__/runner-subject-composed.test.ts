/**
 * Pins the runner-subject lane as the composition root wires it, over
 * real boots, in the three authorization postures the server can be in:
 *
 *   - OIDC with no unit Authorizer (the self-host's shape; the BUILT-IN
 *     posture): the runner-subject verifier is composed BETWEEN `apikey`
 *     and `oidc`. The order is the contract, not a detail: the OIDC
 *     verifier claims ANY JWT-shaped token and throws when it cannot
 *     verify it, and the server's own runner token is JWT-shaped — placed
 *     after `oidc`, the runner verifier would never see its own token,
 *     and every runner call would fail as the OIDC verifier's fault. That
 *     is exactly what a 3.15.x self-host with sign-in on does today
 *     (stigmer#1137: no agent execution can run for anyone), and this
 *     file's wire arms are the regression test for it.
 *   - trusted-local: no runner verifier is composed. Nothing to
 *     delegate; the exchange token stays the decrypt-lane discriminator.
 *   - a unit's own Authorizer: no runner verifier is composed. The
 *     composition brings its own credential story (its provider, its
 *     verifiers), and open source must not stamp identities beside it.
 *
 * The wire arms under the built-in posture prove the whole lane with no
 * engine: a live WORKFLOW execution row (its owner is DIRECT — the
 * creator stamp — so no session is needed) is seeded in the composed
 * server's store, stamped by a person who provisioned over the wire; the
 * server's own key mints the run credential; presenting it on the
 * execution's own `get` is ADMITTED (the runner acts as the person who
 * created the run), and once the row is terminal the same credential is
 * UNAUTHENTICATED. A forged token that names our type is refused by the
 * runner verifier's sentence — never INTERNAL, never the OIDC copy.
 *
 * And the exchange as a MINT GATE (2026-09-16): over the same boot, a
 * second person asking getRunnerScopedToken for Carol's run is
 * PERMISSION_DENIED — the line the live claim check recorded the other
 * way round ("A's key … for B's run: minted") — while Carol is minted a
 * run credential that admits her on the wire, and a run that does not
 * exist is NOT_FOUND with the copy a `get` would answer.
 *
 * Written failing on 2026-09-16; the verifier that follows turns it green. The per-arm
 * proofs live in runner-subject-verifier.test.ts and
 * built-in-runner-credential-provider.test.ts; this file is the entry's
 * definition of done at the composition root.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { once } from "node:events";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Interceptor, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { GenerateKeyPairResult } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { WorkflowExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { PlatformQueryController } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import type { ServerExtension } from "../../extensions/registry.js";
import {
  baseConfig,
  fakeVerifier,
  silentLogger,
} from "../../extensions/__tests__/composed-support.js";
import { authenticateBearerToken } from "../../pipeline/interceptors/auth.js";
import {
  RUN_CREDENTIAL_NOT_RUNS_PERSON_MESSAGE,
  RUNNER_CREDENTIAL_INVALID_MESSAGE,
  RUNNER_CREDENTIAL_NOT_LIVE_MESSAGE,
  RUNNER_VERIFIER_NAME,
} from "../constants.js";
import { isClockedToken, TOKEN_TYPE_EXECUTION_SCOPED } from "../runnerauth.js";

const AUDIENCE = "https://api.stigmer.test/";
const ORG = "runner-subject-org";

const segment = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

function forgedRunnerToken(executionId: string): string {
  return `${segment({ alg: "HS256", typ: "JWT" })}.${segment({
    token_type: TOKEN_TYPE_EXECUTION_SCOPED,
    execution_id: executionId,
    iat: 1,
  })}.${segment("not-the-servers-mac")}`;
}

function bearer(token: string): Interceptor {
  return (next) => (request) => {
    request.header.set("authorization", `Bearer ${token}`);
    return next(request);
  };
}

function transportFor(port: number, token: string): Transport {
  return createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
    interceptors: [bearer(token)],
  });
}

async function failureOf(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected the call to fail");
}

/** The smallest hermetic issuer the OIDC posture boots against: discovery, JWKS, userinfo. */
async function startIssuer(): Promise<{
  issuer: string;
  mint(sub: string, email: string): Promise<string>;
  close(): Promise<void>;
}> {
  const keys: GenerateKeyPairResult = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "test-key",
    alg: "RS256",
  };
  let issuer = "";
  const server: Server = createServer((req, res) => {
    if (req.url === "/.well-known/openid-configuration") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          issuer,
          jwks_uri: `${issuer}/jwks`,
          userinfo_endpoint: `${issuer}/userinfo`,
        }),
      );
      return;
    }
    if (req.url === "/jwks") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (req.url === "/userinfo") {
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const claims = JSON.parse(
        Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
      ) as { sub?: string; email?: string };
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          sub: claims.sub ?? "",
          email: claims.email ?? "",
          given_name: "Runner",
          family_name: "Subject",
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("issuer server did not bind a port");
  }
  issuer = `http://127.0.0.1:${address.port}`;
  return {
    issuer,
    mint: (sub, email) =>
      new SignJWT({ email, name: "Runner Subject" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(issuer)
        .setAudience(AUDIENCE)
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(keys.privateKey),
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

describe("the built-in posture (OIDC, no unit Authorizer): the runner acts as the run's human", () => {
  let dir: string;
  let issuer: Awaited<ReturnType<typeof startIssuer>>;
  let server: ComposedServer;
  let port: number;
  let carolId: string;

  beforeAll(async () => {
    issuer = await startIssuer();
    dir = mkdtempSync(path.join(tmpdir(), "runner-subject-oidc-"));
    server = await composeServer({
      config: loadConfig({
        ...baseConfig(dir),
        STIGMER_OIDC_ISSUER: issuer.issuer,
        STIGMER_OIDC_AUDIENCE: AUDIENCE,
      }),
      logger: silentLogger,
      extensions: [],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
    // Carol provisions over the wire, the console's first sign-in; her
    // runs are stamped with her account id from then on.
    const carol = createClient(
      IdentityAccountCommandController,
      transportFor(port, await issuer.mint("auth0|carol", "carol@example.com")),
    );
    carolId = (await carol.provisionMyAccount({})).metadata?.id ?? "";
    expect(carolId).not.toBe("");
  });

  afterAll(async () => {
    await server.shutdown();
    await issuer.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function seedWorkflowExecution(
    id: string,
    phase: ExecutionPhase,
  ): Promise<void> {
    await server.store.saveResource(
      ApiResourceKind.workflow_execution,
      id,
      WorkflowExecutionSchema,
      create(WorkflowExecutionSchema, {
        metadata: { id, name: id, org: ORG },
        status: { phase, audit: { specAudit: { createdBy: { id: carolId } } } },
      }),
    );
  }

  it("the chain is apikey → platform-client → runner → oidc: ours claims the server's own token before the OIDC verifier can fault on it", () => {
    // The platform-client verifier claims only `iss: "stigmer"` user tokens
    // and a runner token carries no `iss`, so the two lanes are disjoint and
    // both sit ahead of the OIDC verifier for the same reason.
    expect(server.identityVerifiers.map((verifier) => verifier.name)).toEqual([
      "apikey",
      "platform-client",
      RUNNER_VERIFIER_NAME,
      "oidc",
    ]);
  });

  it("a forged token naming our type is refused by the runner verifier's sentence — never INTERNAL, never the OIDC copy (stigmer#1137's regression arm)", async () => {
    const failure = await failureOf(
      authenticateBearerToken(
        server.identityVerifiers,
        forgedRunnerToken("wex_forged"),
        silentLogger,
      ),
    );
    expect(failure.code).toBe(Code.Unauthenticated);
    expect(failure.rawMessage).toBe(RUNNER_CREDENTIAL_INVALID_MESSAGE);
  });

  it("an OIDC token still walks through to the OIDC verifier — the runner verifier passes on every shape but its own", async () => {
    const identity = await authenticateBearerToken(
      server.identityVerifiers,
      await issuer.mint("auth0|carol", "carol@example.com"),
      silentLogger,
    );
    expect(identity?.identityId).toBe(carolId);
    expect(identity?.callerClass).toBe("user");
  });

  it("the run credential the server mints for a live run, presented on the run's own read, is ADMITTED as the person who created it", async () => {
    await seedWorkflowExecution(
      "wex_live",
      ExecutionPhase.EXECUTION_IN_PROGRESS,
    );
    const credential = server.runnerAuthService.mintRunCredential("wex_live");

    const identity = await authenticateBearerToken(
      server.identityVerifiers,
      credential,
      silentLogger,
    );
    expect(identity).toMatchObject({
      identityId: carolId,
      callerClass: "runner",
      email: "carol@example.com",
      rawToken: credential,
    });

    const asRunner = createClient(
      WorkflowExecutionQueryController,
      transportFor(port, credential),
    );
    const row = await asRunner.get({ value: "wex_live" });
    expect(row.metadata?.id).toBe("wex_live");
  });

  it("once the run is over, the same credential is UNAUTHENTICATED with the liveness sentence — validity is the row's", async () => {
    await seedWorkflowExecution(
      "wex_done",
      ExecutionPhase.EXECUTION_IN_PROGRESS,
    );
    const credential = server.runnerAuthService.mintRunCredential("wex_done");
    const asRunner = createClient(
      WorkflowExecutionQueryController,
      transportFor(port, credential),
    );
    expect((await asRunner.get({ value: "wex_done" })).metadata?.id).toBe(
      "wex_done",
    );

    await seedWorkflowExecution("wex_done", ExecutionPhase.EXECUTION_COMPLETED);
    const failure = await failureOf(asRunner.get({ value: "wex_done" }));
    expect(failure.code).toBe(Code.Unauthenticated);
    expect(failure.rawMessage).toBe(RUNNER_CREDENTIAL_NOT_LIVE_MESSAGE);
  });

  it("a credential bound to one run does not open another — the binding is the capability", async () => {
    await seedWorkflowExecution(
      "wex_mine",
      ExecutionPhase.EXECUTION_IN_PROGRESS,
    );
    await seedWorkflowExecution(
      "wex_other",
      ExecutionPhase.EXECUTION_IN_PROGRESS,
    );
    const credential = server.runnerAuthService.mintRunCredential("wex_mine");
    const asRunner = createClient(
      WorkflowExecutionQueryController,
      transportFor(port, credential),
    );
    // Admitted as Carol, who created both rows — so the read of the OTHER
    // run succeeds AS CAROL: the credential narrows WHO the runner is,
    // not WHICH rows that person may read. Pinned so the reach is stated,
    // not discovered (the cloud's sandbox token has the same reach).
    expect((await asRunner.get({ value: "wex_other" })).metadata?.id).toBe(
      "wex_other",
    );
  });

  describe("the exchange is a mint gate", () => {
    let bruceToken: string;

    beforeAll(async () => {
      // A second signed-in person. Provisioning after Carol makes Bruce a
      // member of every organization she created — the roles rule — which
      // is exactly the caller the gate must refuse: a legitimate member
      // asking for someone else's run.
      bruceToken = await issuer.mint("auth0|bruce", "bruce@example.com");
      const bruce = createClient(
        IdentityAccountCommandController,
        transportFor(port, bruceToken),
      );
      expect((await bruce.provisionMyAccount({})).metadata?.id).not.toBe("");
      await seedWorkflowExecution(
        "wex_carols",
        ExecutionPhase.EXECUTION_IN_PROGRESS,
      );
    });

    it("another member asking for Carol's run is PERMISSION_DENIED — the impersonation path, closed", async () => {
      const platform = createClient(
        PlatformQueryController,
        transportFor(port, bruceToken),
      );
      const failure = await failureOf(
        platform.getRunnerScopedToken({
          scope: { case: "workflowExecutionId", value: "wex_carols" },
        }),
      );
      expect(failure.code).toBe(Code.PermissionDenied);
      expect(failure.rawMessage).toBe(RUN_CREDENTIAL_NOT_RUNS_PERSON_MESSAGE);
    });

    it("the run's own person is minted a run credential that admits her on the wire", async () => {
      const platform = createClient(
        PlatformQueryController,
        transportFor(
          port,
          await issuer.mint("auth0|carol", "carol@example.com"),
        ),
      );
      const minted = await platform.getRunnerScopedToken({
        scope: { case: "workflowExecutionId", value: "wex_carols" },
      });
      expect(minted.runnerScopedToken).not.toBe("");
      expect(minted.tokenType).toBe("Bearer");
      // A run credential has no clock; the proto default says so.
      expect(minted.expiresInSeconds).toBe(0);
      expect(isClockedToken(minted.runnerScopedToken)).toBe(false);

      const identity = await authenticateBearerToken(
        server.identityVerifiers,
        minted.runnerScopedToken,
        silentLogger,
      );
      expect(identity).toMatchObject({
        identityId: carolId,
        callerClass: "runner",
      });
    });

    it("a run that does not exist is NOT_FOUND with the copy a `get` would answer — never a hint about who may hold it", async () => {
      const platform = createClient(
        PlatformQueryController,
        transportFor(port, bruceToken),
      );
      const failure = await failureOf(
        platform.getRunnerScopedToken({
          scope: { case: "workflowExecutionId", value: "wex_nowhere" },
        }),
      );
      expect(failure.code).toBe(Code.NotFound);
      expect(failure.rawMessage).toBe(
        "WorkflowExecution not found: wex_nowhere",
      );
    });
  });
});

describe("trusted-local: no runner verifier is composed", () => {
  let dir: string;
  let server: ComposedServer;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "runner-subject-local-"));
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [],
      portOverride: 0,
      host: "127.0.0.1",
    });
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the chain carries no runner entry — nothing to delegate on a single-operator server", () => {
    expect(
      server.identityVerifiers.map((verifier) => verifier.name),
    ).not.toContain(RUNNER_VERIFIER_NAME);
  });

  it("the server's run credential is an UNCLAIMED bearer here — the exchange token stays the decrypt-lane discriminator it is today", async () => {
    const credential = server.runnerAuthService.mintRunCredential("wex_local");
    expect(
      await authenticateBearerToken(
        server.identityVerifiers,
        credential,
        silentLogger,
      ),
    ).toBeUndefined();
  });
});

describe("a unit's own Authorizer: no runner verifier is composed", () => {
  let dir: string;
  let server: ComposedServer;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "runner-subject-unit-"));
    const unit: ServerExtension = {
      name: "fake-unit-with-authorizer",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
      authorizer: { authorize: () => Promise.resolve({ kind: "allow" }) },
    };
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the chain is apikey, platform-client, then the unit's verifiers — the composition owns its credential story", () => {
    const names = server.identityVerifiers.map((verifier) => verifier.name);
    // The PlatformClient lane is core in every posture that verifies
    // callers; the runner-subject lane is the built-in Authorizer's alone.
    expect(names).toEqual(["apikey", "platform-client", fakeVerifier.name]);
    expect(names).not.toContain(RUNNER_VERIFIER_NAME);
  });
});
