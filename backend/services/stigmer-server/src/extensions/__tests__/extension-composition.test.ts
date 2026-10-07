/**
 * Pins the composed extension surface end to end: a fake extension unit
 * registering a cloud-family service the OSS server never serves
 * (BillingQueryController) is visible through BOTH routers — the bound
 * port and the in-process transport — with the full interceptor chain
 * running on each lane (extension services held to the same parity as the
 * server's own), and the registry-declared edition answers on
 * getServerInfo. Later arms below compose the rest of the extension
 * surface: caller guards, the require-authentication posture, the driver
 * substitutions, the gate slots and status hooks, the authorization-tuple
 * lifecycle (a parent's cascade included: every child it deletes is
 * cleaned as its own delete would clean it, before the parent,
 * stigmer#1603; the server's own delete of a run's execution context
 * included: it rides the context's delete chain, stigmer#1647), and the
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

import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import {
  RunControlSignal,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ExecutionContextCommandController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/command_pb";
import { ExecutionContextQueryController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/query_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { BillingQueryController } from "@stigmer/protos/ai/stigmer/billing/v1/query_pb";
import { BillingAccountSchema } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { OwnerAttributionType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
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
import { createInProcessClients } from "../../boot/inprocess.js";
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
  ChildOrganizationLinkedEvent,
  ResourceAuthorizationLifecycle,
  ResourceCreatedEvent,
  ResourceDeletedEvent,
  VisibilityChangedEvent,
} from "../resource-authorization.js";
import type { RunStatusTransition } from "../status-hooks.js";
import type { ServerExtension } from "../registry.js";
import type { IdentityVerifier } from "../identity.js";
import type { ResourceRowReader } from "../resource-row-reader.js";
import { accountIdFor } from "../../domain/identityaccount/constants.js";
import { newResourceIdentityAccountStore } from "../../domain/identityaccount/resource-store.js";
import { seedOrganizations } from "../../domain/organization/__tests__/support.js";
import { deleteExecutionContextForExecution } from "../../domain/executioncontext/internal-delete.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import { apiResourceKindName } from "../../store/proto-fields.js";
import { widerEditionPurge } from "./composed-support.js";

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
    orgPurge: widerEditionPurge,
    requireAuthentication: true,
    identityVerifiers: [editionVerifier],
    authorizer: newPermissiveSingleTeamAuthorizer(),
    drivers: {
      platformTokenKeys: EDITION_RING,
      // The cloud edition serves the three Enterprise kinds; this unit
      // keeps none of their rows, and says so to the credential binding.
      resourceRowReaders: new Map(
        [
          ApiResourceKind.identity_provider,
          ApiResourceKind.invitation,
          ApiResourceKind.team,
        ].map((kind) => [kind, { findById: () => Promise.resolve(undefined) }]),
      ),
    },
    services: [
      (router): void => {
        // Partial implementation is deliberate: the fake pins service
        // VISIBILITY and chain traversal, not the billing contract
        // (the billing extension's own suites own that).
        router.service(BillingQueryController, {
          getBillingAccount: (input) =>
            create(BillingAccountSchema, { org: input.org }),
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
    const account = await client.getBillingAccount({ org: "org-serving" });
    expect(account.org).toBe("org-serving");

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
    const account = await client.getBillingAccount({ org: "org-inprocess" });
    expect(account.org).toBe("org-inprocess");

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
    orgPurge: widerEditionPurge,
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
 * The caller-guard arm: a composed guard
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
 * The require-authentication registry point: a unit
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
  // The unit's caller is an account the store holds, as every composition's
  // is: the API-key lane refuses a key whose owner account is gone
  // (stigmer/stigmer#1765), so a key minted over the unit's credential
  // authenticates only while that account exists.
  const UNIT_SUBJECT = "fake|unit-caller";
  const UNIT_ACCOUNT_ID = accountIdFor(UNIT_SUBJECT);
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
                  identityId: UNIT_ACCOUNT_ID,
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
    await newResourceIdentityAccountStore(server.store).save(
      create(IdentityAccountSchema, {
        apiVersion: "iam.stigmer.ai/v1",
        kind: "IdentityAccount",
        metadata: { id: UNIT_ACCOUNT_ID, name: "unit@example.com" },
        spec: {
          idpId: UNIT_SUBJECT,
          email: "unit@example.com",
          provisioningMode: IdentityAccountProvisioningMode.direct,
        },
      }),
    );
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
      expect(created.status?.audit?.specAudit?.createdBy?.id).toBe(
        UNIT_ACCOUNT_ID,
      );
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
      expect(second.status?.audit?.specAudit?.createdBy?.id).toBe(
        UNIT_ACCOUNT_ID,
      );
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

  it("a wider edition with its own Authorizer and no row readers is a boot throw too: the credential binding reads every served kind's rows", async () => {
    const enterpriseDir = mkdtempSync(
      path.join(tmpdir(), "require-auth-edition-unit-authorizer-"),
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
              name: "enterprise-own-authorizer-without-readers",
              edition: ServerEdition.enterprise,
              authorizer: {
                authorize: () => Promise.resolve({ kind: "allow" }),
              },
              drivers: { platformTokenKeys: EDITION_RING },
            },
          ],
          portOverride: 0,
          host: "127.0.0.1",
        }),
      ).rejects.toThrowError(
        /serves edition 'enterprise' but registers no row reader for 'identity_provider', 'invitation', 'team' — the credential binding reads/,
      );
    } finally {
      rmSync(enterpriseDir, { recursive: true, force: true });
    }
  });
});

/**
 * The driver-substitution arm: every consumption site routes through
 * the composed drivers — the registry lane serves the substituted
 * catalog's document, the platform exchange mints through the substituted
 * credential provider, and the artifact factory selects the registered
 * blob driver by its configured name.
 */
