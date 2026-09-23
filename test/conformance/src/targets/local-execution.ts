// Local execution target: the OSS server + Temporal + TS runner (Class B).
// Born as local-ts-execution during the TS rewrite (stigmer-cloud program
// 20260822.01, D4 #18) and renamed to plain `local-execution` when the Go
// server retired (D4 #25) — there is one local implementation now.
// Domain: conformance targets (execution engine).
//
// Boot order is load-bearing: Temporal must be up before the server (so the
// TemporalManager's initial connect flips the engine-state provider to
// connected), and the server before the runner (which streams status back
// to it). teardown() reverses it.
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { awaitGrpcReady } from "../harness/grpc-ready";
import {
  createTransport,
  makeClients,
  type ConformanceClients,
  type PresentingOptions,
} from "../harness/clients";
import type { SiblingEnforcingLane } from "../harness/enforcing-lane";
import { newSiblingEnforcingExecutionLane } from "../harness/enforcing-execution-lane";
import { McpToolFixture } from "../harness/mcp-server";
import { MockLlmProxy } from "../harness/mock-llm";
import { fetchModelRegistryDocument, type ModelRegistryDocument } from "../harness/model-registry";
import { ensureRunnerBuilt } from "../harness/runner-build";
import { spawnRunner, type RunningRunner } from "../harness/runner-process";
import {
  ephemeralSqliteStorage,
  spawnServer,
  type ProvisionedStorage,
  type RunningServer,
} from "../harness/server-process";
import { spawnTemporal, type RunningTemporal } from "../harness/temporal";
import { ensureTsServerEntry } from "../harness/ts-build";
import { uniqueOrg } from "../support/naming";
import type {
  CapabilityFlags,
  EngineCoordinates,
  EnforcingLane,
  PrivilegedScope,
  SiblingExecutionServer,
  SpawnSiblingOptions,
  TargetProfile,
  TenancyContext,
} from "./target";

export class LocalExecutionTarget implements TargetProfile {
  readonly name: string = "local-execution";
  // Same empty composition as `local`, with an engine behind it; having an
  // engine changes no edition. local-postgres-execution inherits it.
  readonly edition: ServerEdition = ServerEdition.oss;
  // The retired local-go-execution matrix plus exactly ONE deliberate
  // difference: workflowChildApprovalForwarding is true here (the D4
  // ratified parity-plus delta, #23) where the Go server never sent it.
  readonly capabilities: CapabilityFlags = {
    multiTenant: false,
    // Trusted-local primary, as `local`; the enforcing lane is an OIDC
    // sibling this target boots WITH an engine and a runner
    // (enforcingLane below).
    enforcingAuthorizer: false,
    externalOrgLookup: false,
    organizationEnumeration: true,
    versionTagging: false,
    skillArtifactTransferLane: true,
    // True since D4 #23: this server's agent-execution workflow emits the
    // child_approval_required signal from its HITL loop (DD-012 identity-only
    // sender), so a gated agent_call child surfaces at the parent workflow's
    // pending_approvals. The retired Go OSS server never sent it — this was
    // the one ratified capability divergence of the TS port.
    workflowChildApprovalForwarding: true,
    // True since D4 #22 ported the schedule clock (tick workflow +
    // reconciler on the schedule_stigmer queue).
    scheduleFiring: true,
    // The open-source runner presents each run's own credential and the
    // built-in verifier admits its bearer as the run's human; proven on
    // this target's enforcing lane, whose runner is keyed with the
    // founder's API key (stigmer#1138).
    runnerActsAsRunCreator: true,
    // Single-tenant OSS: the reserved-label write guard is cloud-only
    // (stigmer-cloud#320), so the caller may create labeled candidates.
    clientReservedLabelWrites: true,
    firstPartyMemoryCapture: true,
    clientPublicVisibilityWrites: true,
    // No channel runtime in this edition (T02 §0-b): the engine this target
    // provisions is the agent/workflow execution engine, not a channel
    // delivery runtime — the refusal posture is identical to `local`.
    channelMessaging: false,
    // The org BYOA lane is UNIMPLEMENTED on OSS by design (stigmer#558) —
    // the suite pins the three refusals here.
    orgOAuthAppConfiguration: false,
    // No billing engine at all — executions run unmetered (DD-001 boundary).
    billingGates: false,
    // The cloud-capability surfaces (E1): absent by DD-001, as on local.
    billingLedger: false,
    sideChannelProxy: false,
    publicLane: false,
    // Open source serves PlatformClient; the minting lane is the OIDC
    // sibling this target lends through enforcingLane(), where the key ring,
    // the platform-token verifier and the origin guard are composed.
    platformClientTokens: true,
    // Single-operator trusted-local posture, as on `local` — the runner's
    // STIGMER_TOKEN is a proxy bearer the server never verifies.
    requiresAuthentication: false,
    // No platform identity tenant on the single-operator posture; the OSS
    // OIDC lane is a different contract (target.ts).
    directLogin: false,
    // No unit composes the federation capability in the empty composition,
    // as on `local`.
    federatedIdentityAccounts: false,
    // Organization-only grants and no query engine, as on `local`.
    perResourceGrants: false,
    authorizationQueries: false,
  };

