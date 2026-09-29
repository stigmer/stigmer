/**
 * Pins the composed extension surface end to end (sub-project
 * 20260826.09/O1, DD-006 §2a): a fake extension unit registering a
 * cloud-family service the OSS server never serves
 * (BillingQueryController) is visible through BOTH routers — the bound
 * port and the in-process transport — with the full interceptor chain
 * running on each lane (the SP-B parity doctrine extended to extension
 * services), and the registry-declared edition answers on getServerInfo.
 * Later entries add their own composed arms below: caller guards
 * (20260902.02), the require-authentication posture (20260904.02), the
 * O5 drivers, the O4 slots and hooks, the C2 tuple lifecycle, and the
 * organization directory's external-id lookup: scoped to the identity
 * provider the request names, and answered only to a caller who may view
 * that provider, with one NotFound for every miss.
 *
 * The empty-set arm — no extensions composed, wire behavior byte-identical
 * to before the parameter existed — is pinned where it belongs: the
 * platform domain suite (edition oss) and the four conformance rosters.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { clone, create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import {
  ExecutionControlSignal,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { WorkflowInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/command_pb";
import { WorkflowInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/query_pb";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { BillingQueryController } from "@stigmer/protos/ai/stigmer/billing/v1/query_pb";
import { BillingAccountSchema } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import {
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import {
  Health,
  HealthCheckResponse_ServingStatus,
} from "@stigmer/protos/grpc/health/v1/health_pb";

import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { createLogger } from "../../boot/logger.js";
import { AUTHENTICATION_TOKEN_MISSING_MESSAGE } from "../../pipeline/interceptors/auth.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { newPermissiveSingleTeamAuthorizer } from "../../pipeline/steps/authorize.js";
import { platformTokenKeyRingFromPem } from "../../platformtoken/key-ring.js";
import type { AuthzCheck } from "../authorizer.js";
import type { GateSlotName } from "../gate-slots.js";
import type { OrganizationDirectory } from "../organization-directory.js";
import type {
  ExecutionVisibilityChangedEvent,
  ResourceAuthorizationLifecycle,
  ResourceCreatedEvent,
  ResourceDeletedEvent,
  VisibilityChangedEvent,
} from "../resource-authorization.js";
import type { AgentExecutionStatusTransition } from "../status-hooks.js";
import type { ServerExtension } from "../registry.js";
import type { IdentityVerifier } from "../identity.js";
import type { ResourceRowReader } from "../resource-row-reader.js";

/** The refusal a call answered; a call that succeeds fails the case. */
async function refusalOf(work: Promise<unknown>): Promise<ConnectError> {
  try {
    await work;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("the call was admitted");
}

const BILLING_PROCEDURE =
  "/ai.stigmer.billing.v1.BillingQueryController/getBillingAccount";

/**
 * What a composition serving an edition above open source must bring: its
 * callers sign in (compose.ts refuses such an edition trusted-local), and
 * it supplies its own platform-token key ring (platformtoken/key-ring.ts).
 * One verifier claims the fixture token; the ring is generated per run.
 */
const EDITION_CALLER_TOKEN = "edition-fixture-caller";
const editionVerifier: IdentityVerifier = {
  name: "edition-fixture-verifier",
  verify: (token) =>
    Promise.resolve(
      token === EDITION_CALLER_TOKEN
        ? {
            identityId: "ida_edition_fixture",
            callerClass: "user",
            issuer: "edition-fixture",
            rawToken: token,
          }
        : null,
    ),
};
const editionKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const EDITION_RING = platformTokenKeyRingFromPem({
  privateKeyPem: editionKeys.privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString(),
  publicKeyPems: [
    editionKeys.publicKey.export({ format: "pem", type: "spki" }).toString(),
  ],
});

/** A client transport on the bound port presenting the fixture token. */
function editionCallerTransport(port: number): Transport {
  return createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
    interceptors: [
      (next) => (request) => {
        request.header.set("authorization", `Bearer ${EDITION_CALLER_TOKEN}`);
        return next(request);
      },
    ],
  });
}

describe("extension composition (composed server)", () => {
  let server: ComposedServer;
  let dir: string;
  let portTransport: Transport;
  // Captured NDJSON log lines — the interceptor-chain proof reads them.
  const logLines: string[] = [];

  // A cloud-shaped unit: the cloud edition, its own sign-in, its own
  // Authorizer (a permissive one; this suite pins service visibility and
  // chain traversal, not authorization) and its own key ring.
  const fakeBillingExtension: ServerExtension = {
    name: "fake-billing",
    edition: ServerEdition.cloud,
    requireAuthentication: true,
    identityVerifiers: [editionVerifier],
    authorizer: newPermissiveSingleTeamAuthorizer(),
    drivers: { platformTokenKeys: EDITION_RING },
    services: [
      (router): void => {
        // Partial implementation is deliberate: the fake pins service
        // VISIBILITY and chain traversal, not the billing contract
        // (that is C5's job, years of entries away).
        router.service(BillingQueryController, {
          getBillingAccount: (input) =>
            create(BillingAccountSchema, { orgId: input.orgId }),
        });
      },
    ],
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "extension-composition-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: createLogger({
        level: "info",
        pretty: false,
        write: (line) => logLines.push(line),
      }),
      extensions: [fakeBillingExtension],
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    portTransport = editionCallerTransport(port);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves the extension service on the bound port, through the interceptor chain", async () => {
    const before = logLines.length;
    const client = createClient(BillingQueryController, portTransport);
    const account = await client.getBillingAccount({ orgId: "org-serving" });
    expect(account.orgId).toBe("org-serving");

    // The logging interceptor (chain position 2) records every completed
    // RPC — its line for the billing procedure proves the extension
    // service traversed the SAME chain OSS services do.
    const completed = logLines
      .slice(before)
      .filter(
        (line) =>
          line.includes("rpc completed") && line.includes(BILLING_PROCEDURE),
      );
    expect(completed.length).toBe(1);
  });

  it("serves the extension service on the in-process transport, through the same chain", async () => {
    const before = logLines.length;
    const client = createClient(
      BillingQueryController,
      server.inProcessTransport,
    );
    const account = await client.getBillingAccount({ orgId: "org-inprocess" });
    expect(account.orgId).toBe("org-inprocess");

    const completed = logLines
      .slice(before)
      .filter(
        (line) =>
          line.includes("rpc completed") && line.includes(BILLING_PROCEDURE),
      );
    expect(completed.length).toBe(1);
  });

  it("answers the registry-declared edition on getServerInfo", async () => {
    const client = createClient(PlatformQueryController, portTransport);
    const info = await client.getServerInfo({});
    expect(info.edition).toBe(ServerEdition.cloud);
  });

  it("logs the composed unit names at boot", () => {
    const bootLine = logLines.find((line) =>
      line.includes("extension units composed"),
    );
    expect(bootLine).toBeDefined();
    expect(bootLine).toContain("fake-billing");
  });
});

