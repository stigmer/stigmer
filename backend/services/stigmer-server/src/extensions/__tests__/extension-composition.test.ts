/**
 * Pins the composed extension surface end to end (sub-project
 * 20260826.09/O1, DD-006 §2a): a fake extension unit registering a
 * cloud-family service the OSS server never serves
 * (BillingQueryController) is visible through BOTH routers — the bound
 * port and the in-process transport — with the full interceptor chain
 * running on each lane (the SP-B parity doctrine extended to extension
 * services), and the registry-declared edition answers on getServerInfo.
 *
 * The empty-set arm — no extensions composed, wire behavior byte-identical
 * to before the parameter existed — is pinned where it belongs: the
 * platform domain suite (edition oss) and the four conformance rosters.
 */
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
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import {
  ExecutionControlSignal,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { BillingQueryController } from "@stigmer/protos/ai/stigmer/billing/v1/query_pb";
import { BillingAccountSchema } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import {
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { createLogger } from "../../boot/logger.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { GateSlotName } from "../gate-slots.js";
import type { OrganizationDirectory } from "../organization-directory.js";
import type {
  ResourceAuthorizationLifecycle,
  ResourceCreatedEvent,
  ResourceDeletedEvent,
  VisibilityChangedEvent,
} from "../resource-authorization.js";
import type { AgentExecutionStatusTransition } from "../status-hooks.js";
import type { ServerExtension } from "../registry.js";

const BILLING_PROCEDURE =
  "/ai.stigmer.billing.v1.BillingQueryController/getBillingAccount";

describe("extension composition (composed server)", () => {
  let server: ComposedServer;
  let dir: string;
  let portTransport: Transport;
  // Captured NDJSON log lines — the interceptor-chain proof reads them.
  const logLines: string[] = [];

  const fakeBillingExtension: ServerExtension = {
    name: "fake-billing",
    edition: ServerEdition.cloud,
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
    portTransport = createGrpcTransport({
      baseUrl: `http://127.0.0.1:${port}`,
    });
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
 * the side effect on the pre-side-effect slot (nothing persisted), after
 * it on the post-persist slot (the row survives the failed request, the
 * inherited Java semantics — O4 verification V1); the status observers
 * see the terminal updateStatus transition exactly once (the Q4
 * phase-change rule) and the response decorator contributes the control
 * signal on the shared reply schema.
 */
describe("extension composition (O4 gate slots + status hooks)", () => {
  const REFUSED_SESSION = "o4-refused-session";
  const REFUSED_ORG_SLUG = "o4refusedorg";
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

  const gateExtension: ServerExtension = {
    name: "fake-gates-and-hooks",
    gateSteps: new Map<GateSlotName, ReadonlyArray<PipelineStep<DescMessage>>>([
      ["session-create:pre-side-effect-gate", [sessionGate]],
      ["org-create:post-persist", [orgPostPersistGate]],
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
  let failCreates = false;
  let failDeletes = false;

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
  };

  // The directory answers are test-mutable so each case can stage its
  // own world without a second composed server.
  const myOrgIds: string[] = [];
  const externalOrgMap = new Map<string, string>();
  const fakeDirectory: OrganizationDirectory = {
    refusesEnumeration: true,
    listMyOrganizationIds: async () => [...myOrgIds],
    getOrganizationIdByExternalOrgId: async (externalOrgId) =>
      externalOrgMap.get(externalOrgId),
  };

  const iamExtension: ServerExtension = {
    name: "fake-iam",
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
    externalOrgMap.set("ext-org-42", org.metadata?.id ?? "");
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

  it("updateVisibility fires the set-diff transition (org→public keeps the floor)", async () => {
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
      visibility: ApiResourceVisibility.visibility_public,
    });
    expect(visibilityEvents).toHaveLength(1);
    const event = visibilityEvents[0]!;
    expect(event.shapesToCreate).toEqual(["public-viewer"]);
    expect(event.shapesToDelete).toEqual([]);
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

  it("getByExternalOrgId registers with the directory lookup and resolves the mapping", async () => {
    const query = createClient(OrganizationQueryController, portTransport);
    // identity_provider_ref is proto-required on the lookup message; the
    // directory's resolution key is the (globally unique) external id.
    const idpRef = { org: "c2seededorg", slug: "test-idp" };
    const org = await query.getByExternalOrgId({
      identityProviderRef: idpRef,
      externalOrgId: "ext-org-42",
    });
    expect(org.metadata?.id).toBe(myOrgIds[0]);

    let missing: ConnectError | undefined;
    try {
      await query.getByExternalOrgId({
        identityProviderRef: idpRef,
        externalOrgId: "ext-org-unknown",
      });
    } catch (error) {
      missing = ConnectError.from(error);
    }
    expect(missing?.code).toBe(Code.NotFound);
  });
});