  private temporal: RunningTemporal | undefined;
  private server: RunningServer | undefined;
  private storage: ProvisionedStorage | undefined;
  private runner: RunningRunner | undefined;
  private mockLlm: MockLlmProxy | undefined;
  private mcpTools: McpToolFixture | undefined;
  private conformanceClients: ConformanceClients | undefined;
  // The one enforcing lane of this target instance — an OIDC sibling with
  // its own engine and a runner — created on the first enforcingLane() call
  // and torn down with the primary. Held as the pending promise so two
  // concurrent first calls spawn one lane, not two (the LocalTarget shape).
  private siblingLane: Promise<SiblingEnforcingLane> | undefined;

  async setup(): Promise<void> {
    const entry = await ensureTsServerEntry();
    const runnerEntry = await ensureRunnerBuilt();

    // 1. Temporal first: the TemporalManager's initial connect only flips the
    //    engine-state provider if the frontend is serving already.
    this.temporal = await spawnTemporal();

    // 2. The TS server (node entry, same env contract as the Go binary),
    //    pointed at the live Temporal frontend, on its own storage.
    this.storage = await this.provisionStorage();
    this.server = await spawnServer(process.execPath, {
      args: [entry],
      temporalHostPort: this.temporal.hostPort,
      env: {
        // The schedule failure-streak override the Go target pins — makes
        // the auto-pause provable in two fires (active since #22 ported
        // the schedule clock).
        STIGMER_SCHEDULES_MAX_CONSECUTIVE_FAILURES: "2",
        ...this.storage.serverEnv,
      },
    });
    this.conformanceClients = makeClients(createTransport(this.server.baseUrl));
    await awaitGrpcReady(this.conformanceClients, () => this.server?.logTail() ?? "(no server)");

    // 3. Mock LLM proxy before the runner, so its URL is known when the runner
    //    boots; the lever agent-execution suites program per test.
    this.mockLlm = new MockLlmProxy();
    await this.mockLlm.start();

    // 3b. MCP tool fixture: the tool surface a HITL agent run dispatches to;
    //     torn down last (with the proxy) because it must outlive executions.
    this.mcpTools = new McpToolFixture();
    await this.mcpTools.start();

    // 4. Runner last: it dials the server's gRPC endpoint to stream status back,
    //    the same server's HTTP lane for the model registry (the OSS topology,
    //    stigmer#240), and the mock proxy for LLM calls.
    this.runner = await spawnRunner({
      entryPath: runnerEntry,
      temporalHostPort: this.temporal.hostPort,
      backendEndpoint: this.server.baseUrl,
      registryOrigin: this.server.baseUrl,
      proxy: { endpoint: this.mockLlm.url(), token: "conformance-mock-token" },
      // Share the server's local artifact store so a storage-key attachment the
      // server wrote resolves when the runner reads it back (#285).
      artifactDir: this.server.artifactBaseDir,
      artifactServeUrl: this.server.artifactServeUrl,
    });
  }