/**
 * The third edition on the wire, on open source's own authorizer: a unit
 * declaring ServerEdition.enterprise, signing its callers in and
 * registering a row reader for each kind the edition serves beyond open
 * source, boots with no Authorizer of its own and is answered verbatim by
 * getServerInfo. It pins the end-to-end path (declaration → resolved
 * registry → the built-in posture's row rule → platform controller →
 * wire) a self-hosted Enterprise composition takes.
 */
describe("extension composition (enterprise edition on the wire)", () => {
  let server: ComposedServer;
  let dir: string;
  let portTransport: Transport;

  const noRows: ResourceRowReader = {
    findById: () => Promise.resolve(undefined),
  };
  const enterpriseUnit: ServerExtension = {
    name: "fake-enterprise",
    edition: ServerEdition.enterprise,
    requireAuthentication: true,
    identityVerifiers: [editionVerifier],
    drivers: {
      platformTokenKeys: EDITION_RING,
      resourceRowReaders: new Map([
        [ApiResourceKind.identity_provider, noRows],
        [ApiResourceKind.invitation, noRows],
        [ApiResourceKind.team, noRows],
      ]),
    },
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "extension-composition-ee-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: createLogger({ level: "warn", pretty: false, write: () => {} }),
      extensions: [enterpriseUnit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    portTransport = editionCallerTransport(port);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers enterprise on getServerInfo", async () => {
    const client = createClient(PlatformQueryController, portTransport);
    const info = await client.getServerInfo({});
    expect(info.edition).toBe(ServerEdition.enterprise);
  });
});

/**
 * The caller-guard arm (entry 20260902.02 ruling Q1): a composed guard
 * is enforced on the SERVING chain and structurally absent from the
 * in-process chain. This is the wiring proof the unit arms cannot give —
 * it pins that compose.ts threads resolved guards into the serving
 * chassis AND that boot/inprocess.ts has no guard path at all (the TS
 * rendering of the Java InProcessCallContextHolder exemption, proven by
 * execution rather than by signature).
 */
