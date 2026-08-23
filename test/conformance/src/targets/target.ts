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
  // The skill artifact transfer lane (stigmer#675): createArtifactUploadUrl /
  // push-by-reference / getArtifactDownloadUrl move artifact bytes over HTTP
  // so skills above the 10MB gRPC message cap (up to the 100MB skill limit)
  // can be pushed and mounted. True for local OSS since stigmer#675; false
  // for cloud until its sibling implements the same contract over R2
  // pre-signed URLs — where false, the suite pins that the RPCs answer
  // Unimplemented (the fallback contract clients rely on).
  skillArtifactTransferLane: boolean;
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
  // The ORDINARY conformance caller may write labels in the reserved
  // stigmer.ai/* namespace.
  //
  // True for the local OSS targets: single-tenant, deliberately unguarded —
  // the operator owns the store (stigmer-cloud#320 scoped OSS out).
  //
  // False for cloud: GuardReservedLabelsStep rejects non-operator
  // introductions/changes of reserved labels at every client-facing write
  // boundary (stigmer-cloud#320 for agents, platform-wide since
  // stigmer-cloud#386). Where false, the suite pins the guard itself: an
  // ordinary caller introducing a reserved label gets INVALID_ARGUMENT.
  // The getDefault determinism pin no longer rides this flag — it creates
  // its labeled candidates through provisionPrivilegedScope (stigmer#547),
  // so it runs on cloud again.
  clientReservedLabelWrites: boolean;
// NOTE: there is deliberately no shared-runner-artifact-store capability.
  // Every execution target's runner resolves storage-key attachments the
  // server persisted: local targets share the server's on-disk store (the
  // #285 shared-dir wiring), and cloud-execution presigns against the real
  // service's MinIO-backed artifact routes via the runner's
  // STIGMER_ARTIFACT_PROXY_ENDPOINT override (stigmer#803). The flag that
  // used to gate the attachment-materialization assertions
  // (sharedRunnerArtifactStore) was retired when that lane landed — the
  // executionContextSecretRedaction retirement precedent.
  // The conformance caller passes the Memory create RPC's strict
  // first-party-human-operator gate (DD-002 D4 as amended, inherited by
  // memory capture — DD-005 D2/DD-006 D1).
  //
  // True for the local OSS targets: single-user posture, no caller
  // identity, no gate.
  //
  // False for cloud — BY RATIFIED DESIGN, not a harness gap: the
  // conformance primary user is minted through the bootstrap
  // PlatformClient, and platform-client user tokens are exactly the
  // credential class DD-002 D4's amendment excludes from first-party
  // gating. Where false, the suite pins the gate itself: create answers
  // PermissionDenied even with both memory_enabled flags on. Cloud's
  // full memory lifecycle is covered by test/integration (seeded rows +
  // FGA tuples) and the Java handler unit tests — the same coverage
  // split ComposeDeclaredPreferencesStep has.
  firstPartyMemoryCapture: boolean;
  // The conformance caller may set a resource's visibility to PUBLIC — the
  // only level that crosses every org boundary (the cross-org "explore"
  // catalog).
  //
  // True for the local OSS targets: single-tenant, deliberately unguarded —
  // the operator owns the store, the same scoping stigmer-cloud#320 applied
  // to reserved labels.
  //
  // False for cloud: public listing is operator-gated at BOTH write doors
  // (AuthorizeVisibilityTransitionStep on updateVisibility escalation,
  // GuardPublicVisibilityStep on create-with-public — both requiring
  // can_set_public_visibility on platform:stigmer), and the ordinary
  // conformance user holds no platform-operator grant. Where false, the
  // suite pins the gate itself: escalation to public returns
  // PermissionDenied and leaves the stored level untouched. Flip or retire
  // this flag when the harness gains a platform-privileged caller
  // (stigmer#547) — until then the happy-path pin runs OSS-side only.
  clientPublicVisibilityWrites: boolean;
}

// Tenancy scope a test operates within. Locally this is just a unique org slug
// (the org never exists as a resource); on cloud the target creates the org so
// authorization has something to grant against, but the shape is identical —
// suites stay agnostic to which kind of scope they received.
export interface TenancyContext {
  org: string;
}

// A platform-operator caller plus a tenancy that caller may create resources
// in — the privileged lane assertions that exercise operator-only writes
// (reserved labels, the public flip) run through (stigmer#547).
//
// Platform-operator power deliberately does NOT propagate to organizations
// (the cloud FGA model checks platform capabilities against platform:stigmer
// only), so the scope carries its own org: on cloud the operator user creates
// and owns it; on the local targets — single-tenant, unguarded, the caller IS
// the operator — the ordinary clients and a unique slug already satisfy the
// contract.
export interface PrivilegedScope {
  readonly clients: ConformanceClients;
  readonly context: TenancyContext;
  cleanup(): Promise<void>;
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

  // Base URL of the server's unified HTTP port, for the plain-HTTP lanes that
  // route AROUND gRPC (the registry proxies). Present only on targets whose
  // OSS-lane HTTP surface is under test: the local targets own their spawned
  // server's port; the cloud edition serves registries through its own
  // authenticated routes (a different contract), so the method is absent
  // there and the registry-proxy suite reports SKIPPED — the DD-012
  // "genuinely skipped, not false green" posture. Valid only after setup().
  httpBaseUrl?(): string;

  // A platform-operator caller with a tenancy of its own (stigmer#547) — see
  // PrivilegedScope. Absent where no operator credential exists: hermetic
  // cloud runs bootstrap one (a conf-operator user granted operator on
  // platform:stigmer via the production bootstrapPolicy RPC), but
  // pre-provisioned/deployed endpoints deliberately carry none — operator
  // credentials against a real deployment is the permanent skip the stigmer#547
  // ruling recorded — so privileged-lane assertions skip there.
  provisionPrivilegedScope?(): Promise<PrivilegedScope>;
}
