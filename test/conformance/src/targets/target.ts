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
  // gates — splits by SERVER: cloud's Java workflow and (since D4 #23) the TS
  // server's HITL loop emit it; the Go agent-execution workflow never does, so
  // against the Go server a gated agent_call child never populates the parent's
  // pending_approvals and the forwarder's happy path is structurally
  // unreachable (source-confirmed, not a timing artifact; see DD-012). The
  // reachable *negatives* (no pending approval, proto validation, missing
  // execution) are sender-independent and are asserted unconditionally.
  //
  // True for cloud and local-execution, which emit the signal and surface
  // the gate to the parent. The forwarder happy-path assertions are gated on
  // this flag so they run only where the full round-trip exists. (History:
  // the retired Go server never sent the signal — this flag was the one
  // deliberate capability divergence of the TS port, the D4 parity-plus
  // delta.)
  workflowChildApprovalForwarding: boolean;
  // Schedules actually FIRE here: a trigger records status.last_fire_at,
  // repeated failed fires accumulate status.consecutive_failures into the
  // platform auto-pause, and resume + re-trigger fires again. Requires a
  // Temporal-backed scheduling clock behind the server.
  //
  // True for cloud (the hermetic cloud env boots Temporal and the Java
  // service runs the schedule clock shipped in T04 slice 2) and for
  // local-execution (the OSS schedule clock, D4 #22). False for the plain
  // local target, which runs without Temporal at all — the Schedule
  // contract, CLI, and trigger/resume refusal matrix all exist there, but
  // nothing fires.
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
  // The channel RUNTIME lanes exist here: provider installs
  // (initiateInstall/completeInstall), conversation participation
  // (reply/takeOver/handBack/clearAttention/escalate), and proactive
  // messaging (sendMessage/listTemplates).
  //
  // False for the local OSS targets — BY DOCUMENTED DESIGN, not a gap
  // (channel-integrations T02 §0-b and its siblings): this edition has no
  // webhook receiver, no delivery runtime, and no participation state
  // machine, so every runtime command refuses with FAILED_PRECONDITION and
  // per-surface copy ("channel installs require Stigmer Cloud" /
  // "conversation participation requires Stigmer Cloud" / "proactive
  // channel messaging requires Stigmer Cloud"). Where false, the suite
  // byte-pins those refusals — they are the OSS contract, and the TS port
  // must reproduce them exactly.
  //
  // True for cloud, whose channel runtime serves these lanes for real.
  // The refusal pins are gated OFF there; the lanes' full cloud behavior
  // needs live provider workspaces (a real Slack install), which no
  // hermetic target can provision — it stays covered by cloud's own
  // integration tests, the same coverage split ComposeDeclaredPreferences
  // has. What runs unconditionally on both editions: input validation
  // (INVALID_ARGUMENT — the Go controllers deliberately validate before
  // refusing so this contract matches cloud), the install lanes'
  // load-then-NOT_FOUND for unknown channels, and the discovery reads'
  // truthful-emptiness postures (empty lists / uniform NOT_FOUND), which
  // hold wherever no conversation traffic exists — exactly the state a
  // fresh conformance fixture is in on either edition.
  channelMessaging: boolean;
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
  // The org-level OAuth-app configuration surface exists here: the McpServer
  // service's setOrgOAuthApp / getOrgOAuthApp / deleteOrgOAuthApp RPCs (the
  // hosted BYOA lane — an org admin registers their own vendor OAuth app for
  // an MCP server).
  //
  // False for the local OSS targets — BY DOCUMENTED DESIGN, not a gap: the
  // proto pins all three RPCs as "UNIMPLEMENTED on the OSS server by design"
  // (one capability, probed via getOrgOAuthApp — stigmer/stigmer#558, the SDK
  // gates its BYOA UI on exactly that answer). Where false, the suite pins
  // the three UNIMPLEMENTED refusals — they are the OSS contract the TS port
  // must reproduce, the same refusal-pin posture versionTagging and
  // channelMessaging document above.
  //
  // True for cloud, whose Java service implements the lane for real. The
  // pins are gated OFF there; the lane's full cloud behavior needs a real
  // vendor OAuth app no hermetic target can provision, so it stays covered
  // by cloud's own integration tests — the channelMessaging coverage split.
  orgOAuthAppConfiguration: boolean;
  // Execution-credit billing gates run here: an agent-execution create is
  // authorized against the org's per-credit balance before any work happens,
  // and a zero-balance account denies the run with the engine's one denial
  // vocabulary ("Insufficient credits to start execution").
  //
  // True for cloud — the Java billing engine natively (the reservation
  // authorized inside InvokeAgentExecutionWorkflow), and the TS composition
  // through the C5 billing facade (the create-time reserve gate, ruling Q5 of
  // 20260830.02.sp.billing-facade). WHERE the denial lands differs by ruled
  // design — see STIGMER_CONFORMANCE_BILLING_DENIAL_CONTRACT in the
  // billing-denial suite.
  //
  // False for the local OSS targets — BY DD-001 BOUNDARY, not a gap: OSS has
  // no billing engine, no credit accounting, and no billing gates; every
  // execution runs unmetered. There is no refusal contract to pin, so the
  // billing-denial suite skips entirely (the scheduleFiring posture).
  billingGates: boolean;
  // The platform-client caller-identity lane exists AND its minting-client
  // contract is enforced at the serving edge: user tokens are minted by
  // PlatformClients (mintUserToken), deleting the minting client revokes its
  // outstanding user tokens on the next request (deletion-revocation,
  // stigmer-cloud#342), and browser requests from origins outside the
  // client's allowed_origins are refused (stigmer/stigmer#375). Both refusals
  // carry byte-pinned copy shared by the Java interceptor
  // (PlatformClientEnforcementInterceptor) and the composition's
  // platform-client caller guard (entry 20260902.02) — the enforcement suite
  // asserts the exact bytes on every target where this is true.
  //
  // False for the local OSS targets — BY DESIGN, not a gap: OSS routes no
  // PlatformClient controllers at all (the PC surface is cloud IAM
  // vocabulary), so there is no minting lane, no enforcement, and no refusal
  // contract to pin; the enforcement arms skip entirely (the scheduleFiring
  // posture). Deliberately NOT folded into multiTenant: tenant isolation and
  // the minting client's contract are different concerns — a future target
  // could carry one without the other.
  platformClientTokens: boolean;
  // Every non-public RPC requires a credential: a request with NO bearer is
  // refused UNAUTHENTICATED "authentication token missing" (the copy both
  // editions pin — the Java interceptor's, and the OSS chassis's byte-for-
  // byte). What stays reachable tokenless on EVERY target regardless of
  // this flag: is_public methods (getServerInfo) and the standard gRPC
  // health service (Kubernetes grpc probes), which the authentication suite
  // asserts unconditionally.
  //
  // True for cloud — the Java interceptor natively (GrpcSecurityConfigBase),
  // and the TS composition through the require-authentication registry
  // point its cloud-core unit declares (entry 20260904.02).
  //
  // False for the local OSS targets — BY DESIGN, not a gap: the single-
  // operator trusted-local posture admits a tokenless request as the
  // operator, and a presented-but-unclaimed token falls through to the same
  // identity when no verifier is composed (the O2 ruling-Q6 contract). Where
  // false, the suite pins that admission — the OSS contract the TS server
  // must keep. Deliberately NOT folded into platformClientTokens or
  // multiTenant: a self-host with STIGMER_OIDC_ISSUER set requires
  // authentication with neither of those.
  requiresAuthentication: boolean;
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

  // Clients presenting NO credential at all — the anonymous caller the
  // authentication suite drives at the serving edge (entry 20260904.02).
  // Every target can build one (a transport with no bearer interceptor), so
  // the method is required, not a capability; what the anonymous caller
  // GETS is the requiresAuthentication flag's business. Suites never build
  // transports themselves — the target owns how it is reached.
  anonymousClients(): ConformanceClients;

  // Clients presenting exactly the given bearer credential, claimed by
  // nothing — the presented-but-unclaimed arm of the position-1 contract
  // (refused where a verifier is composed; admitted as the operator on the
  // verifier-less local targets). Required for the same reason as
  // anonymousClients; the primary credential stays clients()'s.
  clientsPresenting(bearerToken: string): ConformanceClients;

  // Why THIS environment's serving edge cannot demonstrate the edition's
  // requiresAuthentication contract, or undefined when it can. A harness
  // fact, deliberately separate from the capability flag (which states the
  // edition's contract): the hermetic cloud launcher boots Java in test
  // security mode, where no edge authentication is loaded at all and a
  // synthetic caller stands in for every request — the posture is real in
  // production and unobservable there. The authentication suite skips its
  // credential arms VISIBLY, with this reason, when one is returned; it
  // never asserts admission on a bypassed edge (that would pin a harness
  // artifact as a contract). Present only on the cloud targets, whose
  // environment is declared through CLOUD_ENV.edgeAuthentication (default
  // enforced — a readout that forgets the variable fails loudly, never
  // false-greens); the local targets' posture IS what their flag says.
  edgeAuthenticationBypass?(): string | undefined;

  // Provision an isolated tenancy scope for a test. cleanupTenancy releases it.
  provisionTenancy(): Promise<TenancyContext>;
  cleanupTenancy(context: TenancyContext): Promise<void>;

  // Tenancy WITHOUT the execution-credit seed: the org exists (and on cloud
  // its billing account exists at the zero balance an org create provisions),
  // but no credits are added — the precondition the billing-denial suite pins.
  // Present only on billingGates targets, where the funded/unfunded
  // distinction is observable; elsewhere provisionTenancy is already unfunded
  // by construction and the suite skips. cleanupTenancy releases it.
  provisionUnfundedTenancy?(): Promise<TenancyContext>;

  // Seed the org's billing account with the target's standard execution
  // credit allowance (the same seed provisionTenancy applies) — the
  // billing-denial suite's negative control: funding the SAME org must clear
  // the denial, proving it was credit-driven. Present only on billingGates
  // targets.
  fundTenancy?(org: string): Promise<void>;

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

  // Base URL of the server's artifact HTTP file server — the ONE lane that
  // deliberately lives on its own port beside the unified one (D1: plain
  // FileServer over the artifact base path, served only when artifact
  // storage is local). Present only on the local managed targets, whose
  // spawned server pins the port (ARTIFACT_HTTP_PORT); absent on cloud,
  // where artifact bytes travel through the service's own authenticated,
  // presigned routes (a different contract) — the artifact suite's
  // file-server block then reports SKIPPED at collection time, the
  // registry-proxy posture. Valid only after setup().
  artifactHttpBaseUrl?(): string;

  // A platform-operator caller with a tenancy of its own (stigmer#547) — see
  // PrivilegedScope. Absent where no operator credential exists: hermetic
  // cloud runs bootstrap one (a conf-operator user granted operator on
  // platform:stigmer via the production bootstrapPolicy RPC), but
  // pre-provisioned/deployed endpoints deliberately carry none — operator
  // credentials against a real deployment is the permanent skip the stigmer#547
  // ruling recorded — so privileged-lane assertions skip there.
  provisionPrivilegedScope?(): Promise<PrivilegedScope>;
}
