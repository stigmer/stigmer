// Target profile abstraction (D3): one suite, many implementations.
// Domain: conformance targets.
//
// A target hides everything that differs between the things under test — how the
// server is reached (spawned locally vs. an external endpoint), how tenancy is
// provisioned, and which optional behaviors are available — behind one interface
// so the suites stay implementation-agnostic.
import type { ConformanceClients } from "../harness/clients";

// Behaviors that legitimately differ across editions, gating assertions rather
// than forking them. Local OSS is single-tenant and omits cloud-only lookups.
export interface CapabilityFlags {
  // Multi-tenant isolation / IAM-scoped list filtering. False for local OSS,
  // where list RPCs return everything.
  multiTenant: boolean;
  // OrganizationQuery.getByExternalOrgId is implemented. False for local OSS.
  externalOrgLookup: boolean;
}

// Tenancy scope a test operates within. Locally this is just a unique org slug;
// in cloud it will carry the provisioned org plus its auth context.
export interface TenancyContext {
  org: string;
}

export interface TargetProfile {
  readonly name: string;
  readonly capabilities: CapabilityFlags;

  // Bring the target to a state where clients() can be used. For managed
  // targets this builds/boots the server; for external targets it connects.
  setup(): Promise<void>;
  teardown(): Promise<void>;

  clients(): ConformanceClients;

  // Provision an isolated tenancy scope for a test. cleanupTenancy releases it.
  provisionTenancy(): Promise<TenancyContext>;
  cleanupTenancy(context: TenancyContext): Promise<void>;
}
