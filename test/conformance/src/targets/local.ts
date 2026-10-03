// Local target: builds and boots the OSS TypeScript server from source.
// Born as local-ts during the TS rewrite and renamed to plain `local` when
// the Go server retired — there is one local implementation now.
// Domain: conformance targets.
//
// This is a managed target — it owns the server process lifecycle. The
// server runs single-tenant with no auth and no Temporal (not needed for
// the CRUD domains), so tenancy provisioning is one fresh Organization per
// scope, created by the one implicit caller (support/organizations.ts).
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { ensureTsServerEntry } from "@stigmer/test-support/ts-build";
import {
  createTransport,
  makeClients,
  type ConformanceClients,
  type PresentingOptions,
} from "../harness/clients";
import { newSiblingEnforcingLane, type SiblingEnforcingLane } from "../harness/enforcing-lane";
import { awaitGrpcReady } from "../harness/grpc-ready";
import {
  ephemeralSqliteStorage,
  spawnServer,
  type ProvisionedStorage,
  type RunningServer,
} from "@stigmer/test-support/server-process";
import { createUniqueOrganization } from "../support/organizations";
import type {
  CapabilityFlags,
  EnforcingLane,
  PrivilegedScope,
  SiblingServer,
  SpawnSiblingOptions,
  TargetProfile,
  TenancyContext,
} from "./target";

export class LocalTarget implements TargetProfile {
  readonly name: string = "local";
  // The empty composition (`composeServer({ extensions: [] })`) is Stigmer
  // open source; local-postgres inherits it (same composition, other store).
  readonly edition: ServerEdition = ServerEdition.oss;
  // The open-source server's matrix without an engine; local-execution adds
  // the flags an engine makes true.
  readonly capabilities: CapabilityFlags = {
    multiTenant: false,
    // The primary runs trusted-local: its permissive Authorizer admits the
    // one operator to everything. Enforcement on open source is proven on
    // the OIDC sibling this target lends through enforcingLane().
    enforcingAuthorizer: false,
    externalOrgLookup: false,
    organizationEnumeration: true,
    versionTagging: true,
    skillArtifactTransferLane: true,
    workflowChildApprovalForwarding: false,
    // No Temporal behind this target at all — schedules cannot fire.
    scheduleFiring: false,
    // No runner behind this target either; the open-source runner's shape
    // is proven on local-execution, whose enforcing lane boots one.
    runnerActsAsRunCreator: false,
    // Single-tenant OSS: the reserved-label write guard is cloud-only, so the
    // caller may create labeled candidates.
    clientReservedLabelWrites: true,
    firstPartyMemoryCapture: true,
    // No channel runtime in this edition — the suite pins the
    // documented refusal copy on every runtime lane.
    channelMessaging: false,
    // The org BYOA lane is UNIMPLEMENTED on OSS by design (stigmer#558) —
    // the TS port must reproduce the three refusals byte-for-byte.
    orgOAuthAppConfiguration: false,
    // No billing engine at all — executions run unmetered (the edition
    // boundary).
    billingGates: false,
    // The three cloud-capability surfaces are absent by the same boundary:
    // no billing controllers are routed (the suite pins the Unimplemented
    // answer), no side-channel proxy (runners dial
    // providers directly), no marketing-site lane.
    billingLedger: false,
    // Plans and subscriptions are cloud_only kinds: the suite pins Unimplemented.
    billingPlans: false,
    sideChannelProxy: false,
    publicLane: false,
    // Open source serves PlatformClient; the minting lane is the OIDC
    // sibling this target lends through enforcingLane(), where the key ring,
    // the platform-token verifier and the origin guard are composed.
    platformClientTokens: true,
    // Single-operator trusted-local posture: no issuer, no declared
    // posture, zero verifiers — a tokenless request IS the operator (the
    // authentication suite pins that admission).
    requiresAuthentication: false,
    // No platform identity tenant on the single-operator posture; the OSS
    // OIDC lane is driven through a sibling server (spawnSibling below).
    directLogin: false,
    // No unit composes the federation capability in the empty composition —
    // the suite pins the four UNIMPLEMENTED refusals here.
    federatedIdentityAccounts: false,
    // The empty composition grants on organizations only and composes no
    // authorization query engine — the suite pins both edition refusals
    // here.
    perResourceGrants: false,
    authorizationQueries: false,
  };

  private server: RunningServer | undefined;
  private storage: ProvisionedStorage | undefined;
  private conformanceClients: ConformanceClients | undefined;
  // The one enforcing lane of this target instance (a sibling in the OIDC
  // posture), created on the first enforcingLane() call and torn down with
  // the primary. Held as the pending promise so two concurrent first calls
  // spawn one sibling, not two.
  private siblingLane: Promise<SiblingEnforcingLane> | undefined;

  async setup(): Promise<void> {
    const entry = await ensureTsServerEntry();
    this.storage = await this.provisionStorage();
    // The TS server is a node entry, not a binary — same env contract,
    // same ready-line gate (server-process.ts).
    this.server = await spawnServer(process.execPath, {
      args: [entry],
      env: this.storage.serverEnv,
    });
    this.conformanceClients = makeClients(createTransport(this.server.baseUrl));
    await awaitGrpcReady(this.conformanceClients, () => this.server?.logTail() ?? "(no server)");
  }

