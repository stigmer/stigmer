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
  // OrganizationQuery.find enumerates every organization. True for local OSS,
  // which is single-tenant and returns them all. False for cloud, where
  // enumerating every tenant's org is not a tenant capability — cloud leaves
  // find unrouted and answers Unimplemented; tenants use findMyOrganizations
  // (proto documents find as platform-admin/administrative use only).
  organizationEnumeration: boolean;
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
  // A child agent's tool-approval gate surfaces at the parent WorkflowExecution
  // (status.pending_approvals carries the child_agent_execution_id) so that
  // WorkflowExecution.submitApproval can forward the decision to the child.
  //
  // False for local OSS: the *forwarder* is fully built (submit_approval.go, the
  // runner's call-agent orchestrator, all protos), but the upstream half — the
  // `child_approval_required` signal the agent-execution workflow emits when it
  // gates — is cloud-only. The OSS Go agent-execution workflow never emits it, so
  // a gated agent_call child never populates the parent's pending_approvals and
  // the forwarder's happy path is structurally unreachable (source-confirmed, not
  // a timing artifact; see DD-012). The reachable *negatives* (no pending
  // approval, proto validation, missing execution) are edition-agnostic and are
  // asserted unconditionally.
  //
  // True for cloud, which emits the signal and surfaces the gate to the parent.
  // The forwarder happy-path assertions are gated on this flag so they run only
  // where the full round-trip exists — including the future local-ts-execution
  // (T04) target, which is where the OSS implementation will finally land.
  workflowChildApprovalForwarding: boolean;
}

// Tenancy scope a test operates within. Locally this is just a unique org slug
// (the org never exists as a resource); on cloud the target creates the org so
// authorization has something to grant against, but the shape is identical —
// suites stay agnostic to which kind of scope they received.
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

  // Clients authenticated as a fresh identity with no grants on any tenancy
  // provisioned so far — the "outsider" for cross-tenant isolation assertions
  // (membership-filtered lists, denied reads). Present only on multi-tenant
  // targets, where distinct identities exist; local targets have a single
  // implicit caller, so isolation is untestable there by construction.
  provisionIdentity?(): Promise<ConformanceClients>;
}
