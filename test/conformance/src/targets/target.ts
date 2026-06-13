// Target profile abstraction (D3): one suite, many implementations.
// Domain: conformance targets.
//
// A target hides everything that differs between the things under test — how the
// server is reached (spawned locally vs. an external endpoint), how tenancy is
// provisioned, and which optional behaviors are available — behind one interface
// so the suites stay implementation-agnostic.
import type { ConformanceClients } from "../harness/clients";
import type { McpToolFixture } from "../harness/mcp-server";
import type { MockLlmProxy } from "../harness/mock-llm";

// Behaviors that legitimately differ across editions, gating assertions rather
// than forking them. Local OSS is single-tenant and omits cloud-only lookups.
export interface CapabilityFlags {
  // Multi-tenant isolation / IAM-scoped list filtering. False for local OSS,
  // where list RPCs return everything.
  multiTenant: boolean;
  // OrganizationQuery.getByExternalOrgId is implemented. False for local OSS.
  externalOrgLookup: boolean;
  // The dedicated WorkflowCommandController.tagVersion mutation RPC is
  // implemented. False for local OSS, which has no handler (it answers
  // Unimplemented) — version tags are instead set at apply time via
  // metadata.version.tag and resolved through getByReference.
  versionTagging: boolean;
  // Secret values (EnvironmentValue/ExecutionValue with is_secret=true) are
  // redacted on read. False for local OSS, which is single-user/local and
  // returns secret values in plaintext on get/list/getByReference/getSecretValue
  // (encryption is implemented but never invoked by the write pipelines). True
  // for cloud, which encrypts at rest and redacts on read. The is_secret flag
  // itself is edition-agnostic; only the value handling differs.
  secretRedaction: boolean;
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

  // The programmable mock LLM proxy backing agent-execution runs. Present only on
  // execution targets that provision an engine + mock; absent on CRUD/cloud
  // targets. Agent execution suites obtain it via requireLlmProxy().
  llmProxy?(): MockLlmProxy;

  // The HTTP MCP server fixture backing tool-using agent runs (HITL). Present
  // only on execution targets; absent on CRUD/cloud targets. Suites obtain it via
  // requireMcpFixture() and register an McpServer pointing at its url().
  mcpFixture?(): McpToolFixture;
}
