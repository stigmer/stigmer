// Cloud target stub: the Java stigmer-service as an external endpoint.
// Domain: conformance targets.
//
// Intentionally a stub for this slice. It pins the shape the real cloud target
// must take — an external (connect-only) target with multi-tenant capabilities
// and real org/auth provisioning — without implementing the tenancy bootstrap
// and credentials, which arrive in a later T01 slice. Selecting it fails loudly
// rather than silently running nothing.
import type { ConformanceClients } from "../harness/clients";
import type { CapabilityFlags, TargetProfile, TenancyContext } from "./target";

const NOT_IMPLEMENTED =
  "cloud target is not implemented yet (deferred to a later T01 slice); " +
  "set CONFORMANCE_TARGET=local-go to run the suite locally";

export class CloudTarget implements TargetProfile {
  readonly name = "cloud";
  readonly capabilities: CapabilityFlags = {
    multiTenant: true,
    externalOrgLookup: true,
  };

  async setup(): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  clients(): ConformanceClients {
    throw new Error(NOT_IMPLEMENTED);
  }

  async provisionTenancy(): Promise<TenancyContext> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async cleanupTenancy(): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async teardown(): Promise<void> {
    // Nothing to tear down: setup() always throws.
  }
}