describe("extension composition (driver substitution)", () => {
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
        // skill store stays on its default local arm (per-domain).
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
      scope: { case: "runId", value: "aex_substituted" },
    });
    expect(out.runnerScopedToken).toBe("fake-execution_scoped-aex_substituted");
    expect(out.expiresInSeconds).toBe(42);
  });

  it("the artifact factory constructed the registered blob driver exactly once", () => {
    expect(blobDriverConstructed).toBe(1);
  });
});

/**
 * The gate-slot + status-hook arms: an extension gate spliced into a
 * declared slot refuses with its own ConnectError code and copy — before
 * the side effect on a pre-side-effect slot (nothing persisted: the
 * session and organization chains), after it on the post-persist slot
 * (the row survives the failed request, the inherited Java semantics);
 * the status observers
 * see the terminal updateStatus transition exactly once (the
 * phase-change rule) and the response decorator contributes the control
 * signal on the shared reply schema.
 */
describe("extension composition (gate slots + status hooks)", () => {
  const REFUSED_SESSION = "gate-refused-session";
  const REFUSED_ORG_SLUG = "gaterefusedorg";
  const PRE_REFUSED_ORG_SLUG = "prerefusedorg";
  let server: ComposedServer;
  let dir: string;
  let portTransport: Transport;
  const observed: RunStatusTransition[] = [];

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
          response.signal = RunControlSignal.STOP;
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
    await seedOrganizations(portTransport, ["acme"]);
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
          spec: {},
        }),
      );
    } catch (error) {
      refused = ConnectError.from(error);
    }
    // The gate's own code and copy reach the wire (the refusal
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
        metadata: { name: "gate-allowed-session", org: "acme" },
        spec: {},
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
          metadata: { name: "Gate Refused Org", slug: REFUSED_ORG_SLUG },
        }),
      );
    } catch (error) {
      refused = ConnectError.from(error);
    }
    expect(refused?.code).toBe(Code.FailedPrecondition);
    expect(refused?.rawMessage).toBe("fake tuple seeding failed");

    // The slot sits AFTER Persist: the row was committed before the gate
    // refused — healed by idempotent retry, never rolled back.
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
      ApiResourceKind.run,
      executionId,
      RunSchema,
      create(RunSchema, {
        metadata: { id: executionId, name: executionId, org: "acme" },
        spec: { message: "hook test" },
        status: { phase: RunPhase.RUN_IN_PROGRESS },
      }),
    );
    const command = createClient(
      RunCommandController,
      portTransport,
    );

    observed.length = 0;
    const reply = await command.updateStatus({
      runId: executionId,
      status: {
        phase: RunPhase.RUN_COMPLETED,
        completedAt: "2026-08-27T10:00:00Z",
        messages: [{ content: "done" }],
      },
    });
    // The decorator's contribution rides the field the shared reply
    // schema already carries (the cloud's control-signal seam).
    expect(reply.signal).toBe(RunControlSignal.STOP);
    expect(observed).toHaveLength(1);
    expect(observed[0]?.oldPhase).toBe(RunPhase.RUN_IN_PROGRESS);
    expect(observed[0]?.newPhase).toBe(RunPhase.RUN_COMPLETED);
    expect(observed[0]?.run.metadata?.id).toBe(executionId);

    // A repeat report with the phase unchanged decorates the reply but
    // does NOT re-notify (the phase-change rule).
    const repeat = await command.updateStatus({
      runId: executionId,
      status: {
        phase: RunPhase.RUN_COMPLETED,
        completedAt: "2026-08-27T10:00:00Z",
        messages: [{ content: "done" }],
      },
    });
    expect(repeat.signal).toBe(RunControlSignal.STOP);
    expect(observed).toHaveLength(1);
  });
});