  // The storage-driver seam: one store per spawned server. local-postgres
  // overrides this to provision a throwaway database (its DATABASE_URL wins
  // over the harness's DB_PATH — the documented config precedence).
  // EVERYTHING else about the target is inherited, so the capability
  // matrix is byte-identical by construction, not by copy discipline
  // (the storage driver must be wire-invisible). The primary and every
  // sibling call it, so a sibling never shares the primary's store.
  protected async provisionStorage(): Promise<ProvisionedStorage> {
    return ephemeralSqliteStorage();
  }

  // A second server of this edition in the suite's posture, with its own
  // storage from the same seam as the primary (target.ts). Readiness is
  // the harness's one gate, presented with the bearer the suite supplied.
  async spawnSibling(options: SpawnSiblingOptions): Promise<SiblingServer> {
    const entry = await ensureTsServerEntry();
    const storage = await this.provisionStorage();
    let server: RunningServer;
    try {
      server = await spawnServer(process.execPath, {
        args: [entry],
        env: { ...storage.serverEnv, ...options.env },
      });
    } catch (error) {
      await storage.release();
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
    };
    try {
      await awaitGrpcReady(clientsPresenting(options.readinessBearer), () => server.logTail());
    } catch (error) {
      await teardown();
      throw error;
    }
    return { clientsPresenting, teardown };
  }

  // Open source enforces the model in the OIDC posture, so this target's
  // enforcing lane is a sibling booted there against the harness's local
  // issuer (harness/enforcing-lane.ts owns the shape; the storage seam
  // gives it its own store, so local-postgres proves the same arms on the
  // Postgres driver by inheritance).
  async enforcingLane(): Promise<EnforcingLane> {
    if (this.server === undefined) {
      throw new Error("LocalTarget.setup() must be called before enforcingLane()");
    }
    this.siblingLane ??= newSiblingEnforcingLane({
      spawnSibling: (options) => this.spawnSibling(options),
    });
    return (await this.siblingLane).lane;
  }

  clients(): ConformanceClients {
    if (this.conformanceClients === undefined) {
      throw new Error("LocalTarget.setup() must be called before clients()");
    }
    return this.conformanceClients;
  }

  // The ordinary clients already present nothing — this target runs without
  // auth — but the seam is built the same way on every target so the
  // authentication suite never reasons about which kind it has.
  anonymousClients(): ConformanceClients {
    return makeClients(createTransport(this.httpBaseUrl()));
  }

  clientsPresenting(bearerToken: string, options: PresentingOptions = {}): ConformanceClients {
    return makeClients(createTransport(this.httpBaseUrl(), { ...options, bearerToken }));
  }

  // The spawned server's unified port also serves the plain-HTTP lanes (the
  // registry proxies) — expose it so those suites can drive them directly.
  httpBaseUrl(): string {
    if (this.server === undefined) {
      throw new Error("LocalTarget.setup() must be called before httpBaseUrl()");
    }
    return this.server.baseUrl;
  }

  // The artifact file server's own port (local artifact storage only) — the
  // harness already pins it for the runner's serve URL; the artifact suite
  // drives its download-disposition contract through the same address.
  artifactHttpBaseUrl(): string {
    if (this.server === undefined) {
      throw new Error("LocalTarget.setup() must be called before artifactHttpBaseUrl()");
    }
    return this.server.artifactServeUrl;
  }

  async provisionTenancy(): Promise<TenancyContext> {
    // No auth and no bootstrap org: a fresh Organization is a fully isolated
    // scope. It is created, not just named: a write into an Organization the
    // server does not hold is NOT_FOUND (stigmer#1163).
    const { slug } = await createUniqueOrganization(this.clients().organizationCommand, "tenancy");
    return { org: slug };
  }

  // Single-tenant and deliberately unguarded: the one implicit caller IS the
  // operator, so the ordinary clients and a fresh Organization satisfy the
  // privileged contract (stigmer#547).
  async provisionPrivilegedScope(): Promise<PrivilegedScope> {
    const clients = this.clients();
    const { slug } = await createUniqueOrganization(clients.organizationCommand, "the privileged scope");
    return { clients, context: { org: slug }, cleanup: async () => {} };
  }

  async cleanupTenancy(): Promise<void> {
    // No-op: resources are removed by fixtures and the per-file server teardown.
  }

  async teardown(): Promise<void> {
    // The sibling first: a lane whose spawn failed rejected the promise the
    // arms already saw, and has nothing left to close.
    if (this.siblingLane !== undefined) {
      const pending = this.siblingLane;
      this.siblingLane = undefined;
      await pending.then((sibling) => sibling.close()).catch(() => undefined);
    }
    await this.server?.stop();
    this.server = undefined;
    await this.storage?.release();
    this.storage = undefined;
    this.conformanceClients = undefined;
  }
}
