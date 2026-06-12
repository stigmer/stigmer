// Local OSS target: builds and boots the Go stigmer-server from source.
// Domain: conformance targets.
//
// This is a managed target — it owns the server process lifecycle. The server
// runs single-tenant with no auth and no Temporal (not needed for the CRUD
// domains in this slice), so tenancy provisioning is just a unique org slug.
import { setTimeout as delay } from "node:timers/promises";
import { ensureServerBinary } from "../harness/go-build";
import { createTransport, makeClients, type ConformanceClients } from "../harness/clients";
import { spawnServer, type RunningServer } from "../harness/server-process";
import { uniqueOrg } from "../support/naming";
import type { CapabilityFlags, TargetProfile, TenancyContext } from "./target";

const GRPC_READY_TIMEOUT_MS = 15_000;
const GRPC_READY_POLL_MS = 150;

export class LocalGoTarget implements TargetProfile {
  readonly name = "local-go";
  readonly capabilities: CapabilityFlags = {
    multiTenant: false,
    externalOrgLookup: false,
    versionTagging: false,
  };

  private server: RunningServer | undefined;
  private conformanceClients: ConformanceClients | undefined;

  async setup(): Promise<void> {
    const binary = await ensureServerBinary();
    this.server = await spawnServer(binary);
    this.conformanceClients = makeClients(createTransport(this.server.baseUrl));
    await this.awaitGrpcReady();
  }

  // TCP-readiness only proves the listener is up. A trivial query confirms the
  // gRPC stack and SQLite store are actually serving before tests begin.
  // findMyOrganizations takes Empty and runs no validation, so it is a pure
  // store probe with no request to construct.
  private async awaitGrpcReady(): Promise<void> {
    const clients = this.clients();
    const deadline = Date.now() + GRPC_READY_TIMEOUT_MS;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        await clients.organizationQuery.findMyOrganizations({});
        return;
      } catch (err) {
        lastError = err;
        await delay(GRPC_READY_POLL_MS);
      }
    }
    throw new Error(
      `gRPC readiness gate failed within ${GRPC_READY_TIMEOUT_MS}ms: ${String(lastError)}\n` +
        `--- server log tail ---\n${this.server?.logTail() ?? "(no server)"}`,
    );
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