describe("extension composition (tuple lifecycle + organization directory)", () => {
  let server: ComposedServer;
  let dir: string;
  let portTransport: Transport;

  const createdEvents: ResourceCreatedEvent[] = [];
  const deletedEvents: ResourceDeletedEvent[] = [];
  const visibilityEvents: VisibilityChangedEvent[] = [];
  const childLinkEvents: ChildOrganizationLinkedEvent[] = [];
  let failCreates = false;
  let failDeletes = false;
  const failDeleteKinds = new Set<ApiResourceKind>();

  const fakeLifecycle: ResourceAuthorizationLifecycle = {
    async onResourceCreated(event): Promise<void> {
      if (failCreates) {
        throw new Error("fga is down");
      }
      createdEvents.push(event);
    },
    async onResourceDeleted(event): Promise<void> {
      if (failDeletes || failDeleteKinds.has(event.kind)) {
        throw new Error("fga is down");
      }
      deletedEvents.push(event);
    },
    async onVisibilityChanged(event): Promise<void> {
      visibilityEvents.push(event);
    },
    async onChildOrganizationLinked(event): Promise<void> {
      childLinkEvents.push(event);
    },
  };

  // The directory answers are test-mutable so each case can stage its
  // own world without a second composed server.
  const myOrgIds: string[] = [];
  // The id the server mints for `seededorg` in the first case. Requests
  // over the port name the organization by slug; every value the server
  // stores or hands a driver carries this id, so the expectations do too.
  let seededOrgId = "";
  const fakeDirectory: OrganizationDirectory = {
    refusesEnumeration: true,
    listMyOrganizationIds: async () => [...myOrgIds],
  };
  // Every check is allowed except managing the children of the parents
  // named here, so the child lanes' own authorization is the one refusal
  // the suite can see.
  const deniedParents = new Set<string>();
  const childChecks: AuthzCheck[] = [];

  const iamExtension: ServerExtension = {
    name: "fake-iam",
    authorizer: {
      authorize: (_caller, check) => {
        if (check.permission === IamPermission.can_manage_child_orgs) {
          childChecks.push(check);
          if (deniedParents.has(check.resourceId)) {
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
        metadata: { name: "Seeded Org", slug: "seededorg" },
      }),
    );
    expect(createdEvents).toHaveLength(1);
    const event = createdEvents[0]!;
    expect(event.kind).toBe(ApiResourceKind.organization);
    expect(event.resourceId).toBe(org.metadata?.id);
    expect(event.parentLinks).toEqual([]);
    expect(event.caller.identityId).not.toBe("");
    seededOrgId = org.metadata?.id ?? "";
    expect(seededOrgId).toMatch(/^org_[0-9a-z]{26}$/);
    expect(org.metadata?.slug).toBe("seededorg");
    myOrgIds.push(seededOrgId);
    expect(event.ownerAttribution).toBe(OwnerAttributionType.DIRECT);
    expect(childLinkEvents).toEqual([]);
  });

  it("agent create fires one creation event, the agent's, with its organization link and visibility shape", async () => {
    const command = createClient(AgentCommandController, portTransport);
    createdEvents.length = 0;
    await command.create(
      create(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: {
          name: "seeded-agent",
          org: "seededorg",
          visibility: ApiResourceVisibility.visibility_org,
        },
        spec: { instructions: "a conformant instruction body" },
      }),
    );
    expect(createdEvents).toHaveLength(1);
    const agentEvent = createdEvents[0];
    expect(agentEvent?.kind).toBe(ApiResourceKind.agent);
    expect(agentEvent?.parentLinks).toEqual([
      {
        relation: "organization",
        parentKind: ApiResourceKind.organization,
        parentId: seededOrgId,
      },
    ]);
    expect(agentEvent?.visibilityShapes).toEqual(["org-viewer"]);
  });

  it("updateVisibility fires the set-diff transition (org→private deletes the org shape)", async () => {
    const command = createClient(AgentCommandController, portTransport);
    const agent = await command.create(
      create(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: {
          name: "seeded-visibility-agent",
          org: "seededorg",
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
        metadata: { name: "seeded-deleted-agent", org: "seededorg" },
        spec: { instructions: "a conformant instruction body" },
      }),
    );
    deletedEvents.length = 0;
    await command.delete({ value: first.metadata?.id ?? "" });
    expect(deletedEvents.map((event) => [event.kind, event.resourceId])).toEqual([
      [ApiResourceKind.agent, first.metadata?.id],
    ]);

    const second = await command.create(
      create(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: { name: "seeded-orphaned-agent", org: "seededorg" },
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

  // stigmer#1603. A parent's delete removes the children it owns (an
  // agent's same-organization shares, a session's runs) row by row. Each child's access is cleaned as its own
  // delete would clean it: the same event, the child's own organization, the
  // deleting caller, fired before the parent's, while every link the child
  // reaches its organization through still stands.
  describe("a parent's cascade cleans every child it deletes", () => {
    /** The events as `[kind, id]`, the children in id order, then the parent. */
    function cascadeOrder(events: ReadonlyArray<ResourceDeletedEvent>): Array<[ApiResourceKind, string]> {
      const children = events.slice(0, -1).map((event): [ApiResourceKind, string] => [event.kind, event.resourceId]);
      children.sort((a, b) => a[1].localeCompare(b[1]));
      const parent = events.at(-1);
      return parent === undefined ? children : [...children, [parent.kind, parent.resourceId]];
    }

    function expectOneCallerAndOrganization(events: ReadonlyArray<ResourceDeletedEvent>): void {
      for (const event of events) {
        expect(event.orgId, `${ApiResourceKind[event.kind]} ${event.resourceId}`).toBe(seededOrgId);
        expect(event.caller).toEqual(events.at(-1)?.caller);
      }
    }

    it("an agent's delete cleans its share, then the agent", async () => {
      const command = createClient(AgentCommandController, portTransport);
      const agent = await command.create(
        create(AgentSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Agent",
          metadata: { name: "seeded-cascade-agent", org: "seededorg" },
          spec: { instructions: "a conformant instruction body" },
        }),
      );
      const agentId = agent.metadata?.id ?? "";
      // Shares are seeded as the agent domain suite seeds them; the cascade
      // finds a share by its agent reference.
      await server.store.saveResource(
        ApiResourceKind.agent_share,
        "ash_seeded_cascade",
        AgentShareSchema,
        create(AgentShareSchema, {
          metadata: { id: "ash_seeded_cascade", name: "seeded-cascade-share", org: seededOrgId },
          spec: {
            agentRef: { kind: ApiResourceKind.agent, org: seededOrgId, slug: agent.metadata?.slug ?? "" },
          },
        }),
      );

      deletedEvents.length = 0;
      await command.delete({ value: agentId });

      expect(cascadeOrder(deletedEvents)).toEqual([
        [ApiResourceKind.agent_share, "ash_seeded_cascade"],
        [ApiResourceKind.agent, agentId],
      ]);
      expectOneCallerAndOrganization(deletedEvents);
    });

    it("a session's delete cleans each of its runs, then the session", async () => {
      const sessionId = "ses_c2_cascade";
      await server.store.saveResource(
        ApiResourceKind.session,
        sessionId,
        SessionSchema,
        create(SessionSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Session",
          metadata: { id: sessionId, name: "seeded-cascade-session", org: seededOrgId },
          spec: {},
        }),
      );
      const runIds = ["aex_c2_cascade_1", "aex_c2_cascade_2"];
      for (const runId of runIds) {
        await server.store.saveResource(
          ApiResourceKind.run,
          runId,
          RunSchema,
          create(RunSchema, {
            apiVersion: "agentic.stigmer.ai/v1",
            kind: "AgentRun",
            metadata: { id: runId, name: runId, org: seededOrgId },
            spec: { target: { case: "sessionId", value: sessionId } },
            status: { phase: RunPhase.RUN_COMPLETED },
          }),
        );
      }

      deletedEvents.length = 0;
      await createClient(SessionCommandController, portTransport).delete({ value: sessionId });

      expect(cascadeOrder(deletedEvents)).toEqual([
        ...runIds.map((runId): [ApiResourceKind, string] => [ApiResourceKind.run, runId]),
        [ApiResourceKind.session, sessionId],
      ]);
      expectOneCallerAndOrganization(deletedEvents);
    });

    it("a child's cleanup failure never fails the parent's delete", async () => {
      const sessionId = "ses_c2_unclean";
      const runId = "aex_c2_unclean";
      await server.store.saveResource(
        ApiResourceKind.session,
        sessionId,
        SessionSchema,
        create(SessionSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Session",
          metadata: { id: sessionId, name: "seeded-cascade-unclean", org: seededOrgId },
          spec: {},
        }),
      );
      await server.store.saveResource(
        ApiResourceKind.run,
        runId,
        RunSchema,
        create(RunSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "AgentRun",
          metadata: { id: runId, name: runId, org: seededOrgId },
          spec: { target: { case: "sessionId", value: sessionId } },
          status: { phase: RunPhase.RUN_COMPLETED },
        }),
      );
      deletedEvents.length = 0;
      failDeleteKinds.add(ApiResourceKind.run);
      try {
        await createClient(SessionCommandController, portTransport).delete({ value: sessionId });
      } finally {
        failDeleteKinds.clear();
      }
      // Best-effort, as the parent's own cleanup is: the run's cleanup
      // threw and was logged, the run row is gone, the session is cleaned.
      expect(deletedEvents.map((event) => [event.kind, event.resourceId])).toEqual([
        [ApiResourceKind.session, sessionId],
      ]);
      await expect(
        server.store.getResource(ApiResourceKind.run, runId, RunSchema),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });
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
          metadata: { name: "seeded-halfcreated-agent", org: "seededorg" },
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
      org: "seededorg",
      slug: "seeded-halfcreated-agent",
    });
    expect(half.metadata?.name).toBe("seeded-halfcreated-agent");
  });

  it("the directory's enumeration refusal answers UNIMPLEMENTED on a valid find", async () => {
    const query = createClient(OrganizationQueryController, portTransport);
    let refused: ConnectError | undefined;
    try {
      await query.find({ org: "seededorg", pageSize: 10, pageNumber: 1 });
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

  it("a child organization's create links it to its parent and fires its creation event with NO owner", async () => {
    const command = createClient(OrganizationCommandController, portTransport);
    createdEvents.length = 0;
    childLinkEvents.length = 0;
    childChecks.length = 0;
    const child = await command.create(
      create(OrganizationSchema, {
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { name: "Seeded Child", slug: "seededchild" },
        spec: { parentOrg: "seededorg", externalId: "cust-42" },
      }),
    );
    expect(child.spec?.parentOrg).toBe(seededOrgId);
    expect(childChecks).toEqual([
      {
        permission: IamPermission.can_manage_child_orgs,
        resourceKind: ApiResourceKind.organization,
        resourceId: seededOrgId,
      },
    ]);
    expect(createdEvents.map((event) => event.ownerAttribution)).toEqual([
      OwnerAttributionType.NONE,
    ]);
    expect(childLinkEvents).toEqual([
      { childId: child.metadata?.id, parentId: seededOrgId },
    ]);
  });

  it("getByExternalId and listChildOrgs ask can_manage_child_orgs on the parent, and answer its child", async () => {
    const query = createClient(OrganizationQueryController, portTransport);
    childChecks.length = 0;
    const found = await query.getByExternalId({
      parentOrg: "seededorg",
      externalId: "cust-42",
    });
    expect(found.metadata?.slug).toBe("seededchild");
    const listed = await query.listChildOrgs({ org: "seededorg" });
    expect(listed.entries.map((org) => org.metadata?.slug)).toEqual([
      "seededchild",
    ]);
    expect(childChecks.map((check) => check.resourceId)).toEqual([
      seededOrgId,
      seededOrgId,
    ]);
  });

  it("a caller who may not manage the parent is refused on every child lane, before anything is said about its children", async () => {
    const query = createClient(OrganizationQueryController, portTransport);
    const command = createClient(OrganizationCommandController, portTransport);
    deniedParents.add(seededOrgId);
    try {
      for (const externalId of ["cust-42", "cust-unknown"]) {
        const refused = await refusalOf(
          query.getByExternalId({ parentOrg: "seededorg", externalId }),
        );
        expect(refused.code).toBe(Code.PermissionDenied);
      }
      expect(
        (await refusalOf(query.listChildOrgs({ org: "seededorg" }))).code,
      ).toBe(Code.PermissionDenied);
      const create_ = await refusalOf(
        command.create(
          create(OrganizationSchema, {
            apiVersion: "tenancy.stigmer.ai/v1",
            kind: "Organization",
            metadata: { name: "Refused Child", slug: "refusedchild" },
            spec: { parentOrg: "seededorg" },
          }),
        ),
      );
      expect(create_.code).toBe(Code.PermissionDenied);
      expect(create_.rawMessage).toBe(
        "unauthorized to manage this organization's child organizations",
      );
    } finally {
      deniedParents.delete(seededOrgId);
    }
  });

  // stigmer#1647. The server deletes a run's execution context itself: the
  // run-end activity, and the recover steps before they recreate it. That
  // delete is the context's own delete chain over the in-process edge, so the
  // context is cleaned exactly as its delete RPC cleans it: the lifecycle's
  // event, and the search row its create indexed.
  it("the server's own delete of an execution context cleans it as its delete RPC would", async () => {
    const command = createClient(ExecutionContextCommandController, server.inProcessTransport);
    const query = createClient(ExecutionContextQueryController, server.inProcessTransport);
    const executionId = "aex_internal_delete";
    const context = await command.create(
      create(ExecutionContextSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "ExecutionContext",
        // In-process: server code passes the id, which nothing resolves.
        metadata: { name: `exec-ctx-${executionId}`, org: seededOrgId },
        spec: { executionId },
      }),
    );
    const contextId = context.metadata?.id ?? "";
    const kindName = apiResourceKindName(ApiResourceKind.execution_context);
    const searchRows = async (): Promise<number> =>
      (
        await server.store.querySearchIndex({
          kinds: [kindName],
          terms: undefined,
          orgFilter: "",
          authorizedIdsByKind: new Map([[kindName, new Set([contextId])]]),
          limit: 10,
          offset: 0,
        })
      ).totalCount;
    expect(await searchRows(), "the create indexed the context").toBe(1);

    deletedEvents.length = 0;
    await deleteExecutionContextAsTheServer(executionId);

    expect(deletedEvents.map((event) => [event.kind, event.resourceId, event.orgId])).toEqual([
      [ApiResourceKind.execution_context, contextId, seededOrgId],
    ]);
    expect(await searchRows(), "the search row went with the context").toBe(0);
    let getError: ConnectError | undefined;
    try {
      await query.get({ value: contextId });
    } catch (error) {
      getError = ConnectError.from(error);
    }
    expect(getError?.code).toBe(Code.NotFound);
  });

  /**
   * The run-end activity's delete of a run's context, as the server composes
   * it: the store read, then the production edge from boot/inprocess.ts,
   * built over the composed server's own routes and in-process chain.
   */
  async function deleteExecutionContextAsTheServer(executionId: string): Promise<void> {
    const logger = createLogger({ level: "error", pretty: false, write: () => {} });
    const { executionContextDeleter } = createInProcessClients(server.routes, logger).clients;
    await deleteExecutionContextForExecution(
      { store: server.store, deleter: () => executionContextDeleter, logger },
      executionId,
      "run-end",
    );
  }
});