describe("extension composition (caller guards)", () => {
  let server: ComposedServer;
  let dir: string;
  let portTransport: Transport;
  const guardedProcedures: string[] = [];

  const GUARD_REFUSAL_MESSAGE = "refused by the composed test guard";

  const guardExtension: ServerExtension = {
    name: "fake-guard",
    callerGuards: [
      {
        name: "refuse-all",
        guard: (_caller, method) => {
          guardedProcedures.push(`${method.parent.typeName}/${method.name}`);
          return Promise.reject(
            new ConnectError(GUARD_REFUSAL_MESSAGE, Code.PermissionDenied),
          );
        },
      },
    ],
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "caller-guard-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
      extensions: [guardExtension],
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    portTransport = createGrpcTransport({
      baseUrl: `http://127.0.0.1:${port}`,
    });
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("enforces the composed guard on the bound port with the guard's own wire mapping", async () => {
    const client = createClient(PlatformQueryController, portTransport);
    const failure = await client
      .getServerInfo({})
      .then(() => null)
      .catch((error: unknown) => ConnectError.from(error));
    expect(failure?.code).toBe(Code.PermissionDenied);
    expect(failure?.rawMessage).toBe(GUARD_REFUSAL_MESSAGE);
    expect(guardedProcedures).toContain(
      "ai.stigmer.platform.v1.PlatformQueryController/getServerInfo",
    );
  });

  it("never runs the guard on the in-process transport — the structural skip", async () => {
    const before = guardedProcedures.length;
    const client = createClient(
      PlatformQueryController,
      server.inProcessTransport,
    );
    // The SAME procedure the port lane just saw refused (a guard-only
    // unit declares no edition, so the answer is the OSS default).
    const info = await client.getServerInfo({});
    expect(info.edition).toBe(ServerEdition.oss);
    expect(guardedProcedures.length).toBe(before);
  });
});

/**
 * The require-authentication registry point (entry 20260904.02): a unit
 * whose own verifiers are the admission path declares the posture
 * WITHOUT an OSS OIDC issuer, and the serving chain refuses tokenless
 * non-exempt requests exactly as the issuer arm does — the Java copy,
 * is_public and the health service still reachable, a claimed credential
 * admitted. The in-process transport is untouched by construction (it
 * carries no require-auth arm).
 *
 * The API-key lane rides the POSTURE, not the issuer (stigmer#984): a
 * server that mints `stk_` keys under a declared posture must honor them,
 * so the OSS apikey verifier is composed FIRST whenever the posture is on
 * — a key minted over the unit's own credential authenticates as its
 * owner, and a garbage `stk_` bearer gets the lane's own refusal, never
 * the chassis's unclaimed-token copy. The zero-verifier invariant stays
 * the boot throw arm, scoped to the unit's OWN verifiers: the API-key
 * lane alone cannot admit the first caller (nobody could mint a key), so
 * a posture with nothing else is a composition fault, never a running
 * server that refuses everything.
 */
describe("extension composition (require-authentication posture)", () => {
  let server: ComposedServer;
  let dir: string;
  let port: number;
  const logLines: string[] = [];

  const CLAIMED_TOKEN = "unit-test-credential";
  const requiringExtension: ServerExtension = {
    name: "fake-identity",
    requireAuthentication: true,
    identityVerifiers: [
      {
        name: "fake-verifier",
        verify: (token) =>
          Promise.resolve(
            token === CLAIMED_TOKEN
              ? {
                  identityId: "ida_fake",
                  callerClass: "user",
                  issuer: "fake",
                  rawToken: token,
                }
              : null,
          ),
      },
    ],
  };

  function transportWith(token?: string): Transport {
    return createGrpcTransport({
      baseUrl: `http://127.0.0.1:${port}`,
      interceptors:
        token === undefined
          ? []
          : [
              (next) => (request) => {
                request.header.set("authorization", `Bearer ${token}`);
                return next(request);
              },
            ],
    });
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "require-auth-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: createLogger({
        level: "info",
        pretty: false,
        write: (line) => {
          logLines.push(line);
        },
      }),
      extensions: [requiringExtension],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a tokenless non-public RPC is UNAUTHENTICATED with the Java byte-pinned copy — no issuer configured", async () => {
    const client = createClient(OrganizationQueryController, transportWith());
    const failure = await client
      .findMyOrganizations({})
      .then(() => null)
      .catch((error: unknown) => ConnectError.from(error));
    expect(failure?.code).toBe(Code.Unauthenticated);
    expect(failure?.rawMessage).toBe(AUTHENTICATION_TOKEN_MISSING_MESSAGE);
  });

  it("is_public methods stay reachable tokenless (getServerInfo)", async () => {
    const client = createClient(PlatformQueryController, transportWith());
    const info = await client.getServerInfo({});
    expect(info.edition).toBe(ServerEdition.oss);
  });

  it("the gRPC health service stays reachable tokenless (the probe contract, stigmer#974)", async () => {
    const health = createClient(Health, transportWith());
    const response = await health.check({ service: "" });
    expect(response.status).toBe(HealthCheckResponse_ServingStatus.SERVING);
  });

  it("a credential the composed verifier claims is admitted", async () => {
    const client = createClient(
      OrganizationQueryController,
      transportWith(CLAIMED_TOKEN),
    );
    const orgs = await client.findMyOrganizations({});
    expect(orgs.entries).toEqual([]);
  });

  it("the in-process transport carries no require-auth arm — server-internal hops are unaffected", async () => {
    const client = createClient(
      OrganizationQueryController,
      server.inProcessTransport,
    );
    const orgs = await client.findMyOrganizations({});
    expect(orgs.entries).toEqual([]);
  });

  it("a credential nothing claims keeps the chassis's unclaimed-token refusal", async () => {
    const client = createClient(
      OrganizationQueryController,
      transportWith("not-a-credential"),
    );
    const failure = await client
      .findMyOrganizations({})
      .then(() => null)
      .catch((error: unknown) => ConnectError.from(error));
    expect(failure?.code).toBe(Code.Unauthenticated);
    expect(failure?.rawMessage).toBe(
      "the presented token was not accepted by any configured identity verifier",
    );
  });

  describe("the API-key lane rides the declared posture (stigmer#984)", () => {
    let apiKeyPlaintext: string;
    let apiKeyId: string;

    it("a key minted over the unit's credential is owned by that identity", async () => {
      const command = createClient(
        ApiKeyCommandController,
        transportWith(CLAIMED_TOKEN),
      );
      const created = await command.create({
        apiVersion: "iam.stigmer.ai/v1",
        kind: "ApiKey",
        metadata: { name: "posture key", org: "local" },
        spec: {},
      });
      apiKeyPlaintext = created.spec?.keyHash ?? "";
      apiKeyId = created.metadata?.id ?? "";
      expect(apiKeyPlaintext.startsWith("stk_")).toBe(true);
      expect(created.status?.audit?.specAudit?.createdBy?.id).toBe("ida_fake");
    });

    it("the minted key authenticates as its owning identity — no OIDC issuer anywhere", async () => {
      const query = createClient(
        ApiKeyQueryController,
        transportWith(apiKeyPlaintext),
      );
      const fetched = await query.get({ value: apiKeyId });
      expect(fetched.metadata?.id).toBe(apiKeyId);

      // A write over the key stamps the OWNER on the audit: the key is the
      // user, not a second principal (the OSS verifier's contract, kept).
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
      expect(second.status?.audit?.specAudit?.createdBy?.id).toBe("ida_fake");
    });

    it("a garbage stk_ bearer gets the lane's own refusal, not the chassis's unclaimed copy", async () => {
      const client = createClient(
        OrganizationQueryController,
        transportWith("stk_not-a-real-key"),
      );
      const failure = await client
        .findMyOrganizations({})
        .then(() => null)
        .catch((error: unknown) => ConnectError.from(error));
      expect(failure?.code).toBe(Code.Unauthenticated);
      expect(failure?.rawMessage).toBe("invalid token");
    });

    it("deleting the key revokes it on the very next request", async () => {
      const command = createClient(
        ApiKeyCommandController,
        transportWith(CLAIMED_TOKEN),
      );
      await command.delete({ value: apiKeyId });

      const query = createClient(
        ApiKeyQueryController,
        transportWith(apiKeyPlaintext),
      );
      const failure = await query
        .findAll({})
        .then(() => null)
        .catch((error: unknown) => ConnectError.from(error));
      expect(failure?.code).toBe(Code.Unauthenticated);
      expect(failure?.rawMessage).toBe("invalid token");
    });
  });

  it("boot logs the resolved posture, names the declaring unit, and lists the API-key lane first", () => {
    const line = logLines.find((entry) =>
      entry.includes("authentication posture resolved"),
    );
    expect(line).toBeDefined();
    const parsed = JSON.parse(line ?? "{}") as {
      posture?: string;
      source?: string;
      verifiers?: string;
    };
    expect(parsed.posture).toBe("required");
    expect(parsed.source).toBe("extension 'fake-identity'");
    // A unit that declares the posture and brings verifiers but NO
    // Authorizer is the BUILT-IN authorization posture: open source
    // composes its Authorizer, and with it the runner-subject verifier
    // between the API-key lane and the unit's own (runnerauth/
    // runner-subject-verifier.ts). A unit with its own Authorizer gets
    // neither (runner-subject-composed.test.ts pins that chain). The
    // PlatformClient lane rides the posture itself, ahead of both.
    expect(parsed.verifiers).toBe("apikey, platform-client, runner, fake-verifier");
  });

  it("a declared posture whose unit registers no verifier of its own is a boot throw naming the unit — the API-key lane alone cannot bootstrap", async () => {
    const orphanDir = mkdtempSync(path.join(tmpdir(), "require-auth-orphan-"));
    try {
      await expect(
        composeServer({
          config: loadConfig({
            STIGMER_MODEL_REGISTRY_REFRESH: "off",
            DB_PATH: path.join(orphanDir, "stigmer.db"),
            ARTIFACT_LOCAL_BASE_PATH: path.join(orphanDir, "artifacts"),
          }),
          logger: createLogger({
            level: "error",
            pretty: false,
            write: () => {},
          }),
          extensions: [{ name: "verifierless", requireAuthentication: true }],
          portOverride: 0,
          host: "127.0.0.1",
        }),
      ).rejects.toThrowError(
        /extension 'verifierless' declares the require-authentication posture, but registers no identity verifier of its own/,
      );
    } finally {
      rmSync(orphanDir, { recursive: true, force: true });
    }
  });

  it("a wider edition on the built-in authorizer with no row readers is a boot throw naming every kind it cannot read", async () => {
    const enterpriseDir = mkdtempSync(
      path.join(tmpdir(), "require-auth-edition-"),
    );
    try {
      await expect(
        composeServer({
          config: loadConfig({
            STIGMER_MODEL_REGISTRY_REFRESH: "off",
            DB_PATH: path.join(enterpriseDir, "stigmer.db"),
            ARTIFACT_LOCAL_BASE_PATH: path.join(enterpriseDir, "artifacts"),
          }),
          logger: createLogger({
            level: "error",
            pretty: false,
            write: () => {},
          }),
          extensions: [
            {
              ...requiringExtension,
              name: "enterprise-without-readers",
              edition: ServerEdition.enterprise,
              drivers: { platformTokenKeys: EDITION_RING },
            },
          ],
          portOverride: 0,
          host: "127.0.0.1",
        }),
      ).rejects.toThrowError(
        /serves edition 'enterprise' under the built-in authorizer but registers no row reader for 'identity_provider', 'invitation', 'team'/,
      );
    } finally {
      rmSync(enterpriseDir, { recursive: true, force: true });
    }
  });
});