  // The storage-driver seam (the LocalTarget shape): local-postgres-execution
  // overrides this to provision a throwaway database (its DATABASE_URL wins
  // over the harness's DB_PATH — the documented config precedence).
  // EVERYTHING else about the target is inherited, so the capability
  // matrix is byte-identical by construction, not by copy discipline
  // (DD-011: the driver must be wire-invisible).
  protected async provisionStorage(): Promise<ProvisionedStorage> {
    return ephemeralSqliteStorage();
  }

  // A second server of this edition in the suite's posture, WITH ITS OWN
  // ENGINE: the primary's Temporal cannot be shared (same namespace, same
  // task queue — the trusted-local runner would take the sibling's work),
  // and on an execution target a server without an engine is one that
  // cannot run anything, so this sibling always brings one. Storage comes
  // from the same seam as the primary's, so local-postgres-execution proves
  // the same arms on the Postgres driver by inheritance. Boot order is the
  // primary's (Temporal, then the server); readiness is the harness's one
  // gate, presented with the bearer the suite supplied; teardown reverses.
  async spawnSibling(
    options: SpawnSiblingOptions,
  ): Promise<SiblingExecutionServer> {
    const entry = await ensureTsServerEntry();
    const temporal = await spawnTemporal();
    let storage: ProvisionedStorage;
    try {
      storage = await this.provisionStorage();
    } catch (error) {
      await temporal.stop();
      throw error;
    }
    let server: RunningServer;
    try {
      server = await spawnServer(process.execPath, {
        args: [entry],
        temporalHostPort: temporal.hostPort,
        env: { ...storage.serverEnv, ...options.env },
      });
    } catch (error) {
      await storage.release();
      await temporal.stop();
      throw error;
    }
    const clientsPresenting = (
      bearerToken: string,
      options: PresentingOptions = {},
    ): ConformanceClients =>
      makeClients(createTransport(server.baseUrl, { ...options, bearerToken }));
    const teardown = async (): Promise<void> => {
      await server.stop();
      await storage.release();
      await temporal.stop();
    };
    try {
      await awaitGrpcReady(clientsPresenting(options.readinessBearer), () =>
        server.logTail(),
      );
    } catch (error) {
      await teardown();
      throw error;
    }
    return {
      clientsPresenting,
      teardown,
      engine: {
        temporalHostPort: temporal.hostPort,
        serverBaseUrl: server.baseUrl,
      },
      artifactStore: {
        dir: server.artifactBaseDir,
        serveUrl: server.artifactServeUrl,
      },
    };
  }

  // Open source enforces the model in the OIDC posture, so this target's
  // enforcing lane is a sibling booted there against the harness's local
  // issuer — with an engine and a runner keyed with the founder's API key,
  // so the arms can dispatch a run under enforcement and read what the
  // runner did as whom (harness/enforcing-execution-lane.ts owns the shape).
  async enforcingLane(): Promise<EnforcingLane> {
    if (this.server === undefined) {
      throw new Error(
        "LocalExecutionTarget.setup() must be called before enforcingLane()",
      );
    }
    this.siblingLane ??= newSiblingEnforcingExecutionLane({
      spawnSibling: (options) => this.spawnSibling(options),
    });
    return (await this.siblingLane).lane;
  }

  llmProxy(): MockLlmProxy {
    if (this.mockLlm === undefined) {
      throw new Error("LocalExecutionTarget.setup() must be called before llmProxy()");
    }
    return this.mockLlm;
  }

