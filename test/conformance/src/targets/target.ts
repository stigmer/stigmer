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
  // NOTE: there is deliberately no ExecutionContext secret-redaction
  // capability. The EC surface is edition-CONVERGED since stigmer#535 (the
  // stigmer#405 spawned EC-at-rest port): both editions encrypt EC values at
  // rest, redact every user-shaped EC read, and decrypt only for a
  // scope-bound runner credential (cloud: ResolveExecutionContextValuesForCaller;
  // OSS: the execution-scoped token lane on getByExecutionId). The EC and
  // envmerge suites assert redaction unconditionally, exactly like the
  // environment suite — the flag that used to gate this
  // (executionContextSecretRedaction) was retired at convergence, the same
  // retirement the environment surface got in stigmer#405.
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
  // Schedules actually FIRE here: a trigger records status.last_fire_at,
  // repeated failed fires accumulate status.consecutive_failures into the
  // platform auto-pause, and resume + re-trigger fires again. Requires a
  // Temporal-backed scheduling clock behind the server.
  //
  // True for cloud (the hermetic cloud env boots Temporal and the Java
  // service runs the schedule clock shipped in T04 slice 2). False for
  // local-go (the CRUD target runs without Temporal at all) and for
  // local-go-execution UNTIL the OSS Go clock lands (T04 slice 3) — the
  // Schedule contract, CLI, and trigger/resume refusal matrix all exist in
  // OSS today, but nothing fires. Flipping this flag to true for
  // local-go-execution is slice 3's finish line: the firing suite then runs
  // identically against both editions.
  //
  // Deliberately a capability flag and not a heavier target: firing needs
  // the engine but NOT a runner or LLM (the suite fires against a
  // deleted target agent, so every fire fails deterministically before any
  // execution is created) — which is what lets this be the first
  // execution-class behavior asserted cross-edition.
  scheduleFiring: boolean;
  // The conformance caller may write labels in the reserved stigmer.ai/*
  // namespace (the getDefault determinism pin creates its labeled
  // candidates through the public API).
  //
  // True for the local OSS targets: single-tenant, deliberately unguarded —
  // the operator owns the store (stigmer-cloud#320 scoped OSS out).
  //
  // False for cloud: GuardReservedLabelsStep rejects non-operator
  // introductions/changes of reserved labels at the agent write boundaries
  // (stigmer-cloud#320), and the ordinary conformance user holds no
  // platform-operator grant. Cloud determinism coverage lives at the
  // adapter layer meanwhile (AgentRepoCustomQueryContractTest). Flip or
  // retire this flag when the harness gains a platform-privileged caller
  // (stigmer#547) — until then the pin runs OSS-side only.
  clientReservedLabelWrites: boolean;
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
