// Local target: builds and boots the OSS TypeScript server from source.
// Born as local-ts during the TS rewrite (stigmer-cloud program 20260822.01,
// D4) and renamed to plain `local` when the Go server retired (D4 #25) —
// there is one local implementation now.
// Domain: conformance targets.
//
// This is a managed target — it owns the server process lifecycle. The
// server runs single-tenant with no auth and no Temporal (not needed for
// the CRUD domains), so tenancy provisioning is just a unique org slug.
import { ensureTsServerEntry } from "../harness/ts-build";
import { createTransport, makeClients, type ConformanceClients } from "../harness/clients";
import { awaitGrpcReady } from "../harness/grpc-ready";
import { spawnServer, type RunningServer } from "../harness/server-process";
import { uniqueOrg } from "../support/naming";
import type { CapabilityFlags, PrivilegedScope, TargetProfile, TenancyContext } from "./target";

export class LocalTarget implements TargetProfile {
  readonly name: string = "local";
  // The retired Go server's exact matrix — the parity promise the TS port
  // was gated on (D4). The one deliberate divergence, workflowChild-
  // ApprovalForwarding, lives on local-execution (#23).
  readonly capabilities: CapabilityFlags = {
    multiTenant: false,
    externalOrgLookup: false,
    organizationEnumeration: true,
    versionTagging: true,
    skillArtifactTransferLane: true,
    workflowChildApprovalForwarding: false,
    // No Temporal behind this target at all — schedules cannot fire.
    scheduleFiring: false,
    // Single-tenant OSS: the reserved-label write guard is cloud-only
    // (stigmer-cloud#320), so the caller may create labeled candidates.
    clientReservedLabelWrites: true,
    firstPartyMemoryCapture: true,
    clientPublicVisibilityWrites: true,
    // No channel runtime in this edition (T02 §0-b) — the suite pins the
    // documented refusal copy on every runtime lane.
    channelMessaging: false,
    // The org BYOA lane is UNIMPLEMENTED on OSS by design (stigmer#558) —
    // the TS port must reproduce the three refusals byte-for-byte.
    orgOAuthAppConfiguration: false,
    // No billing engine at all — executions run unmetered (DD-001 boundary).
    billingGates: false,
    // No PlatformClient surface in this edition — the controllers are
    // unrouted and the serving edge composes zero caller guards (the
    // 20260902.02 empty state), so the enforcement arms skip.
    platformClientTokens: false,
  };

  private server: RunningServer | undefined;
  private conformanceClients: ConformanceClients | undefined;

  async setup(): Promise<void> {
    const entry = await ensureTsServerEntry();
    // The TS server is a node entry, not a binary — same env contract,
    // same TCP-readiness gate (server-process.ts).
    this.server = await spawnServer(process.execPath, {
      args: [entry],
      env: this.extraServerEnv(),
    });
    this.conformanceClients = makeClients(createTransport(this.server.baseUrl));
    await awaitGrpcReady(this.conformanceClients, () => this.server?.logTail() ?? "(no server)");
  }

  // The storage-driver seam: local-postgres overrides this to inject
  // DATABASE_URL (winning over the harness's DB_PATH — the documented
  // config precedence). EVERYTHING else about the target is inherited, so
  // the capability matrix is byte-identical by construction, not by copy
  // discipline (DD-011: the driver must be wire-invisible).
  protected extraServerEnv(): Record<string, string> {
    return {};
  }

  clients(): ConformanceClients {
    if (this.conformanceClients === undefined) {
      throw new Error("LocalTarget.setup() must be called before clients()");
    }
    return this.conformanceClients;
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
    // No auth and no bootstrap org: a unique slug is a fully isolated scope.
    return { org: uniqueOrg() };
  }

  // Single-tenant and deliberately unguarded: the one implicit caller IS the
  // operator, so the ordinary clients and a fresh slug satisfy the privileged
  // contract (stigmer#547).
  async provisionPrivilegedScope(): Promise<PrivilegedScope> {
    return { clients: this.clients(), context: { org: uniqueOrg() }, cleanup: async () => {} };
  }

  async cleanupTenancy(): Promise<void> {
    // No-op: resources are removed by fixtures and the per-file server teardown.
  }

  async teardown(): Promise<void> {
    await this.server?.stop();
    this.server = undefined;
    this.conformanceClients = undefined;
  }
}