/**
 * The O5 driver-substitution arm: every consumption site routes through
 * the composed drivers — the registry lane serves the substituted
 * catalog's document, the platform exchange mints through the substituted
 * credential provider, and the artifact factory selects the registered
 * blob driver by its configured name.
 */
describe("extension composition (O5 driver substitution)", () => {
  const FAKE_DOCUMENT = `{"models":[{"id":"fake/model","harness":"native"}]}`;
  let server: ComposedServer;
  let dir: string;
  let port: number;
  let blobDriverConstructed = 0;

  const driverExtension: ServerExtension = {
    name: "fake-drivers",
    drivers: {
      modelCatalogProvider: {
        document: () => FAKE_DOCUMENT,
        isValidModel: () => true,
        hasHarness: () => true,
        hasAnyModels: () => true,
        isValidModelOnAnyHarness: () => true,
        canonicalModelsAcrossHarnesses: () => ["fake/model"],
        canonicalModels: () => ["fake/model"],
        hasPricingVariant: () => true,
        hasPricingVariantForHarness: () => true,
        canonicalModelsWithVariant: () => ["fake/model"],
        canonicalModelsWithVariantForHarness: () => ["fake/model"],
        hasCapabilityForHarness: () => true,
        canonicalModelsWithCapabilityForHarness: () => ["fake/model"],
      },
      runnerCredentialProvider: {
        isEnabled: () => true,
        mint: (lane, binding) => ({
          token: `fake-${lane}-${binding}`,
          ttlSeconds: 42,
        }),
        verify: (lane, token) => `${lane}:${token}`,
      },
      artifactStorageDrivers: new Map([
        [
          "fake-blob",
          (): ArtifactStorage => {
            blobDriverConstructed += 1;
            const blobs = new Map<string, Uint8Array>();
            return {
              upload: (key, data) => {
                blobs.set(key, data);
                return Promise.resolve();
              },
              download: (key) =>
                Promise.resolve(blobs.get(key) ?? new Uint8Array()),
              size: (key) => Promise.resolve(blobs.get(key)?.length ?? 0),
              presignPut: () => Promise.reject(new Error("not exercised here")),
              getSignedUrl: () => Promise.resolve("https://blob.invalid"),
              delete: () => Promise.resolve(),
              exists: (key) => Promise.resolve(blobs.has(key)),
              health: () => Promise.resolve(),
            };
          },
        ],
      ]),
    },
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "driver-substitution-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        // The registered driver serves the GENERIC artifact store; the
        // skill store stays on its default local arm (Q2b: per-domain).
        ARTIFACT_STORAGE_TYPE: "fake-blob",
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
      extensions: [driverExtension],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the registry lane serves the substituted catalog's document verbatim", async () => {
    const response = await fetch(
      `http://127.0.0.1:${port}/v1/proxy/model-registry`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(FAKE_DOCUMENT);
  });

  it("the platform exchange mints through the substituted credential provider", async () => {
    const client = createClient(
      PlatformQueryController,
      server.inProcessTransport,
    );
    const out = await client.getRunnerScopedToken({
      scope: { case: "agentExecutionId", value: "aex_substituted" },
    });
    expect(out.runnerScopedToken).toBe("fake-execution_scoped-aex_substituted");
    expect(out.expiresInSeconds).toBe(42);
  });

  it("the artifact factory constructed the registered blob driver exactly once", () => {
    expect(blobDriverConstructed).toBe(1);
  });
});

/**
 * The O4 gate-slot + status-hook arms: an extension gate spliced into a
 * declared slot refuses with its own ConnectError code and copy — before
 * the side effect on a pre-side-effect slot (nothing persisted: the
 * session and organization chains), after it on the post-persist slot
 * (the row survives the failed request, the inherited Java semantics — O4
 * verification V1); the status observers
 * see the terminal updateStatus transition exactly once (the Q4
 * phase-change rule) and the response decorator contributes the control
 * signal on the shared reply schema.
 */
