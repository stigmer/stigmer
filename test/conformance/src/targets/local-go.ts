// Local OSS target: builds and boots the Go stigmer-server from source.
// Domain: conformance targets.
//
// This is a managed target — it owns the server process lifecycle. The server
// runs single-tenant with no auth and no Temporal (not needed for the CRUD
// domains in this slice), so tenancy provisioning is just a unique org slug.
import { ensureServerBinary } from "../harness/go-build";
import { createTransport, makeClients, type ConformanceClients } from "../harness/clients";
import { awaitGrpcReady } from "../harness/grpc-ready";
import { spawnServer, type RunningServer } from "../harness/server-process";
import { uniqueOrg } from "../support/naming";
import type { CapabilityFlags, TargetProfile, TenancyContext } from "./target";

export class LocalGoTarget implements TargetProfile {
  readonly name = "local-go";
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
  };

  private server: RunningServer | undefined;
  private conformanceClients: ConformanceClients | undefined;

  async setup(): Promise<void> {
    const binary = await ensureServerBinary();
    this.server = await spawnServer(binary);
    this.conformanceClients = makeClients(createTransport(this.server.baseUrl));
    await awaitGrpcReady(this.conformanceClients, () => this.server?.logTail() ?? "(no server)");
  }

  clients(): ConformanceClients {
    if (this.conformanceClients === undefined) {
      throw new Error("LocalGoTarget.setup() must be called before clients()");
    }
    return this.conformanceClients;
  }

  async provisionTenancy(): Promise<TenancyContext> {
    // No auth and no bootstrap org: a unique slug is a fully isolated scope.
    return { org: uniqueOrg() };
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
