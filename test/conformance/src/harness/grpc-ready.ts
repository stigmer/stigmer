// Waits until a booted server's gRPC stack and store are actually serving.
// Domain: conformance harness (server lifecycle).
//
// TCP-readiness only proves the listener is up; this probe proves the gRPC
// pipeline and backing store answer real requests before any test runs.
// findMyOrganizations takes Empty and runs no validation, so it is a pure store
// probe with no request to construct. Shared by every managed target (local-go
// CRUD, local-go-execution) so they gate on one identical readiness definition.
import { setTimeout as delay } from "node:timers/promises";
import type { ConformanceClients } from "./clients";

const GRPC_READY_TIMEOUT_MS = 15_000;
const GRPC_READY_POLL_MS = 150;

export async function awaitGrpcReady(
  clients: ConformanceClients,
  logTail: () => string,
): Promise<void> {
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
      `--- server log tail ---\n${logTail()}`,
  );
}