describe("extension composition (O4 gate slots + status hooks)", () => {
  const REFUSED_SESSION = "o4-refused-session";
  const REFUSED_ORG_SLUG = "o4refusedorg";
  const PRE_REFUSED_ORG_SLUG = "prerefusedorg";
  let server: ComposedServer;
  let dir: string;
  let portTransport: Transport;
  const observed: AgentExecutionStatusTransition[] = [];

  const sessionGate: PipelineStep<DescMessage> = {
    name: "FakeSessionGate",
    execute: (ctx) => {
      const session = ctx.newState as { metadata?: { name?: string } };
      if (session.metadata?.name === REFUSED_SESSION) {
        throw new ConnectError(
          "fake session gate refuses this session",
          Code.PermissionDenied,
        );
      }
    },
  };

  const orgPostPersistGate: PipelineStep<DescMessage> = {
    name: "FakeOrgPostPersistGate",
    execute: (ctx) => {
      const org = ctx.newState as { metadata?: { slug?: string } };
      if (org.metadata?.slug === REFUSED_ORG_SLUG) {
        throw new ConnectError(
          "fake tuple seeding failed",
          Code.FailedPrecondition,
        );
      }
    },
  };

  const orgPreSideEffectGate: PipelineStep<DescMessage> = {
    name: "FakeOrgPreSideEffectGate",
    execute: (ctx) => {
      const org = ctx.newState as { metadata?: { slug?: string } };
      if (org.metadata?.slug === PRE_REFUSED_ORG_SLUG) {
        throw new ConnectError(
          "fake organization limit reached",
          Code.FailedPrecondition,
        );
      }
    },
  };

  const gateExtension: ServerExtension = {
    name: "fake-gates-and-hooks",
    gateSteps: new Map<GateSlotName, ReadonlyArray<PipelineStep<DescMessage>>>([
      ["session-create:pre-side-effect-gate", [sessionGate]],
      ["org-create:post-persist", [orgPostPersistGate]],
      ["org-create:pre-side-effect-gate", [orgPreSideEffectGate]],
    ]),
    statusTransitionHooks: {
      observers: [
        (transition): void => {
          observed.push(transition);
        },
      ],
      responseDecorators: [
        (_execution, response): void => {
          response.signal = ExecutionControlSignal.STOP;
        },
      ],
    },
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "gate-slot-hook-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
      extensions: [gateExtension],
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    portTransport = createGrpcTransport({
      baseUrl: `http://127.0.0.1:${port}`,
    });
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a pre-side-effect gate refusal aborts session create with nothing persisted", async () => {
    const command = createClient(SessionCommandController, portTransport);
    const query = createClient(SessionQueryController, portTransport);

    let refused: ConnectError | undefined;
    try {
      await command.create(
        create(SessionSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Session",
          metadata: { name: REFUSED_SESSION, org: "acme" },
          spec: { agentInstanceId: "agi_gate_test" },
        }),
      );
    } catch (error) {
      refused = ConnectError.from(error);
    }
    // The gate's own code and copy reach the wire (the §3b refusal
    // contract: a gate refuses exactly as OSS steps do).
    expect(refused?.code).toBe(Code.PermissionDenied);
    expect(refused?.rawMessage).toBe("fake session gate refuses this session");

    // Pre-side-effect means pre-persist: no session row exists.
    let getError: ConnectError | undefined;
    try {
      await query.get({ value: `ses_${REFUSED_SESSION}` });
    } catch (error) {
      getError = ConnectError.from(error);
    }
    expect(getError?.code).toBe(Code.NotFound);
  });

  it("a passing gate is invisible: session create succeeds through the slot", async () => {
    const command = createClient(SessionCommandController, portTransport);
    const session = await command.create(
      create(SessionSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Session",
        metadata: { name: "o4-allowed-session", org: "acme" },
        spec: { agentInstanceId: "agi_gate_test" },
      }),
    );
    expect(session.metadata?.id).not.toBe("");
  });

  it("a post-persist gate failure fails the request but the org row survives (inherited Java semantics)", async () => {
    const command = createClient(OrganizationCommandController, portTransport);
    const query = createClient(OrganizationQueryController, portTransport);

    let refused: ConnectError | undefined;
    try {
      await command.create(
        create(OrganizationSchema, {
          apiVersion: "tenancy.stigmer.ai/v1",
          kind: "Organization",
          metadata: { name: "O4 Refused Org", slug: REFUSED_ORG_SLUG },
        }),
      );
    } catch (error) {
      refused = ConnectError.from(error);
    }
    expect(refused?.code).toBe(Code.FailedPrecondition);
    expect(refused?.rawMessage).toBe("fake tuple seeding failed");

    // The slot sits AFTER Persist: the row was committed before the gate
    // refused — healed by idempotent retry, never rolled back (V1).
    const org = await query.get({ value: REFUSED_ORG_SLUG });
    expect(org.metadata?.slug).toBe(REFUSED_ORG_SLUG);
  });

  it("a pre-side-effect gate refusal aborts organization create with no row written", async () => {
    const command = createClient(OrganizationCommandController, portTransport);
    const query = createClient(OrganizationQueryController, portTransport);

    let refused: ConnectError | undefined;
    try {
      await command.create(
        create(OrganizationSchema, {
          apiVersion: "tenancy.stigmer.ai/v1",
          kind: "Organization",
          metadata: { name: "Pre Refused Org", slug: PRE_REFUSED_ORG_SLUG },
        }),
      );
    } catch (error) {
      refused = ConnectError.from(error);
    }
    expect(refused?.code).toBe(Code.FailedPrecondition);
    expect(refused?.rawMessage).toBe("fake organization limit reached");

    // The slot sits BEFORE Persist: the refused organization was never
    // written, which is the whole reason the slot exists.
    let getError: ConnectError | undefined;
    try {
      await query.get({ value: PRE_REFUSED_ORG_SLUG });
    } catch (error) {
      getError = ConnectError.from(error);
    }
    expect(getError?.code).toBe(Code.NotFound);
  });

  it("observers see the terminal updateStatus transition once and the decorator contributes the signal", async () => {
    const executionId = "aexec_o4_hooks";
    await server.store.saveResource(
      ApiResourceKind.agent_execution,
      executionId,
      AgentExecutionSchema,
      create(AgentExecutionSchema, {
        metadata: { id: executionId, name: executionId, org: "acme" },
        spec: { message: "hook test" },
        status: { phase: ExecutionPhase.EXECUTION_IN_PROGRESS },
      }),
    );
    const command = createClient(
      AgentExecutionCommandController,
      portTransport,
    );

    observed.length = 0;
    const reply = await command.updateStatus({
      executionId,
      status: {
        phase: ExecutionPhase.EXECUTION_COMPLETED,
        completedAt: "2026-08-27T10:00:00Z",
        messages: [{ content: "done" }],
      },
    });
    // The decorator's contribution rides the field the shared reply
    // schema already carries (§7 — the cloud's control-signal seam).
    expect(reply.signal).toBe(ExecutionControlSignal.STOP);
    expect(observed).toHaveLength(1);
    expect(observed[0]?.oldPhase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(observed[0]?.newPhase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(observed[0]?.execution.metadata?.id).toBe(executionId);

    // A repeat report with the phase unchanged decorates the reply but
    // does NOT re-notify (the Q4 phase-change rule).
    const repeat = await command.updateStatus({
      executionId,
      status: {
        phase: ExecutionPhase.EXECUTION_COMPLETED,
        completedAt: "2026-08-27T10:00:00Z",
        messages: [{ content: "done" }],
      },
    });
    expect(repeat.signal).toBe(ExecutionControlSignal.STOP);
    expect(observed).toHaveLength(1);
  });
});