  mcpFixture(): McpToolFixture {
    if (this.mcpTools === undefined) {
      throw new Error("LocalExecutionTarget.setup() must be called before mcpFixture()");
    }
    return this.mcpTools;
  }

  // The document the runner was pointed at (registryOrigin above): the OSS
  // unified port serves it anonymously from the server's bundled snapshot.
  modelRegistryDocument(): Promise<ModelRegistryDocument> {
    return fetchModelRegistryDocument(this.serverBaseUrl());
  }

  runnerHomeDir(): string {
    if (this.runner === undefined) {
      throw new Error("LocalExecutionTarget.setup() must be called before runnerHomeDir()");
    }
    return this.runner.homeDir;
  }

  runnerLogFile(): string {
    if (this.runner === undefined) {
      throw new Error("LocalExecutionTarget.setup() must be called before runnerLogFile()");
    }
    return this.runner.logFile;
  }

  // The unified port's base URL — gRPC and the plain-HTTP lanes alike (the
  // LocalTarget accessor, here because the architect fixture's stdio
  // mcp-server dials it and the registry lane lives on it).
  httpBaseUrl(): string {
    return this.serverBaseUrl();
  }

  artifactStoreDir(): string {
    if (this.server === undefined) {
      throw new Error("LocalExecutionTarget.setup() must be called before artifactStoreDir()");
    }
    return this.server.artifactBaseDir;
  }

  engineCoordinates(): EngineCoordinates {
    if (this.temporal === undefined) {
      throw new Error("LocalExecutionTarget.setup() must be called before engineCoordinates()");
    }
    return { temporalHostPort: this.temporal.hostPort, serverBaseUrl: this.serverBaseUrl() };
  }

  clients(): ConformanceClients {
    if (this.conformanceClients === undefined) {
      throw new Error("LocalExecutionTarget.setup() must be called before clients()");
    }
    return this.conformanceClients;
  }

  anonymousClients(): ConformanceClients {
    return makeClients(createTransport(this.serverBaseUrl()));
  }

  clientsPresenting(bearerToken: string, options: PresentingOptions = {}): ConformanceClients {
    return makeClients(createTransport(this.serverBaseUrl(), { ...options, bearerToken }));
  }

  private serverBaseUrl(): string {
    if (this.server === undefined) {
      throw new Error("LocalExecutionTarget.setup() must be called before building clients");
    }
    return this.server.baseUrl;
  }

  async provisionTenancy(): Promise<TenancyContext> {
    // No auth and no bootstrap org: a unique slug is a fully isolated scope.
    return { org: uniqueOrg() };
  }

  async cleanupTenancy(): Promise<void> {
    // No-op: resources are removed by fixtures and the per-file teardown.
  }

  // Single-tenant and deliberately unguarded: the one implicit caller IS the
  // operator, so the ordinary clients and a fresh slug satisfy the privileged
  // contract (stigmer#547).
  async provisionPrivilegedScope(): Promise<PrivilegedScope> {
    return { clients: this.clients(), context: { org: uniqueOrg() }, cleanup: async () => {} };
  }

  async teardown(): Promise<void> {
    // The sibling lane first (its own runner, mock, server, Temporal and
    // issuer): a lane whose spawn failed rejected the promise the arms
    // already saw, and has nothing left to close.
    if (this.siblingLane !== undefined) {
      const pending = this.siblingLane;
      this.siblingLane = undefined;
      await pending.then((sibling) => sibling.close()).catch(() => undefined);
    }
    // Reverse boot order: runner, then the LLM/MCP fixtures, then server, then Temporal.
    await this.runner?.stop();
    await this.mockLlm?.close();
    await this.mcpTools?.close();
    await this.server?.stop();
    await this.storage?.release();
    await this.temporal?.stop();
    this.runner = undefined;
    this.mockLlm = undefined;
    this.mcpTools = undefined;
    this.server = undefined;
    this.storage = undefined;
    this.temporal = undefined;
    this.conformanceClients = undefined;
  }
}
