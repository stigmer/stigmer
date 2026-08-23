// Local TS target: builds and boots the TypeScript stigmer-server-ts from
// source — the parity target the OSS rewrite grows suite by suite (its
// roster reaching the local-go configuration is the cutover gate; stigmer-
// cloud program 20260822.01, D4).
// Domain: conformance targets.
//
// A managed target mirroring LocalGoTarget exactly: same spawn env
// contract, same tenancy semantics, and — deliberately — a capability
// matrix byte-identical to local-go's, so every rostered suite asserts the
// same arms against both servers. The only difference is WHAT boots:
// `node dist/main.js` instead of the Go binary.
import { ensureTsServerEntry } from "../harness/ts-build";
import { createTransport, makeClients, type ConformanceClients } from "../harness/clients";
import { awaitGrpcReady } from "../harness/grpc-ready";
import { spawnServer, type RunningServer } from "../harness/server-process";
import { uniqueOrg } from "../support/naming";
import type { CapabilityFlags, PrivilegedScope, TargetProfile, TenancyContext } from "./target";

export class LocalTsTarget implements TargetProfile {
  readonly name = "local-ts";
  // Byte-identical to LocalGoTarget.capabilities (D4: the TS targets'
  // matrices match Go's; the one planned flip — workflowChildApproval-
  // Forwarding — lands on local-ts-execution with sub-project #23).
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
  };

  private server: RunningServer | undefined;
  private conformanceClients: ConformanceClients | undefined;

  async setup(): Promise<void> {
    const entry = await ensureTsServerEntry();
    // The TS server is a node entry, not a binary — same env contract,
    // same TCP-readiness gate (server-process.ts).
    this.server = await spawnServer(process.execPath, { args: [entry] });
    this.conformanceClients = makeClients(createTransport(this.server.baseUrl));
    await awaitGrpcReady(this.conformanceClients, () => this.server?.logTail() ?? "(no server)");
  }

  clients(): ConformanceClients {
    if (this.conformanceClients === undefined) {
      throw new Error("LocalTsTarget.setup() must be called before clients()");
    }
    return this.conformanceClients;
  }

  // The spawned server's unified port also serves the plain-HTTP lanes (the
  // registry proxies) — expose it so those suites can drive them directly.
  httpBaseUrl(): string {
    if (this.server === undefined) {
      throw new Error("LocalTsTarget.setup() must be called before httpBaseUrl()");
    }
    return this.server.baseUrl;
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