describe("extension composition (C2 tuple lifecycle + organization directory)", () => {
  let server: ComposedServer;
  let dir: string;
  let portTransport: Transport;

  const createdEvents: ResourceCreatedEvent[] = [];
  const deletedEvents: ResourceDeletedEvent[] = [];
  const visibilityEvents: VisibilityChangedEvent[] = [];
  const executionVisibilityEvents: ExecutionVisibilityChangedEvent[] = [];
  let failCreates = false;
  let failDeletes = false;
  let failExecutionVisibility = false;

  const fakeLifecycle: ResourceAuthorizationLifecycle = {
    async onResourceCreated(event): Promise<void> {
      if (failCreates) {
        throw new Error("fga is down");
      }
      createdEvents.push(event);
    },
    async onResourceDeleted(event): Promise<void> {
      if (failDeletes) {
        throw new Error("fga is down");
      }
      deletedEvents.push(event);
    },
    async onVisibilityChanged(event): Promise<void> {
      visibilityEvents.push(event);
    },
    async onExecutionVisibilityChanged(event): Promise<void> {
      if (failExecutionVisibility) {
        throw new Error("fga is down");
      }
      executionVisibilityEvents.push(event);
    },
  };

  // The directory answers are test-mutable so each case can stage its
  // own world without a second composed server.
  const myOrgIds: string[] = [];
  // Providers by `org/slug` → id, and mappings by `providerId:externalId`:
  // the directory scopes every lookup to the provider the request names.
  const providers = new Map<string, string>([
    ["c2seededorg/test-idp", "idp_viewable"],
    ["c2seededorg/other-idp", "idp_other"],
    ["c2seededorg/hidden-idp", "idp_hidden"],
  ]);
  const externalOrgMap = new Map<string, string>();
  const fakeDirectory: OrganizationDirectory = {
    refusesEnumeration: true,
    listMyOrganizationIds: async () => [...myOrgIds],
    lookupExternalOrganization: async (ref, externalOrgId) => {
      const providerId = providers.get(`${ref.org}/${ref.slug}`);
      return providerId === undefined
        ? { kind: "no-identity-provider" }
        : {
            kind: "resolved",
            identityProviderId: providerId,
            organizationId: externalOrgMap.get(`${providerId}:${externalOrgId}`),
          };
    },
  };
  // Every check is allowed except viewing the providers named here, so the
  // lookup's own authorization is the one refusal the suite can see.
  const deniedProviders = new Set<string>(["idp_hidden"]);
  const lookupChecks: AuthzCheck[] = [];

  const iamExtension: ServerExtension = {
    name: "fake-iam",
    authorizer: {
      authorize: (_caller, check) => {
        if (check.resourceKind === ApiResourceKind.identity_provider) {
          lookupChecks.push(check);
          if (deniedProviders.has(check.resourceId)) {
            return Promise.resolve({ kind: "deny", reason: "" });
          }
        }
        return Promise.resolve({ kind: "allow" });
      },
    },
    drivers: {
      resourceAuthorizationLifecycle: fakeLifecycle,
      organizationDirectory: fakeDirectory,
    },
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "tuple-lifecycle-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
      extensions: [iamExtension],
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    portTransport = createGrpcTransport({
      baseUrl: `http://127.0.0.1:${port}`,
    });
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("org create fires the creation event: OWNER_ONLY — direct owner, no scope link", async () => {
    const command = createClient(OrganizationCommandController, portTransport);
    createdEvents.length = 0;
    const org = await command.create(
      create(OrganizationSchema, {
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { name: "C2 Seeded Org", slug: "c2seededorg" },
      }),
    );
    expect(createdEvents).toHaveLength(1);
    const event = createdEvents[0]!;
    expect(event.kind).toBe(ApiResourceKind.organization);
    expect(event.resourceId).toBe(org.metadata?.id);
    expect(event.parentLinks).toEqual([]);
    expect(event.caller.identityId).not.toBe("");
    myOrgIds.push(org.metadata?.id ?? "");
    externalOrgMap.set("idp_viewable:ext-org-42", org.metadata?.id ?? "");
    externalOrgMap.set("idp_hidden:ext-org-42", org.metadata?.id ?? "");
  });

  it("agent create fires creation events for the agent AND its in-process default instance", async () => {
    const command = createClient(AgentCommandController, portTransport);
    createdEvents.length = 0;
    const agent = await command.create(
      create(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: {
          name: "c2-seeded-agent",
          org: "c2seededorg",
          visibility: ApiResourceVisibility.visibility_org,
        },
        spec: { instructions: "a conformant instruction body" },
      }),
    );
    // TWO events: the agent, and the default AgentInstance the create
    // chain applies through the in-process client — the seam runs
    // wherever its chain runs, including in-process invocations (the
    // same inherited fact the gate slots record).
    expect(createdEvents).toHaveLength(2);
    const agentEvent = createdEvents.find(
      (event) => event.kind === ApiResourceKind.agent,
    );
    expect(agentEvent?.parentLinks).toEqual([
      {
        relation: "organization",
        parentKind: ApiResourceKind.organization,
        parentId: "c2seededorg",
      },
    ]);
    expect(agentEvent?.visibilityShapes).toEqual(["org-viewer"]);
    const instanceEvent = createdEvents.find(
      (event) => event.kind === ApiResourceKind.agent_instance,
    );
    expect(instanceEvent?.parentLinks).toContainEqual({
      relation: "agent",
      parentKind: ApiResourceKind.agent,
      parentId: agent.metadata?.id,
    });
  });

  it("updateVisibility fires the set-diff transition (org→private deletes the org shape)", async () => {
    const command = createClient(AgentCommandController, portTransport);
    const agent = await command.create(
      create(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: {
          name: "c2-visibility-agent",
          org: "c2seededorg",
          visibility: ApiResourceVisibility.visibility_org,
        },
        spec: { instructions: "a conformant instruction body" },
      }),
    );
    visibilityEvents.length = 0;
    await command.updateVisibility({
      resourceId: agent.metadata?.id ?? "",
      visibility: ApiResourceVisibility.visibility_private,
    });
    expect(visibilityEvents).toHaveLength(1);
    const event = visibilityEvents[0]!;
    expect(event.shapesToCreate).toEqual([]);
    expect(event.shapesToDelete).toEqual(["org-viewer"]);
  });

  it("delete fires the cleanup event; a cleanup failure never fails the delete", async () => {
    const command = createClient(AgentCommandController, portTransport);
    const query = createClient(AgentQueryController, portTransport);

    const first = await command.create(
      create(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: { name: "c2-deleted-agent", org: "c2seededorg" },
        spec: { instructions: "a conformant instruction body" },
      }),
    );
    deletedEvents.length = 0;
    await command.delete({ value: first.metadata?.id ?? "" });
    expect(deletedEvents).toHaveLength(1);
    expect(deletedEvents[0]!.resourceId).toBe(first.metadata?.id);

    const second = await command.create(
      create(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: { name: "c2-orphaned-agent", org: "c2seededorg" },
        spec: { instructions: "a conformant instruction body" },
      }),
    );
    deletedEvents.length = 0;
    failDeletes = true;
    try {
      // Best-effort contract: the delete succeeds although the driver threw.
      await command.delete({ value: second.metadata?.id ?? "" });
    } finally {
      failDeletes = false;
    }
    expect(deletedEvents).toHaveLength(0);
    let getError: ConnectError | undefined;
    try {
      await query.get({ value: second.metadata?.id ?? "" });
    } catch (error) {
      getError = ConnectError.from(error);
    }
    expect(getError?.code).toBe(Code.NotFound);
  });

  it("a driver failure on create fails the request but the row survives (inherited semantics)", async () => {
    const command = createClient(AgentCommandController, portTransport);
    const query = createClient(AgentQueryController, portTransport);
    failCreates = true;
    let refused: ConnectError | undefined;
    try {
      await command.create(
        create(AgentSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Agent",
          metadata: { name: "c2-halfcreated-agent", org: "c2seededorg" },
          spec: { instructions: "a conformant instruction body" },
        }),
      );
    } catch (error) {
      refused = ConnectError.from(error);
    } finally {
      failCreates = false;
    }
    expect(refused?.code).toBe(Code.Internal);
    expect(refused?.rawMessage).toBe("failed to create authorization tuples");
    // The step runs post-persist: the row survived the failed request
    // (ids are generated, so the surviving row is found by reference).
    const half = await query.getByReference({
      org: "c2seededorg",
      slug: "c2-halfcreated-agent",
    });
    expect(half.metadata?.name).toBe("c2-halfcreated-agent");
  });

  it("the directory's enumeration refusal answers UNIMPLEMENTED on a valid find", async () => {
    const query = createClient(OrganizationQueryController, portTransport);
    let refused: ConnectError | undefined;
    try {
      await query.find({ org: "c2seededorg", pageSize: 10, pageNumber: 1 });
    } catch (error) {
      refused = ConnectError.from(error);
    }
    expect(refused?.code).toBe(Code.Unimplemented);
  });

  it("findMyOrganizations answers exactly the directory's authorized set", async () => {
    const query = createClient(OrganizationQueryController, portTransport);
    const mine = await query.findMyOrganizations({});
    expect(mine.entries.map((org) => org.metadata?.id)).toEqual(myOrgIds);
  });

  it("getByExternalOrgId resolves a mapping under the named provider for a caller who may view it", async () => {
    const query = createClient(OrganizationQueryController, portTransport);
    lookupChecks.length = 0;
    const org = await query.getByExternalOrgId({
      identityProviderRef: { org: "c2seededorg", slug: "test-idp" },
      externalOrgId: "ext-org-42",
    });
    expect(org.metadata?.id).toBe(myOrgIds[0]);
    expect(lookupChecks).toEqual([
      {
        permission: IamPermission.can_view,
        resourceKind: ApiResourceKind.identity_provider,
        resourceId: "idp_viewable",
      },
    ]);
  });

  it("getByExternalOrgId refuses a caller who may not view the named provider, before saying whether a mapping exists", async () => {
    const query = createClient(OrganizationQueryController, portTransport);
    for (const externalOrgId of ["ext-org-42", "ext-org-unknown"]) {
      const refused = await refusalOf(
        query.getByExternalOrgId({
          identityProviderRef: { org: "c2seededorg", slug: "hidden-idp" },
          externalOrgId,
        }),
      );
      expect(refused.code).toBe(Code.PermissionDenied);
      expect(refused.rawMessage).toBe("unauthorized to view identity provider");
    }
  });

  it("getByExternalOrgId answers one NotFound for an unknown provider, an unmapped id, and another provider's mapping", async () => {
    const query = createClient(OrganizationQueryController, portTransport);
    for (const [slug, externalOrgId] of [
      ["no-such-idp", "ext-org-42"],
      ["test-idp", "ext-org-unknown"],
      ["other-idp", "ext-org-42"],
    ] as const) {
      const missing = await refusalOf(
        query.getByExternalOrgId({
          identityProviderRef: { org: "c2seededorg", slug },
          externalOrgId,
        }),
      );
      expect(missing.code).toBe(Code.NotFound);
      expect(missing.rawMessage).toBe(`Organization not found: ${externalOrgId}`);
    }
  });

  // The run audience of a workflow instance (`spec.execution_visibility`):
  // open source derives `execution_viewer` from the row when a check asks;
  // an edition that stores tuples hears it here (stigmer-cloud#720). The
  // event carries the audience the level now names — the whole target
  // state, so a retry or a repeat converges — and fires from the two doors
  // that may set the level: create, and the dedicated RPC. Update and Apply
  // ignore a request-carried level (the oss#573 rule for
  // metadata.visibility), so neither can silently narrow run access.
  describe("the run audience of a workflow instance", () => {
    const workflows = () => createClient(WorkflowCommandController, portTransport);
    const instances = () => createClient(WorkflowInstanceCommandController, portTransport);
    const instanceQuery = () => createClient(WorkflowInstanceQueryController, portTransport);
    let workflowId = "";

    beforeAll(async () => {
      const workflow = await workflows().create(
        create(WorkflowSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Workflow",
          metadata: { name: "c2-run-audience-workflow", org: "c2seededorg" },
          spec: {
            document: { dsl: "1.0.0", namespace: "tests", name: "c2-run-audience", version: "0.1.0" },
            tasks: [{ name: "seed", kind: 1, taskConfig: { variables: { greeting: "hello" } } }],
          },
        }),
      );
      workflowId = workflow.metadata?.id ?? "";
    });

    function instanceInput(name: string, level: WorkflowExecutionVisibility) {
      return create(WorkflowInstanceSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "WorkflowInstance",
        metadata: { name, org: "c2seededorg" },
        spec: { workflowId, executionVisibility: level },
      });
    }

    it("create at ORGANIZATION fires the audience once; the workflow's default instance and a private create fire nothing", async () => {
      // The workflow's in-process default instance was created in beforeAll
      // at the unset level, which names no audience.
      expect(executionVisibilityEvents).toEqual([]);
      const shared = await instances().create(
        instanceInput("c2-shared-runs", WorkflowExecutionVisibility.organization),
      );
      await instances().create(instanceInput("c2-private-runs", WorkflowExecutionVisibility.private));
      expect(executionVisibilityEvents).toEqual([
        {
          instanceKind: ApiResourceKind.workflow_instance,
          instanceId: shared.metadata?.id,
          orgId: "c2seededorg",
          shapes: ["org-viewer"],
        },
      ]);
    });

    it("updateExecutionVisibility fires the level's audience every time, the empty one included", async () => {
      const instance = await instances().create(
        instanceInput("c2-toggled-runs", WorkflowExecutionVisibility.private),
      );
      const id = instance.metadata?.id ?? "";
      executionVisibilityEvents.length = 0;
      await instances().updateExecutionVisibility({
        resourceId: id,
        executionVisibility: WorkflowExecutionVisibility.organization,
      });
      await instances().updateExecutionVisibility({
        resourceId: id,
        executionVisibility: WorkflowExecutionVisibility.private,
      });
      expect(executionVisibilityEvents.map((event) => [event.instanceId, event.shapes])).toEqual([
        [id, ["org-viewer"]],
        [id, []],
      ]);
    });

    it("update and apply keep the stored level whatever the request carries, and fire nothing", async () => {
      const instance = await instances().create(
        instanceInput("c2-kept-runs", WorkflowExecutionVisibility.organization),
      );
      const id = instance.metadata?.id ?? "";
      executionVisibilityEvents.length = 0;
      const lowered = clone(WorkflowInstanceSchema, instance);
      lowered.spec!.executionVisibility = WorkflowExecutionVisibility.private;
      lowered.spec!.description = "edited";
      const updated = await instances().update(lowered);
      expect(updated.spec?.description, "the update itself landed").toBe("edited");
      expect(updated.spec?.executionVisibility).toBe(WorkflowExecutionVisibility.organization);
      const reapplied = clone(WorkflowInstanceSchema, lowered);
      reapplied.spec!.executionVisibility = WorkflowExecutionVisibility.unspecified;
      const applied = await instances().apply(reapplied);
      expect(applied.spec?.executionVisibility).toBe(WorkflowExecutionVisibility.organization);
      const stored = await instanceQuery().get({ value: id });
      expect(stored.spec?.executionVisibility).toBe(WorkflowExecutionVisibility.organization);
      expect(executionVisibilityEvents).toEqual([]);
    });

    it("a driver failure fails the RPC with the level already persisted; the retry converges", async () => {
      const instance = await instances().create(
        instanceInput("c2-retried-runs", WorkflowExecutionVisibility.private),
      );
      const id = instance.metadata?.id ?? "";
      failExecutionVisibility = true;
      let refused: ConnectError | undefined;
      try {
        await instances().updateExecutionVisibility({
          resourceId: id,
          executionVisibility: WorkflowExecutionVisibility.organization,
        });
      } catch (error) {
        refused = ConnectError.from(error);
      } finally {
        failExecutionVisibility = false;
      }
      expect(refused?.code).toBe(Code.Internal);
      expect(refused?.rawMessage).toBe("failed to update execution visibility tuples");
      const stored = await instanceQuery().get({ value: id });
      expect(stored.spec?.executionVisibility, "post-persist: the level landed").toBe(
        WorkflowExecutionVisibility.organization,
      );
      executionVisibilityEvents.length = 0;
      await instances().updateExecutionVisibility({
        resourceId: id,
        executionVisibility: WorkflowExecutionVisibility.organization,
      });
      expect(executionVisibilityEvents.map((event) => event.shapes)).toEqual([["org-viewer"]]);
    });
  });
});
